import 'dotenv/config';

import { ConfigService } from '@nestjs/config';
import { DataSource, MoreThan } from 'typeorm';
import dataSource from '../database/data-source';
import {
  APPLICATION_TIME_ZONE,
  getApplicationDateKey,
} from '../common/date-time/application-date-time';
import {
  DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
  parseMaxKaraokeQueueSize,
} from '../config/karaoke-config';
import { KaraokeQueueItem } from '../modules/karaoke/entities/karaoke-queue-item.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from '../modules/karaoke/entities/karaoke-session.entity';
import { KaraokeSessionPerformer } from '../modules/karaoke/entities/karaoke-session-performer.entity';
import { DailyKaraokeUsage } from '../modules/karaoke/entities/daily-karaoke-usage.entity';
import { KaraokeUsageService } from '../modules/karaoke/karaoke-usage.service';
import { User } from '../modules/users/entities/user.entity';
import { KaraokePassAccessService } from '../modules/karaoke-pass/karaoke-pass-access.service';
import { KaraokePassEntitlement } from '../modules/karaoke-pass/entities/karaoke-pass-entitlement.entity';
import {
  KaraokePassPurchase,
  KaraokePassPurchaseStatus,
} from '../modules/karaoke-pass/entities/karaoke-pass-purchase.entity';
import { resolveKaraokePassPlan } from '../modules/karaoke-pass/karaoke-pass.catalog';
import { getPayMongoRuntimeConfig } from '../modules/karaoke-pass/karaoke-pass.config';

const DEFAULT_TEST_ACCOUNT = 'emcabua@gmail.com';
const MAX_DISPLAYED_PURCHASES = 25;

type EffectiveAccess = 'PAID_ACCESS' | 'FREE_ACCESS' | 'LOCKED_QUOTA';

class AuditReport {
  readonly lines: string[] = [];
  passCount = 0;
  warningCount = 0;
  failCount = 0;

  pass(message: string): void {
    this.passCount += 1;
    this.lines.push(`✅ ${message}`);
  }

  warn(message: string): void {
    this.warningCount += 1;
    this.lines.push(`⚠ WARN ${message}`);
  }

  fail(message: string): void {
    this.failCount += 1;
    this.lines.push(`❌ FAIL ${message}`);
  }

  info(message: string): void {
    this.lines.push(message);
  }
}

function readUserArgument(argv: string[]): string {
  const inline = argv.find((argument) => argument.startsWith('--user='));
  if (inline)
    return inline.slice('--user='.length).trim() || DEFAULT_TEST_ACCOUNT;

  const index = argv.indexOf('--user');
  if (index >= 0 && argv[index + 1]) return argv[index + 1].trim();
  return DEFAULT_TEST_ACCOUNT;
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'invalid date';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: APPLICATION_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMoney(amountCentavos: number, currency: string): string {
  const amount = amountCentavos / 100;
  return `${currency} ${amount.toFixed(2)}`;
}

function formatPlan(planCode: string | null | undefined): string {
  const plan = planCode ? resolveKaraokePassPlan(planCode) : undefined;
  return plan?.name ?? (planCode ? `${planCode} Pass` : 'None');
}

function effectiveAccessFromUsage(usage: {
  accessSource: 'free' | 'paid';
  remainingSeconds: number;
  canUseKaraoke: boolean;
}): EffectiveAccess {
  if (usage.accessSource === 'paid') return 'PAID_ACCESS';
  if (usage.canUseKaraoke && usage.remainingSeconds > 0) return 'FREE_ACCESS';
  return 'LOCKED_QUOTA';
}

function getActivePlanMaxQueue(
  planCode: string | null | undefined,
  config: ConfigService,
): number {
  const plan = planCode ? resolveKaraokePassPlan(planCode) : undefined;
  return (
    (plan?.maxQueueSongs ??
      parseMaxKaraokeQueueSize(config.get<string>('MAX_KARAOKE_QUEUE_SIZE'))) ||
    DEFAULT_MAX_KARAOKE_QUEUE_SIZE
  );
}

function checkEntitlementChain(
  report: AuditReport,
  entitlements: KaraokePassEntitlement[],
  now: Date,
): void {
  const relevant = entitlements
    .filter((row) => row.expiresAt > now)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

  const invalidRanges = relevant.filter(
    (row) =>
      !Number.isFinite(row.startsAt?.getTime()) ||
      !Number.isFinite(row.expiresAt?.getTime()) ||
      row.startsAt >= row.expiresAt,
  );
  if (invalidRanges.length > 0) {
    report.fail(
      `${invalidRanges.length} active/scheduled entitlement(s) have an invalid date range.`,
    );
  }

  const purchaseIds = new Set<string>();
  const duplicatePurchases = relevant.filter((row) => {
    if (purchaseIds.has(row.purchaseId)) return true;
    purchaseIds.add(row.purchaseId);
    return false;
  });
  if (duplicatePurchases.length > 0) {
    report.fail(
      `${duplicatePurchases.length} duplicate active/scheduled entitlement reference(s) detected.`,
    );
  }

  let hasGap = false;
  let hasOverlap = false;
  for (let index = 1; index < relevant.length; index += 1) {
    const previous = relevant[index - 1];
    const current = relevant[index];
    if (current.startsAt > previous.expiresAt) hasGap = true;
    if (current.startsAt < previous.expiresAt) hasOverlap = true;
  }

  if (hasGap) report.fail('Active/scheduled entitlement chain contains a gap.');
  else
    report.pass('Stacking: no gaps in the active/scheduled entitlement chain.');
  if (hasOverlap)
    report.fail('Active/scheduled entitlement chain contains an overlap.');
  else
    report.pass(
      'Stacking: no overlaps in the active/scheduled entitlement chain.',
    );
}

async function runPreflight(
  source: DataSource,
  requestedEmail: string,
): Promise<number> {
  const report = new AuditReport();
  const config = new ConfigService();
  const now = new Date();
  const users = source.getRepository(User);
  const sessions = source.getRepository(KaraokeSession);
  const queueItems = source.getRepository(KaraokeQueueItem);
  const performers = source.getRepository(KaraokeSessionPerformer);
  const usageRows = source.getRepository(DailyKaraokeUsage);
  const purchases = source.getRepository(KaraokePassPurchase);
  const entitlements = source.getRepository(KaraokePassEntitlement);
  const passAccess = new KaraokePassAccessService(entitlements);
  const usage = new KaraokeUsageService(
    source,
    usageRows,
    sessions,
    config,
    passAccess,
  );

  try {
    report.info('============================================================');
    report.info(' KANTATUBE ACCESS + PAYMENT PREFLIGHT');
    report.info('============================================================');
    report.info('');
    report.info('Test Account');
    report.info(requestedEmail);

    const normalizedEmail = requestedEmail.trim().toLowerCase();
    const user = await users.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      report.fail(`TEST ACCOUNT NOT FOUND: ${requestedEmail}`);
      report.info('');
      report.info(`PASS: ${report.passCount}`);
      report.info(`WARN: ${report.warningCount}`);
      report.info(`FAIL: ${report.failCount}`);
      console.log(report.lines.join('\n'));
      return 1;
    }
    report.pass('Test account found');
    report.info(`User ID: ${shortId(user.id)}`);
    report.info(`Email: ${user.email ?? requestedEmail}`);
    report.info(`Status: ${user.status}`);
    report.info('');

    const currentSessions = await sessions.find({
      where: [
        {
          ownerId: user.id,
          status: KaraokeSessionStatus.ACTIVE,
          leaseExpiresAt: MoreThan(now),
        },
        { ownerId: user.id, status: KaraokeSessionStatus.LOCKED_QUOTA },
      ],
      order: { createdAt: 'ASC' },
    });
    report.info('Session');
    if (currentSessions.length <= 1)
      report.pass('At most one current/resumable session');
    else
      report.fail(
        `Found ${currentSessions.length} current/resumable sessions.`,
      );
    if (currentSessions.length === 0) {
      report.info('No current/resumable session');
    }

    for (const session of currentSessions) {
      const [queueCount, performerCount, currentQueueItem] = await Promise.all([
        queueItems.count({ where: { sessionId: session.id } }),
        performers.count({ where: { sessionId: session.id } }),
        session.currentQueueItemId
          ? queueItems.findOne({
              where: { id: session.currentQueueItemId, sessionId: session.id },
            })
          : Promise.resolve(null),
      ]);
      report.info(`sessionId: ${shortId(session.id)}`);
      report.info(`status: ${session.status}`);
      report.info(
        `startedAt: ${formatDate(session.createdAt)} (session createdAt)`,
      );
      report.info(`queue count: ${queueCount}`);
      report.info(`performer count: ${performerCount}`);
      report.info(`current queue item: ${currentQueueItem?.title ?? 'none'}`);
      if (session.currentQueueItemId && !currentQueueItem) {
        report.fail(
          `Session ${shortId(session.id)} references a missing current queue item.`,
        );
      }
    }
    report.info('');

    const usageDate = usage.getUsageDate(now);
    const usageRow = await usageRows.findOne({
      where: { userId: user.id, usageDate },
    });
    const dailyAllowanceSeconds =
      usage.configuration.freeDailyKaraokeMinutes * 60;
    const usedSeconds = Number(usageRow?.usedSeconds ?? 0);
    const validUsage =
      Number.isSafeInteger(usedSeconds) &&
      usedSeconds >= 0 &&
      usedSeconds <= dailyAllowanceSeconds;
    const remainingSeconds = Math.max(0, dailyAllowanceSeconds - usedSeconds);
    report.info('Daily Free');
    report.info(`usage date: ${usageDate} (${APPLICATION_TIME_ZONE})`);
    report.info(
      `configured daily limit: ${formatDuration(dailyAllowanceSeconds)}`,
    );
    report.info(`used seconds: ${usedSeconds}`);
    report.info(`remaining seconds: ${remainingSeconds}`);
    if (validUsage)
      report.pass(
        `Daily Free usage is within 0-${dailyAllowanceSeconds} seconds.`,
      );
    else
      report.fail(
        'Daily Free usage is outside the configured daily allowance.',
      );
    report.info(
      `Daily Free: ${formatDuration(remainingSeconds)} remaining of ${formatDuration(dailyAllowanceSeconds)} today`,
    );
    report.info('');

    const access = await passAccess.getSummary(user.id, now);
    const allEntitlements = await entitlements.find({
      where: { userId: user.id },
      order: { startsAt: 'ASC' },
    });
    const scheduledEntitlements = allEntitlements.filter(
      (row) => row.startsAt > now && row.expiresAt > now,
    );
    report.info('Paid Access');
    if (access.active && access.current) {
      report.pass(`${access.current.planName} active`);
      report.info(`startsAt: ${formatDate(access.current.startsAt)}`);
      report.info(`expiresAt: ${formatDate(access.current.expiresAt)}`);
      report.info(
        `current remaining duration: ${formatDuration(access.remainingSeconds)}`,
      );
      report.pass(
        `${scheduledEntitlements.length} scheduled extension(s) found`,
      );
      report.info(`resolver chain scheduled: ${access.scheduled.length}`);
      report.info(`paid access until: ${formatDate(access.accessUntil)}`);
      report.info(
        `total paid-access remaining: ${formatDuration(access.remainingSeconds)}`,
      );
    } else {
      report.info('No active paid Pass');
      report.pass('No active paid entitlement');
      report.info(
        `scheduled future entitlement(s): ${scheduledEntitlements.length}`,
      );
    }

    for (const scheduled of scheduledEntitlements) {
      report.info(
        `scheduled: ${formatPlan(scheduled.planCode)} | ${formatDate(scheduled.startsAt)} → ${formatDate(scheduled.expiresAt)}`,
      );
    }
    checkEntitlementChain(report, allEntitlements, now);
    report.info('');

    const sessionForAccess = currentSessions[0] ?? undefined;
    const resolvedUsage = await usage.resolveKaraokeAccess(
      user.id,
      sessionForAccess,
      now,
    );
    const effectiveAccess = effectiveAccessFromUsage(resolvedUsage);
    report.info('Effective Access');
    report.info(`Effective Access: ${effectiveAccess}`);
    const expectedAccess: EffectiveAccess = access.active
      ? 'PAID_ACCESS'
      : remainingSeconds > 0
        ? 'FREE_ACCESS'
        : 'LOCKED_QUOTA';
    if (effectiveAccess === expectedAccess)
      report.pass(`Effective access matches ${expectedAccess} priority.`);
    else
      report.fail(`Expected ${expectedAccess}, received ${effectiveAccess}.`);

    if (access.active) {
      if (effectiveAccess === 'PAID_ACCESS')
        report.pass('Paid access overrides Daily Free.');
      else
        report.fail(
          'Active paid Pass exists but effective access is not PAID_ACCESS.',
        );
      if (resolvedUsage.accessSource === 'paid')
        report.pass(
          'Daily Free preservation: paid Pass is the current access source.',
        );
      else
        report.fail(
          'Daily Free preservation failed: resolver selected the free access source while a Pass is active.',
        );
    } else {
      report.pass(
        'No paid Pass is active, so Daily Free remains the access source when allowance is available.',
      );
    }

    if (
      sessionForAccess?.status === KaraokeSessionStatus.LOCKED_QUOTA &&
      effectiveAccess === 'PAID_ACCESS'
    ) {
      report.warn(
        'Persisted session status is LOCKED_QUOTA, but centralized access correctly overrides it with PAID_ACCESS.',
      );
    } else if (
      sessionForAccess?.status === KaraokeSessionStatus.LOCKED_QUOTA &&
      effectiveAccess === 'LOCKED_QUOTA'
    ) {
      report.pass('Session quota lock agrees with effective access.');
    } else if (sessionForAccess && effectiveAccess === 'LOCKED_QUOTA') {
      report.warn(
        'Current session has no effective access and may require the normal quota reconciliation path.',
      );
    } else if (sessionForAccess) {
      report.pass('Current session is consistent with effective access.');
    }
    report.info('');

    const purchaseRows = await purchases.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    const purchaseById = new Map(purchaseRows.map((row) => [row.id, row]));
    report.info(`Purchases (${purchaseRows.length} total)`);
    for (const purchase of purchaseRows.slice(0, MAX_DISPLAYED_PURCHASES)) {
      const plan = resolveKaraokePassPlan(purchase.planCode);
      report.info(
        `${purchase.publicReference} | ${plan?.name ?? purchase.planCode} | ${formatMoney(purchase.amountCentavos, purchase.currency)} | ${purchase.status} | ${purchase.paymongoMode.toUpperCase()} | created ${formatDate(purchase.createdAt)} | paid ${formatDate(purchase.paidAt)}`,
      );
    }
    if (purchaseRows.length > MAX_DISPLAYED_PURCHASES) {
      report.info(
        `... ${purchaseRows.length - MAX_DISPLAYED_PURCHASES} older purchase(s) omitted from display.`,
      );
    }
    if (purchaseRows.length === 0) report.info('No purchase records found.');

    let purchaseIntegrityOk = true;
    for (const purchase of purchaseRows) {
      const plan = resolveKaraokePassPlan(purchase.planCode);
      if (!plan) {
        purchaseIntegrityOk = false;
        report.fail(
          `${purchase.publicReference} references an unknown plan ${purchase.planCode}.`,
        );
        continue;
      }
      if (
        purchase.amountCentavos !== plan.amountCentavos ||
        purchase.currency.toUpperCase() !== plan.currency
      ) {
        purchaseIntegrityOk = false;
        report.fail(
          `${purchase.publicReference} does not match the current ${plan.name} catalog price/currency.`,
        );
      }
    }
    if (purchaseIntegrityOk)
      report.pass(
        'Purchase amounts and currencies match the current backend plan catalog.',
      );

    let paidPurchaseIntegrityOk = true;
    for (const purchase of purchaseRows.filter(
      (row) => row.status === KaraokePassPurchaseStatus.PAID,
    )) {
      const count = allEntitlements.filter(
        (row) => row.purchaseId === purchase.id,
      ).length;
      if (count !== 1) {
        paidPurchaseIntegrityOk = false;
        report.fail(
          `${purchase.publicReference} is PAID but has ${count} entitlement(s); expected exactly one.`,
        );
      }
    }
    if (paidPurchaseIntegrityOk)
      report.pass('Each PAID purchase has exactly one entitlement.');

    let entitlementIntegrityOk = true;
    for (const entitlement of allEntitlements) {
      const purchase = purchaseById.get(entitlement.purchaseId);
      if (!purchase || purchase.status !== KaraokePassPurchaseStatus.PAID) {
        entitlementIntegrityOk = false;
        report.fail(
          `Entitlement ${shortId(entitlement.id)} does not reference a PAID purchase.`,
        );
      }
    }
    if (entitlementIntegrityOk)
      report.pass('Each entitlement references an existing PAID purchase.');
    report.info('');

    const pending = purchaseRows.filter(
      (row) => row.status === KaraokePassPurchaseStatus.PENDING,
    );
    const activePending = pending.filter(
      (row) => row.activePendingKey !== null,
    );
    const stalePending = pending.filter(
      (row) => row.qrExpiresAt !== null && row.qrExpiresAt <= now,
    );
    const historicalPending = pending.filter(
      (row) => row.activePendingKey === null,
    );
    const superseded = purchaseRows.filter(
      (row) => row.status === KaraokePassPurchaseStatus.SUPERSEDED,
    );
    report.info('Checkout');
    report.info(`active pending checkout(s): ${activePending.length}`);
    report.info(`expired/stale pending checkout(s): ${stalePending.length}`);
    report.info(`historical pending attempt(s): ${historicalPending.length}`);
    report.info(`superseded checkout(s): ${superseded.length}`);
    if (activePending.length <= 1)
      report.pass('Maximum one active pending checkout.');
    else
      report.fail(
        `Found ${activePending.length} simultaneously active pending checkouts.`,
      );
    if (stalePending.length > 0)
      report.warn(
        `${stalePending.length} old QR-based purchase(s) remain PENDING after expiry; no state was changed.`,
      );
    if (
      activePending.length > 0 &&
      activePending.some(
        (row) => row.paymongoMode !== getPayMongoRuntimeConfig(config).mode,
      )
    ) {
      report.warn(
        'An active pending checkout uses a different PayMongo mode than the current runtime mode.',
      );
    }
    report.info('');

    const runtime = getPayMongoRuntimeConfig(config);
    report.info('Payment Environment');
    report.info(`mode: ${runtime.mode.toUpperCase()}`);
    if (runtime.mode === 'live')
      report.warn(
        'LIVE PayMongo configuration is active. No payment operation was performed.',
      );
    else
      report.pass(
        'TEST PayMongo environment is active for development verification.',
      );

    const queueMax = getActivePlanMaxQueue(
      access.current?.planCode ?? access.planCode,
      config,
    );
    report.info('');
    report.info('Queue');
    report.info(`configured queue max: ${queueMax}`);
    if (sessionForAccess) {
      const queueCount = await queueItems.count({
        where: { sessionId: sessionForAccess.id },
      });
      report.info(`queue count: ${queueCount}`);
      if (queueCount <= queueMax)
        report.pass('Current queue is within configured capacity.');
      else
        report.fail(
          `Current queue count ${queueCount} exceeds configured capacity ${queueMax}.`,
        );
    } else {
      report.info('No current session queue to inspect.');
    }

    report.info('');
    report.info('============================================================');
    report.info(`PASS: ${report.passCount}`);
    report.info(`WARN: ${report.warningCount}`);
    report.info(`FAIL: ${report.failCount}`);
    report.info('');
    report.info(
      report.failCount === 0
        ? '✅ ACCESS/PAYMENT PREFLIGHT: PASS'
        : '❌ ACCESS/PAYMENT PREFLIGHT: FAIL',
    );
    report.info('============================================================');
    console.log(report.lines.join('\n'));
    return report.failCount === 0 ? 0 : 1;
  } finally {
    usage.onModuleDestroy();
  }
}

async function main(): Promise<void> {
  const requestedEmail = readUserArgument(process.argv.slice(2));
  let initialized = false;
  try {
    await dataSource.initialize();
    initialized = true;
    const exitCode = await runPreflight(dataSource, requestedEmail);
    process.exitCode = exitCode;
  } catch {
    console.log('============================================================');
    console.log(' KANTATUBE ACCESS + PAYMENT PREFLIGHT');
    console.log('============================================================');
    console.log(
      `❌ FAIL Unable to complete the read-only preflight for ${requestedEmail}.`,
    );
    console.log(
      'The database or required configuration could not be read. No payment or session operation was attempted.',
    );
    console.log('');
    console.log('PASS: 0');
    console.log('WARN: 0');
    console.log('FAIL: 1');
    console.log('');
    console.log('❌ ACCESS/PAYMENT PREFLIGHT: FAIL');
    process.exitCode = 1;
  } finally {
    if (initialized && dataSource.isInitialized) await dataSource.destroy();
  }
}

void main();
