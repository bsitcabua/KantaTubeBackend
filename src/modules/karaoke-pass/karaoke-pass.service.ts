import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { DataSource, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  addPlanDuration,
  KaraokePassPlan,
  planResponse,
  resolveKaraokePassPlan,
} from './karaoke-pass.catalog';
import {
  getPayMongoRuntimeConfigForMode,
  PayMongoMode,
} from './karaoke-pass.config';
import {
  KaraokePassAccessService,
  KaraokePassAccessSummary,
} from './karaoke-pass-access.service';
import { PaymentEventsService } from './payment-events.service';
import {
  PayMongoClient,
  PayMongoPaymentIntentStatus,
} from './paymongo.client';
import { KaraokePassEntitlement } from './entities/karaoke-pass-entitlement.entity';
import {
  KaraokePassPurchase,
  KaraokePassPurchaseStatus,
} from './entities/karaoke-pass-purchase.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { ConfigService } from '@nestjs/config';

type JsonRecord = Record<string, any>;

type PaymentStatusResponse =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REVIEW'
  | 'QR_EXPIRED'
  | 'CHECK_UNAVAILABLE';

@Injectable()
export class KaraokePassService {
  private readonly logger = new Logger(KaraokePassService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(KaraokePassPurchase)
    private readonly purchases: Repository<KaraokePassPurchase>,
    @InjectRepository(KaraokePassEntitlement)
    private readonly entitlements: Repository<KaraokePassEntitlement>,
    @InjectRepository(PaymentWebhookEvent)
    private readonly webhookEvents: Repository<PaymentWebhookEvent>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly paymongo: PayMongoClient,
    private readonly access: KaraokePassAccessService,
    private readonly events: PaymentEventsService,
    private readonly config: ConfigService,
  ) {}

  listPlans() {
    const runtime = this.paymongo.runtimeConfig;
    return {
      plans: [
        ...['DAY', 'WEEK', 'MONTH', 'YEAR'].map((code) =>
          planResponse(resolveKaraokePassPlan(code)!),
        ),
      ],
      paymentsAvailable: runtime.available,
      mode: runtime.mode,
    };
  }

  async createPurchase(
    userId: string,
    planCodeInput: unknown,
  ): Promise<Record<string, unknown>> {
    const plan = this.requirePlan(planCodeInput);
    this.assertPaymentAvailable();
    const mode = this.paymongo.runtimeConfig.mode;
    const now = new Date();
    let purchase = await this.purchases.findOne({
      where: {
        userId,
        planCode: plan.code,
        status: KaraokePassPurchaseStatus.PENDING,
        paymongoMode: mode,
        activePendingKey: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
    });
    if (!purchase) {
      try {
        purchase = await this.dataSource.transaction(async (manager) => {
          const users = manager.getRepository(User);
          const rows = manager.getRepository(KaraokePassPurchase);
          const user = await users.findOne({
            where: { id: userId, status: UserStatus.ACTIVE },
            lock: { mode: 'pessimistic_write' },
          });
          if (!user) throw new NotFoundException('User not found.');
          const existing = await rows.findOne({
            where: {
              userId,
              planCode: plan.code,
              status: KaraokePassPurchaseStatus.PENDING,
              paymongoMode: mode,
              activePendingKey: Not(IsNull()),
            },
            order: { createdAt: 'DESC' },
          });
          if (existing) return existing;
          return rows.save(
            rows.create({
              publicReference: this.newReference(),
              userId,
              planCode: plan.code,
              amountCentavos: plan.amountCentavos,
              currency: plan.currency,
              status: KaraokePassPurchaseStatus.PENDING,
              paymongoMode: mode,
              paymongoPaymentIntentId: null,
              paymongoPaymentMethodId: null,
              paymongoPaymentId: null,
              qrImageUrl: null,
              testUrl: null,
              qrExpiresAt: null,
              paidAt: null,
              failureReason: null,
              paymongoStatus: null,
              activePendingKey: `${userId}:${plan.code}:${mode}`,
            }),
          );
        });
      } catch (error) {
        if (!this.isDuplicateEntry(error)) throw error;
        purchase = await this.purchases.findOne({
          where: {
            userId,
            planCode: plan.code,
            status: KaraokePassPurchaseStatus.PENDING,
            paymongoMode: mode,
            activePendingKey: Not(IsNull()),
          },
          order: { createdAt: 'DESC' },
        });
      }
    }
    if (!purchase)
      throw new ConflictException('Unable to create the payment purchase.');
    if (
      !purchase.qrImageUrl ||
      !purchase.paymongoPaymentIntentId ||
      !purchase.qrExpiresAt ||
      purchase.qrExpiresAt <= now
    )
      await this.attachQr(purchase, plan);
    return this.toPurchaseResponse(
      await this.purchases.findOneByOrFail({ id: purchase.id }),
      plan,
      now,
    );
  }

  async currentPurchase(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const purchase = await this.purchases.findOne({
      where: {
        userId,
        status: KaraokePassPurchaseStatus.PENDING,
        paymongoMode: this.paymongo.runtimeConfig.mode,
        activePendingKey: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
    });
    return purchase
      ? this.toPurchaseResponse(
          purchase,
          resolveKaraokePassPlan(purchase.planCode)!,
          new Date(),
        )
      : null;
  }

  async getPurchase(
    userId: string,
    reference: string,
  ): Promise<Record<string, unknown>> {
    const purchase = await this.findOwnedPurchase(userId, reference);
    return this.toPurchaseResponse(
      purchase,
      resolveKaraokePassPlan(purchase.planCode)!,
      new Date(),
    );
  }

  async regenerateQr(
    userId: string,
    reference: string,
  ): Promise<Record<string, unknown>> {
    this.assertPaymentAvailable();
    const purchase = await this.findOwnedPurchase(userId, reference);
    if (purchase.status !== KaraokePassPurchaseStatus.PENDING)
      return this.toPurchaseResponse(
        purchase,
        resolveKaraokePassPlan(purchase.planCode)!,
        new Date(),
      );
    await this.attachQr(purchase, resolveKaraokePassPlan(purchase.planCode)!);
    return this.toPurchaseResponse(
      await this.purchases.findOneByOrFail({ id: purchase.id }),
      resolveKaraokePassPlan(purchase.planCode)!,
      new Date(),
    );
  }

  async changePlan(
    userId: string,
    reference: string,
    planCodeInput: unknown,
  ): Promise<Record<string, unknown>> {
    const plan = this.requirePlan(planCodeInput);
    this.assertPaymentAvailable();
    const current = await this.findOwnedPurchase(userId, reference);
    if (current.status !== KaraokePassPurchaseStatus.PENDING)
      throw new ConflictException('This payment is no longer pending.');
    if (current.planCode === plan.code)
      return { superseded: false, reference: current.publicReference };

    // Keep the old purchase and its PayMongo mapping intact. If its QR is
    // paid later, the normal webhook path still grants that pass exactly
    // once. SUPERSEDED removes it from the active checkout while preserving
    // the provider mapping for late-payment reconciliation.
    await this.dataSource.transaction(async (manager) => {
      const purchases = manager.getRepository(KaraokePassPurchase);
      const locked = await purchases.findOne({
        where: { id: current.id, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== KaraokePassPurchaseStatus.PENDING)
        throw new ConflictException('This payment is no longer pending.');
      locked.activePendingKey = null;
      locked.status = KaraokePassPurchaseStatus.SUPERSEDED;
      await purchases.save(locked);
    });

    return {
      superseded: true,
      reference: current.publicReference,
      planCode: plan.code,
    };
  }

  async history(userId: string, pageInput?: unknown, limitInput?: unknown) {
    const page = this.safePage(pageInput);
    const limit = this.safeLimit(limitInput);
    const [rows, total] = await this.purchases.findAndCount({
      where: {
        userId,
        status: Not(KaraokePassPurchaseStatus.SUPERSEDED),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: rows.map((row) =>
        this.toPurchaseResponse(
          row,
          resolveKaraokePassPlan(row.planCode)!,
          new Date(),
        ),
      ),
      page,
      limit,
      total,
      hasNext: page * limit < total,
    };
  }

  async accessSummary(userId: string): Promise<KaraokePassAccessSummary> {
    return this.access.getSummary(userId);
  }

  async checkPaymentStatus(
    userId: string,
    purchaseId: string,
  ): Promise<Record<string, unknown>> {
    const purchase = await this.findOwnedPurchase(userId, purchaseId);
    const plan = resolveKaraokePassPlan(purchase.planCode);
    if (!plan) throw new ConflictException('Unknown karaoke pass plan.');

    if (purchase.status === KaraokePassPurchaseStatus.PAID) {
      // A previous webhook/poll may have finalized the purchase before the
      // session unlock listener was available. Reconcile the paid entitlement
      // before returning the authoritative status so the current session can
      // recover without a hard refresh.
      await this.access.notifyEntitlementActivated(purchase.userId);
      return this.paymentStatusResponse(
        purchase,
        plan,
        'PAID',
        purchase.paymongoStatus,
      );
    }
    if (purchase.status === KaraokePassPurchaseStatus.REVIEW)
      return this.paymentStatusResponse(
        purchase,
        plan,
        'REVIEW',
        purchase.paymongoStatus,
      );
    if (purchase.status === KaraokePassPurchaseStatus.FAILED)
      return this.paymentStatusResponse(
        purchase,
        plan,
        'FAILED',
        purchase.paymongoStatus,
        {
          recoverable: purchase.paymongoStatus !== 'cancelled',
          message: purchase.failureReason,
        },
      );
    if (purchase.status !== KaraokePassPurchaseStatus.PENDING)
      return this.paymentStatusResponse(
        purchase,
        plan,
        'REVIEW',
        purchase.paymongoStatus,
      );
    if (!purchase.paymongoPaymentIntentId)
      return this.paymentStatusResponse(
        purchase,
        plan,
        'CHECK_UNAVAILABLE',
        null,
        { message: 'Payment status is temporarily unavailable.' },
      );

    let provider: PayMongoPaymentIntentStatus;
    try {
      provider = await this.paymongo.retrievePaymentIntent(
        purchase.paymongoPaymentIntentId,
      );
    } catch (error) {
      this.logger.warn(
        `Payment status check failed for ${purchase.publicReference}: ${this.safeErrorMessage(error)}`,
      );
      return this.paymentStatusResponse(
        purchase,
        plan,
        'CHECK_UNAVAILABLE',
        null,
        { message: 'Payment status is temporarily unavailable.' },
      );
    }

    const providerStatus = provider.status.toLowerCase();
    if (providerStatus === 'succeeded') {
      await this.finalizePaidPurchase({
        purchaseId: purchase.id,
        mode: purchase.paymongoMode,
        paymentId: provider.paymentId || purchase.paymongoPaymentId,
        amount: provider.amountCentavos,
        currency: provider.currency,
      });
      const updated = await this.purchases.findOneByOrFail({ id: purchase.id });
      return this.paymentStatusResponse(
        updated,
        plan,
        updated.status === KaraokePassPurchaseStatus.PAID
          ? 'PAID'
          : updated.status === KaraokePassPurchaseStatus.REVIEW
            ? 'REVIEW'
            : 'PENDING',
        providerStatus,
      );
    }

    if (providerStatus === 'awaiting_payment_method') {
      await this.markFailedPurchase(
        purchase.id,
        provider.paymentId || purchase.paymongoPaymentId,
        providerStatus,
        'Payment was not completed. You can try again.',
      );
      const updated = await this.purchases.findOneByOrFail({ id: purchase.id });
      return this.paymentStatusResponse(
        updated,
        plan,
        'FAILED',
        providerStatus,
        { recoverable: true, message: updated.failureReason },
      );
    }

    if (providerStatus === 'cancelled') {
      await this.markFailedPurchase(
        purchase.id,
        provider.paymentId || purchase.paymongoPaymentId,
        providerStatus,
        'Payment was cancelled before completion.',
      );
      const updated = await this.purchases.findOneByOrFail({ id: purchase.id });
      return this.paymentStatusResponse(
        updated,
        plan,
        'FAILED',
        providerStatus,
        { recoverable: false, message: updated.failureReason },
      );
    }

    const qrExpired = Boolean(
      purchase.qrExpiresAt && purchase.qrExpiresAt <= new Date(),
    );
    return this.paymentStatusResponse(
      purchase,
      plan,
      qrExpired ? 'QR_EXPIRED' : 'PENDING',
      providerStatus,
      qrExpired ? { message: 'This payment QR is no longer valid.' } : undefined,
    );
  }

  async handleWebhook(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
    expectedMode: PayMongoMode,
  ): Promise<{ received: true; ignored?: boolean }> {
    if (expectedMode !== this.paymongo.runtimeConfig.mode)
      throw new ServiceUnavailableException(
        `PayMongo ${expectedMode} webhook route is not active in this environment.`,
      );
    const runtime = getPayMongoRuntimeConfigForMode(this.config, expectedMode);
    if (!runtime.webhookSecret)
      throw new ServiceUnavailableException(
        'Payment webhook verification is not configured.',
      );
    if (
      !this.verifyWebhookSignature(
        rawBody,
        signatureHeader,
        runtime.webhookSecret,
        expectedMode,
      )
    )
      throw new BadRequestException('Invalid PayMongo webhook signature.');
    let body: JsonRecord;
    try {
      body = JSON.parse(
        Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody,
      ) as JsonRecord;
    } catch {
      throw new BadRequestException('Invalid PayMongo webhook JSON.');
    }
    const eventId = this.string(body?.data?.id);
    const attributes = body?.data?.attributes ?? {};
    const eventType = this.string(attributes.type);
    const eventMode = attributes.livemode === true ? 'live' : 'test';
    if (!eventId || !eventType)
      throw new BadRequestException('Invalid PayMongo webhook payload.');
    if (eventMode !== runtime.mode) return { received: true, ignored: true };

    const inserted = await this.recordWebhookEvent(
      eventId,
      eventType,
      eventMode,
    );
    if (!inserted) return { received: true };
    const resource = attributes.data ?? {};
    const paymentAttributes = resource.attributes ?? {};
    const intentId = this.string(paymentAttributes.payment_intent_id);
    const paymentId = this.string(resource.id);
    if (!intentId && !paymentId) {
      await this.setWebhookResult(eventId, 'ignored');
      return { received: true, ignored: true };
    }

    let purchase = intentId
      ? await this.purchases.findOne({
          where: { paymongoPaymentIntentId: intentId, paymongoMode: eventMode },
        })
      : null;
    if (!purchase && paymentId) {
      purchase = await this.purchases.findOne({
        where: { paymongoPaymentId: paymentId, paymongoMode: eventMode },
      });
    }
    if (!purchase && eventType === 'qrph.expired' && paymentId) {
      purchase = await this.purchases.findOne({
        where: { paymongoPaymentMethodId: paymentId, paymongoMode: eventMode },
      });
    }
    if (!purchase) {
      // The merchant account is shared with Obiser. A valid event with no
      // KantaTube mapping is acknowledged but can never grant access.
      await this.setWebhookResult(eventId, 'ignored');
      return { received: true, ignored: true };
    }

    if (eventType === 'payment.paid')
      await this.finalizePaidPurchase(
        {
          purchaseId: purchase.id,
          mode: eventMode,
          paymentId,
          amount: Number(paymentAttributes.amount),
          currency: this.string(paymentAttributes.currency),
        },
        eventId,
      );
    else if (eventType === 'payment.failed')
      await this.markFailedPurchase(
        purchase.id,
        paymentId,
        this.string(paymentAttributes.status),
        'PayMongo reported that the payment failed.',
        eventId,
      );
    else if (eventType === 'qrph.expired')
      await this.markQrExpiredWebhook(eventId, purchase.id);
    else await this.setWebhookResult(eventId, 'ignored');
    return { received: true };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string,
    header: string | undefined,
    secret: string,
    mode: PayMongoMode = this.paymongo.runtimeConfig.mode,
  ): boolean {
    if (!header || !secret) return false;
    const parts: Map<string, string> = new Map(
      header.split(',').map((part) => {
        const separator = part.indexOf('=');
        return [
          part.slice(0, separator).trim(),
          part.slice(separator + 1).trim(),
        ] as const;
      }),
    );
    const timestamp = parts.get('t');
    const provided = mode === 'live' ? parts.get('li') : parts.get('te');
    if (
      !timestamp ||
      !provided ||
      !/^\d+$/.test(timestamp) ||
      !/^[a-f0-9]{64}$/i.test(provided)
    )
      return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    const content = `${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
    const expected = createHmac('sha256', secret).update(content).digest('hex');
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(provided, 'utf8'),
    );
  }

  private async attachQr(
    purchase: KaraokePassPurchase,
    plan: KaraokePassPlan,
  ): Promise<void> {
    const result = await this.paymongo.createQrPayment({
      paymentIntentId: purchase.paymongoPaymentIntentId,
      amountCentavos: purchase.amountCentavos,
      currency: purchase.currency,
      description: `KantaTube - ${plan.name} - ${purchase.publicReference}`,
      metadata: {
        app: 'kantatube',
        purchase_id: purchase.id,
        reference: purchase.publicReference,
        plan_code: plan.code,
      },
    });
    await this.purchases.update(
      { id: purchase.id },
      {
        paymongoPaymentIntentId: result.paymentIntentId,
        paymongoPaymentMethodId: result.paymentMethodId,
        paymongoPaymentId: result.paymentId,
        qrImageUrl: result.qrImageUrl,
        testUrl:
          this.paymongo.runtimeConfig.mode === 'test' ? result.testUrl : null,
        qrExpiresAt: result.qrExpiresAt,
        paymongoStatus: result.status,
        failureReason: null,
      },
    );
  }

  private async finalizePaidPurchase(
    input: {
      purchaseId: string;
      mode: PayMongoMode;
      paymentId: string | null;
      amount: number | null;
      currency: string | null;
    },
    eventId?: string,
  ): Promise<'PAID' | 'REVIEW' | 'NOT_FOUND'> {
    let userId: string | null = null;
    let transitionedToPaid = false;
    let shouldReconcilePaid = false;
    let result: 'PAID' | 'REVIEW' | 'NOT_FOUND' = 'NOT_FOUND';
    await this.dataSource.transaction(async (manager) => {
      const purchases = manager.getRepository(KaraokePassPurchase);
      const entitlements = manager.getRepository(KaraokePassEntitlement);
      const users = manager.getRepository(User);
      const webhookEvents = manager.getRepository(PaymentWebhookEvent);
      const purchase = await purchases.findOne({
        where: { id: input.purchaseId, paymongoMode: input.mode },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchase) return;
      userId = purchase.userId;
      if (purchase.status === KaraokePassPurchaseStatus.PAID) {
        result = 'PAID';
        shouldReconcilePaid = true;
        if (eventId)
          await webhookEvents.update(
            { eventId },
            { handlingResult: 'already_paid' },
          );
        return;
      }
      if (
        input.amount !== purchase.amountCentavos ||
        !input.currency ||
        input.currency.toUpperCase() !== purchase.currency.toUpperCase()
      ) {
        purchase.status = KaraokePassPurchaseStatus.REVIEW;
        purchase.failureReason =
          'PayMongo amount or currency did not match the server-authoritative purchase.';
        purchase.activePendingKey = null;
        await purchases.save(purchase);
        if (eventId)
          await webhookEvents.update({ eventId }, { handlingResult: 'review' });
        result = 'REVIEW';
        return;
      }
      await users.findOne({
        where: { id: purchase.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const plan = resolveKaraokePassPlan(purchase.planCode);
      if (!plan) {
        purchase.status = KaraokePassPurchaseStatus.REVIEW;
        purchase.failureReason = 'Unknown plan code.';
        purchase.activePendingKey = null;
        await purchases.save(purchase);
        if (eventId)
          await webhookEvents.update({ eventId }, { handlingResult: 'review' });
        result = 'REVIEW';
        return;
      }
      const existingEntitlement = await entitlements.findOne({
        where: { purchaseId: purchase.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existingEntitlement) {
        const latest = await entitlements.findOne({
          where: { userId: purchase.userId, expiresAt: MoreThan(new Date()) },
          order: { expiresAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });
        const startsAt =
          latest?.expiresAt && latest.expiresAt > new Date()
            ? latest.expiresAt
            : new Date();
        const expiresAt = addPlanDuration(plan, startsAt);
        await entitlements.save(
          entitlements.create({
            userId: purchase.userId,
            purchaseId: purchase.id,
            planCode: purchase.planCode,
            startsAt,
            expiresAt,
          }),
        );
      }
      purchase.status = KaraokePassPurchaseStatus.PAID;
      purchase.paidAt = purchase.paidAt ?? new Date();
      purchase.paymongoPaymentId = input.paymentId || purchase.paymongoPaymentId;
      purchase.paymongoStatus = 'succeeded';
      purchase.activePendingKey = null;
      purchase.failureReason = null;
      await purchases.save(purchase);
      if (eventId)
        await webhookEvents.update({ eventId }, { handlingResult: 'paid' });
      result = 'PAID';
      transitionedToPaid = true;
      shouldReconcilePaid = true;
    });
    if (userId && shouldReconcilePaid) {
      // Finalize the entitlement first. The usage service changes a current
      // quota-locked session back to ACTIVE, so the next frontend heartbeat
      // receives paid access instead of reloading the locked session. This is
      // intentionally also run for an already-PAID duplicate webhook/poll so
      // an earlier listener failure can recover without a hard refresh.
      await this.access.notifyEntitlementActivated(userId);
      if (transitionedToPaid) await this.emitPurchaseUpdate(input.purchaseId);
    }
    return result;
  }

  private async markFailedPurchase(
    purchaseId: string,
    paymentId: string | null,
    status: string,
    reason: string,
    eventId?: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const purchases = manager.getRepository(KaraokePassPurchase);
      const events = manager.getRepository(PaymentWebhookEvent);
      const purchase = await purchases.findOne({
        where: { id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (purchase && purchase.status === KaraokePassPurchaseStatus.PENDING) {
        purchase.status = KaraokePassPurchaseStatus.FAILED;
        purchase.paymongoPaymentId = paymentId || purchase.paymongoPaymentId;
        purchase.paymongoStatus = status || 'failed';
        purchase.activePendingKey = null;
        purchase.failureReason = reason;
        await purchases.save(purchase);
      }
      if (eventId) await events.update({ eventId }, { handlingResult: 'failed' });
    });
    await this.emitPurchaseUpdate(purchaseId);
  }

  private async markQrExpiredWebhook(
    eventId: string,
    purchaseId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const purchases = manager.getRepository(KaraokePassPurchase);
      const events = manager.getRepository(PaymentWebhookEvent);
      const purchase = await purchases.findOne({
        where: { id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (purchase && purchase.status === KaraokePassPurchaseStatus.PENDING) {
        purchase.qrExpiresAt = new Date(0);
        purchase.qrImageUrl = null;
        await purchases.save(purchase);
      }
      await events.update({ eventId }, { handlingResult: 'qr_expired' });
    });
    await this.emitPurchaseUpdate(purchaseId);
  }

  private async emitPurchaseUpdate(purchaseId: string): Promise<void> {
    const purchase = await this.purchases.findOneBy({ id: purchaseId });
    const plan = purchase ? resolveKaraokePassPlan(purchase.planCode) : null;
    if (!purchase || !plan) return;
    this.events.emit(purchase.userId, {
      purchase: this.toPurchaseResponse(purchase, plan, new Date()),
      access: (await this.access.getSummary(
        purchase.userId,
      )) as unknown as Record<string, unknown>,
    });
  }

  private async recordWebhookEvent(
    eventId: string,
    eventType: string,
    mode: 'test' | 'live',
  ): Promise<boolean> {
    try {
      await this.webhookEvents.insert({
        eventId,
        eventType,
        paymongoMode: mode,
        handlingResult: 'received',
      });
      return true;
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        const existing = await this.webhookEvents.findOne({
          where: { eventId },
        });
        return (
          existing?.handlingResult === 'received' || !existing?.handlingResult
        );
      }
      throw error;
    }
  }

  private async setWebhookResult(
    eventId: string,
    handlingResult: string,
  ): Promise<void> {
    await this.webhookEvents.update({ eventId }, { handlingResult });
  }

  private async findOwnedPurchase(
    userId: string,
    reference: string,
  ): Promise<KaraokePassPurchase> {
    const normalized = typeof reference === 'string' ? reference.trim() : '';
    const purchase = await this.purchases.findOne({
      where: { publicReference: normalized, userId },
    });
    if (!purchase) throw new NotFoundException('Purchase not found.');
    return purchase;
  }

  private toPurchaseResponse(
    purchase: KaraokePassPurchase,
    plan: KaraokePassPlan,
    now: Date,
  ) {
    const qrExpired =
      purchase.status === KaraokePassPurchaseStatus.PENDING &&
      (!purchase.qrExpiresAt ||
        purchase.qrExpiresAt <= now ||
        !purchase.qrImageUrl);
    return {
      purchaseId: purchase.publicReference,
      reference: purchase.publicReference,
      plan: planResponse(plan),
      amount: purchase.amountCentavos / 100,
      currency: purchase.currency,
      status: purchase.status,
      paymongoMode: purchase.paymongoMode,
      qrImage: qrExpired ? null : purchase.qrImageUrl,
      testUrl:
        purchase.paymongoMode === 'test' &&
        purchase.status === KaraokePassPurchaseStatus.PENDING &&
        !qrExpired
          ? purchase.testUrl
          : null,
      qrExpiresAt: purchase.qrExpiresAt?.toISOString() ?? null,
      qrExpired,
      paidAt: purchase.paidAt?.toISOString() ?? null,
      createdAt: purchase.createdAt?.toISOString?.() ?? null,
      failureReason:
        purchase.status === KaraokePassPurchaseStatus.FAILED ||
        purchase.status === KaraokePassPurchaseStatus.REVIEW
          ? purchase.failureReason
          : null,
      serverNow: now.toISOString(),
    };
  }

  private async paymentStatusResponse(
    purchase: KaraokePassPurchase,
    plan: KaraokePassPlan,
    status: PaymentStatusResponse,
    providerStatus: string | null,
    options: { recoverable?: boolean; message?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const current = await this.purchases.findOneByOrFail({ id: purchase.id });
    const response = this.toPurchaseResponse(current, plan, now);
    return {
      purchaseId: current.publicReference,
      status,
      providerStatus,
      qrExpired: status === 'QR_EXPIRED' || response.qrExpired,
      recoverable: options.recoverable ?? false,
      message: options.message ?? null,
      purchase: response,
      access: (await this.access.getSummary(current.userId)) as unknown as Record<
        string,
        unknown
      >,
    };
  }

  private requirePlan(value: unknown): KaraokePassPlan {
    const plan = resolveKaraokePassPlan(value);
    if (!plan)
      throw new BadRequestException(
        'planCode must be one of DAY, WEEK, MONTH, or YEAR.',
      );
    return plan;
  }

  private assertPaymentAvailable(): void {
    if (!this.paymongo.runtimeConfig.available)
      throw new ServiceUnavailableException(
        'Payment setup is not available in this environment yet.',
      );
  }

  private newReference(): string {
    return `KT-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
  }

  private safePage(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0
      ? Math.min(parsed, 10_000)
      : 1;
  }

  private safeLimit(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 20;
  }

  private string(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    return message ? message.slice(0, 180) : 'provider request failed';
  }

  private isDuplicateEntry(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; errno?: unknown };
    return (
      String(candidate.code ?? '') === 'ER_DUP_ENTRY' ||
      String(candidate.code ?? '') === '23505' ||
      String(candidate.errno ?? '') === '1062'
    );
  }
}
