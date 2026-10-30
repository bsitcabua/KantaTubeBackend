import { KaraokePassService } from './karaoke-pass.service';
import {
  KaraokePassPurchase,
  KaraokePassPurchaseStatus,
} from './entities/karaoke-pass-purchase.entity';
import { KaraokePassEntitlement } from './entities/karaoke-pass-entitlement.entity';
import { User } from '../users/entities/user.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';

function purchase(overrides: Partial<KaraokePassPurchase> = {}): KaraokePassPurchase {
  return {
    id: 'purchase-1',
    publicReference: 'KT-TEST01',
    userId: 'user-1',
    planCode: 'DAY',
    amountCentavos: 5000,
    currency: 'PHP',
    status: KaraokePassPurchaseStatus.PENDING,
    paymongoMode: 'test',
    paymongoPaymentIntentId: 'pi_test_1',
    paymongoPaymentMethodId: 'pm_test_1',
    paymongoPaymentId: null,
    qrImageUrl: 'https://example.test/qr.png',
    testUrl: 'https://example.test/simulate',
    qrExpiresAt: new Date(Date.now() + 300_000),
    paidAt: null,
    failureReason: null,
    paymongoStatus: 'awaiting_next_action',
    activePendingKey: 'user-1:DAY:test',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: undefined as never,
    ...overrides,
  };
}

function checkService(current: KaraokePassPurchase, provider: Record<string, unknown>) {
  const instance = Object.create(KaraokePassService.prototype) as any;
  instance.findOwnedPurchase = jest.fn().mockResolvedValue(current);
  instance.paymongo = { retrievePaymentIntent: jest.fn().mockResolvedValue(provider) };
  instance.paymentStatusResponse = jest.fn(async (row: KaraokePassPurchase, _plan: unknown, status: string, providerStatus: string | null, options?: Record<string, unknown>) => ({
    purchaseId: row.publicReference,
    status,
    providerStatus,
    qrExpired: status === 'QR_EXPIRED',
    recoverable: options?.recoverable ?? false,
    message: options?.message ?? null,
    purchase: row,
    access: { active: false },
  }));
  instance.purchases = { findOneByOrFail: jest.fn().mockResolvedValue(current) };
  instance.access = { notifyEntitlementActivated: jest.fn().mockResolvedValue(undefined) };
  instance.finalizePaidPurchase = jest.fn().mockResolvedValue('PAID');
  instance.markFailedPurchase = jest.fn().mockResolvedValue(undefined);
  instance.logger = { warn: jest.fn() };
  return instance as KaraokePassService;
}

describe('KaraokePassService payment status reconciliation', () => {
  it.each(['awaiting_next_action', 'processing'])('keeps %s pending', async (providerStatus) => {
    const service = checkService(purchase(), {
      status: providerStatus,
      amountCentavos: 5000,
      currency: 'PHP',
      paymentId: null,
    });

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('PENDING');
    expect((service as any).finalizePaidPurchase).not.toHaveBeenCalled();
    expect((service as any).markFailedPurchase).not.toHaveBeenCalled();
  });

  it('finalizes succeeded Payment Intents through the shared finalizer', async () => {
    const current = purchase();
    const updated = purchase({ status: KaraokePassPurchaseStatus.PAID, paymongoStatus: 'succeeded' });
    const service = checkService(current, {
      status: 'succeeded',
      amountCentavos: 5000,
      currency: 'PHP',
      paymentId: 'pay_test_1',
    });
    (service as any).finalizePaidPurchase.mockImplementation(async () => {
      current.status = KaraokePassPurchaseStatus.PAID;
      (service as any).purchases.findOneByOrFail.mockResolvedValue(updated);
      return 'PAID';
    });

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect((service as any).finalizePaidPurchase).toHaveBeenCalledWith({
      purchaseId: current.id,
      mode: 'test',
      paymentId: 'pay_test_1',
      amount: 5000,
      currency: 'PHP',
    });
    expect(result?.status).toBe('PAID');
  });

  it('returns REVIEW when a succeeded provider response has a mismatched amount', async () => {
    const current = purchase();
    const reviewed = purchase({
      status: KaraokePassPurchaseStatus.REVIEW,
      paymongoStatus: 'succeeded',
    });
    const service = checkService(current, {
      status: 'succeeded',
      amountCentavos: 4999,
      currency: 'PHP',
      paymentId: 'pay_test_1',
    });
    (service as any).finalizePaidPurchase.mockImplementation(async () => {
      current.status = KaraokePassPurchaseStatus.REVIEW;
      (service as any).purchases.findOneByOrFail.mockResolvedValue(reviewed);
      return 'REVIEW';
    });

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('REVIEW');
    expect((service as any).finalizePaidPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4999, currency: 'PHP' }),
    );
  });

  it('does not retrieve PayMongo again after a webhook has already made the purchase PAID', async () => {
    const service = checkService(
      purchase({ status: KaraokePassPurchaseStatus.PAID, paymongoStatus: 'succeeded' }),
      { status: 'succeeded', amountCentavos: 5000, currency: 'PHP', paymentId: 'pay_test_1' },
    );

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('PAID');
    expect((service as any).paymongo.retrievePaymentIntent).not.toHaveBeenCalled();
    expect((service as any).access.notifyEntitlementActivated).toHaveBeenCalledWith('user-1');
  });

  it('maps awaiting_payment_method to a retryable failure without granting access', async () => {
    const service = checkService(purchase(), {
      status: 'awaiting_payment_method',
      amountCentavos: 5000,
      currency: 'PHP',
      paymentId: null,
      lastPaymentError: 'provider detail is not exposed',
    });
    (service as any).purchases.findOneByOrFail.mockResolvedValue(
      purchase({ status: KaraokePassPurchaseStatus.FAILED, paymongoStatus: 'awaiting_payment_method' }),
    );

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('FAILED');
    expect(result?.recoverable).toBe(true);
    expect((service as any).markFailedPurchase).toHaveBeenCalled();
  });

  it('maps cancelled to a terminal non-retryable failure', async () => {
    const service = checkService(purchase(), {
      status: 'cancelled',
      amountCentavos: 5000,
      currency: 'PHP',
      paymentId: null,
    });
    (service as any).purchases.findOneByOrFail.mockResolvedValue(
      purchase({ status: KaraokePassPurchaseStatus.FAILED, paymongoStatus: 'cancelled' }),
    );

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('FAILED');
    expect(result?.recoverable).toBe(false);
  });

  it('returns QR_EXPIRED only after provider status is not successful', async () => {
    const service = checkService(
      purchase({ qrExpiresAt: new Date(Date.now() - 1_000) }),
      { status: 'awaiting_next_action', amountCentavos: 5000, currency: 'PHP', paymentId: null },
    );

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('QR_EXPIRED');
  });

  it('keeps the purchase pending when PayMongo status retrieval is temporarily unavailable', async () => {
    const service = checkService(purchase(), { status: 'awaiting_next_action' });
    (service as any).paymongo.retrievePaymentIntent.mockRejectedValue(new Error('timeout'));

    const result = await service.checkPaymentStatus('user-1', 'KT-TEST01');

    expect(result?.status).toBe('CHECK_UNAVAILABLE');
    expect((service as any).logger.warn).toHaveBeenCalled();
  });

  it('does not call PayMongo when ownership lookup rejects the purchase', async () => {
    const service = checkService(purchase(), { status: 'succeeded' });
    const provider = (service as any).paymongo.retrievePaymentIntent;
    (service as any).findOwnedPurchase.mockRejectedValue(new Error('Purchase not found.'));

    await expect(service.checkPaymentStatus('user-1', 'KT-OTHER')).rejects.toThrow('Purchase not found.');
    expect(provider).not.toHaveBeenCalled();
  });

  it('creates one entitlement when a poll and webhook race to finalize the same purchase', async () => {
    const current = purchase();
    const entitlementRepository = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      save: jest.fn(),
      create: jest.fn((value) => value),
    };
    const purchaseRepository = {
      findOne: jest.fn().mockResolvedValue(current),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const userRepository = { findOne: jest.fn().mockResolvedValue({ id: current.userId }) };
    const webhookRepository = { update: jest.fn() };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === KaraokePassPurchase) return purchaseRepository;
        if (entity === KaraokePassEntitlement) return entitlementRepository;
        if (entity === User) return userRepository;
        if (entity === PaymentWebhookEvent) return webhookRepository;
        return entitlementRepository;
      },
    };
    const service = Object.create(KaraokePassService.prototype) as any;
    service.dataSource = { transaction: async (callback: (value: unknown) => Promise<void>) => callback(manager) };
    service.purchases = purchaseRepository;
    service.access = { notifyEntitlementActivated: jest.fn().mockResolvedValue(undefined) };
    service.emitPurchaseUpdate = jest.fn();

    const firstResult = await service.finalizePaidPurchase({
      purchaseId: current.id,
      mode: 'test',
      paymentId: 'pay_test_1',
      amount: 5000,
      currency: 'PHP',
    });
    current.status = KaraokePassPurchaseStatus.PAID;
    const secondResult = await service.finalizePaidPurchase({
      purchaseId: current.id,
      mode: 'test',
      paymentId: 'pay_test_1',
      amount: 5000,
      currency: 'PHP',
    });

    expect(firstResult).toBe('PAID');
    expect(secondResult).toBe('PAID');
    expect(entitlementRepository.save).toHaveBeenCalledTimes(1);
    expect(service.access.notifyEntitlementActivated).toHaveBeenCalledTimes(2);
  });
});
