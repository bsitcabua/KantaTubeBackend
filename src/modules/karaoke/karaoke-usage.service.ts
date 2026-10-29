import { ConflictException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  DEFAULT_KARAOKE_USAGE_CONFIG,
  KaraokeUsageConfig,
  parseKaraokeUsageConfig,
} from '../../config/karaoke-config';
import {
  getApplicationDateKey,
  getNextApplicationMidnight,
} from '../../common/date-time/application-date-time';
import { User } from '../users/entities/user.entity';
import { DailyKaraokeUsage } from './entities/daily-karaoke-usage.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import {
  KaraokeSessionResponse,
  KaraokeUsageSummaryResponse,
} from './karaoke-session.types';

interface HostPresence {
  ownerId: string;
  socketIds: Set<string>;
  connected: boolean;
  connectedAt: Date;
  disconnectedAt: Date | null;
  lastAccountedAt: Date;
}

@Injectable()
export class KaraokeUsageService implements OnModuleDestroy {
  private readonly logger = new Logger(KaraokeUsageService.name);
  private readonly usageConfig: KaraokeUsageConfig;
  private readonly presence = new Map<string, HostPresence>();
  private readonly accountingInFlight = new Map<string, Promise<void>>();
  private readonly accountingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DailyKaraokeUsage)
    private readonly usage: Repository<DailyKaraokeUsage>,
    @InjectRepository(KaraokeSession)
    private readonly sessions: Repository<KaraokeSession>,
    private readonly config: ConfigService,
  ) {
    this.usageConfig = parseKaraokeUsageConfig({
      freeDailyKaraokeMinutes: this.config.get('FREE_DAILY_KARAOKE_MINUTES'),
      resetTimezone: this.config.get('FREE_USAGE_RESET_TIMEZONE'),
      usageDisconnectGraceSeconds: this.config.get('USAGE_DISCONNECT_GRACE_SECONDS'),
      allowCurrentSongToFinishAfterLimit: this.config.get('ALLOW_CURRENT_SONG_TO_FINISH_AFTER_LIMIT'),
      maxCurrentSessions: this.config.get('MAX_CURRENT_SESSIONS') ?? this.config.get('MAX_ACTIVE_SESSIONS'),
      usageHeartbeatGapCapSeconds: this.config.get('USAGE_HEARTBEAT_GAP_CAP_SECONDS'),
    });
    this.accountingTimer = setInterval(() => void this.flushPresence(), 20_000);
    this.accountingTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.accountingTimer);
  }

  get configuration(): KaraokeUsageConfig {
    return this.usageConfig;
  }

  /**
   * A persisted session can remain ACTIVE while no browser is currently
   * hosting it.  Session restoration uses this in-memory socket authority to
   * distinguish that resumable state from a genuinely occupied Host slot.
   * Disconnected presence is intentionally not live; it remains in the map
   * only so the existing disconnect-grace accounting can finish.
   */
  hasLiveHost(sessionId: string): boolean {
    return this.hasConnectedHostPresence(sessionId);
  }

  getUsageDate(now = new Date()): string {
    return getApplicationDateKey(now);
  }

  async resolveKaraokeAccess(
    ownerId: string,
    session?: KaraokeSession | null,
    now = new Date(),
  ): Promise<KaraokeUsageSummaryResponse> {
    const usageDate = session?.sessionDay || this.getUsageDate(now);
    const row = await this.usage.findOne({ where: { userId: ownerId, usageDate } });
    return this.toSummary(
      row?.usedSeconds ?? 0,
      usageDate,
      session?.status === KaraokeSessionStatus.LOCKED_QUOTA,
      session?.quotaExhaustionPending ?? false,
      now,
    );
  }

  async assertCanStartNewSession(ownerId: string): Promise<void> {
    const access = await this.resolveKaraokeAccess(ownerId);
    if (!access.canUseKaraoke) {
      throw this.accessDenied(KaraokeSessionStatus.ACTIVE);
    }
  }

  async connectHost(ownerId: string, sessionId: string, socketId: string): Promise<void> {
    const now = new Date();
    const existing = this.presence.get(sessionId);
    if (existing) {
      await this.accountPresence(sessionId, existing, now);
      existing.socketIds.add(socketId);
      existing.connected = true;
      existing.disconnectedAt = null;
    } else {
      this.presence.set(sessionId, {
        ownerId,
        socketIds: new Set([socketId]),
        connected: true,
        connectedAt: now,
        disconnectedAt: null,
        lastAccountedAt: now,
      });
    }
    await this.reconcileSession(ownerId, sessionId, now);
  }

  async disconnectHost(sessionId: string, socketId: string): Promise<void> {
    const current = this.presence.get(sessionId);
    if (!current || !current.socketIds.delete(socketId)) return;
    if (current.socketIds.size > 0) return;
    const now = new Date();
    await this.accountPresence(sessionId, current, now);
    current.connected = false;
    current.disconnectedAt = now;
    current.lastAccountedAt = now;
  }

  async heartbeatHost(ownerId: string, sessionId: string): Promise<void> {
    const current = this.presence.get(sessionId);
    if (!current || current.ownerId !== ownerId || !current.connected) return;
    await this.accountPresence(sessionId, current, new Date());
  }

  async markSongStarted(
    ownerId: string,
    sessionId: string,
    queueItemId?: string,
  ): Promise<KaraokeSessionResponse> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const session = await sessions.findOne({
        where: { id: sessionId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new ConflictException('Karaoke session not found.');
      if (queueItemId) {
        const queueItem = await manager.getRepository(KaraokeQueueItem).findOne({
          where: { id: queueItemId, sessionId },
        });
        if (!queueItem) throw new ConflictException('Queue item does not belong to this karaoke session.');
      }
      if (session.status !== KaraokeSessionStatus.ACTIVE) {
        throw this.accessDenied(session.status);
      }
      const access = await this.resolveWithManager(manager, ownerId, session);
      const canContinueCurrentSong = session.currentSongActive &&
        (!!queueItemId && session.currentQueueItemId === queueItemId) &&
        session.quotaExhaustionPending &&
        access.remainingSeconds === 0 &&
        this.usageConfig.allowCurrentSongToFinishAfterLimit;
      if (!access.canUseKaraoke && !canContinueCurrentSong) throw this.accessDenied(session.status);
      session.hasStartedSong = true;
      session.firstSongStartedAt ??= new Date();
      session.currentSongActive = true;
      session.currentQueueItemId = queueItemId ?? session.currentQueueItemId;
      session.quotaExhaustionPending = canContinueCurrentSong || session.quotaExhaustionPending;
      await sessions.save(session);
      return this.withAccess(session, access);
    });
  }

  async finalizeSong(ownerId: string, sessionId: string): Promise<KaraokeSessionResponse> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queueItems = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id: sessionId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new ConflictException('Karaoke session not found.');
      session.currentSongActive = false;
      session.currentQueueItemId = null;
      await queueItems.update({ sessionId, scoreEligible: true }, { scoreEligible: false });
      const access = await this.resolveWithManager(manager, ownerId, session);
      const today = this.getUsageDate();
      if (
        session.sessionDay &&
        session.sessionDay !== today &&
        [KaraokeSessionStatus.ACTIVE, KaraokeSessionStatus.LOCKED_QUOTA].includes(session.status)
      ) {
        session.status = KaraokeSessionStatus.ENDED;
        session.endedAt = new Date();
        session.quotaExhaustionPending = false;
        await sessions.save(session);
        return this.withAccess(session, access);
      }
      if (session.status === KaraokeSessionStatus.ACTIVE &&
          (!access.canUseKaraoke || session.quotaExhaustionPending)) {
        session.status = KaraokeSessionStatus.LOCKED_QUOTA;
        session.quotaExhaustionPending = false;
        await sessions.save(session);
        this.logger.log(`Session quota locked: ${session.id.slice(0, 8)}…`);
        return this.withAccess(session, {
          ...access,
          quotaLocked: true,
          quotaExhaustionPending: false,
          canUseKaraoke: false,
        });
      }
      await sessions.save(session);
      return this.withAccess(session, access);
    });
  }

  async terminateSong(ownerId: string, sessionId: string): Promise<KaraokeSessionResponse> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queueItems = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id: sessionId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new ConflictException('Karaoke session not found.');

      session.currentSongActive = false;
      session.currentQueueItemId = null;
      session.quotaExhaustionPending = false;
      await queueItems.update({ sessionId, scoreEligible: true }, { scoreEligible: false });

      const access = await this.resolveWithManager(manager, ownerId, session);
      const today = this.getUsageDate();
      if (
        session.sessionDay &&
        session.sessionDay !== today &&
        [KaraokeSessionStatus.ACTIVE, KaraokeSessionStatus.LOCKED_QUOTA].includes(session.status)
      ) {
        session.status = KaraokeSessionStatus.ENDED;
        session.endedAt = new Date();
      } else if (session.status === KaraokeSessionStatus.ACTIVE && access.remainingSeconds === 0) {
        session.status = KaraokeSessionStatus.LOCKED_QUOTA;
        session.endedAt = null;
        this.logger.log(`Session quota locked after song termination: ${session.id.slice(0, 8)}…`);
      }

      await sessions.save(session);
      return this.withAccess(session, session.status === KaraokeSessionStatus.LOCKED_QUOTA
        ? { ...access, quotaLocked: true, quotaExhaustionPending: false, canUseKaraoke: false }
        : access);
    });
  }

  async markSongCompleted(
    ownerId: string,
    sessionId: string,
    queueItemId: string,
  ): Promise<KaraokeSessionResponse> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queueItems = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id: sessionId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new ConflictException('Karaoke session not found.');
      if (session.status !== KaraokeSessionStatus.ACTIVE) {
        throw this.accessDenied(session.status);
      }

      const queueItem = await queueItems.findOne({
        where: { id: queueItemId, sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!queueItem) throw new ConflictException('Queue item does not belong to this karaoke session.');
      if (!session.currentSongActive || session.currentQueueItemId !== queueItemId) {
        throw new ConflictException('The karaoke song was not completed naturally.');
      }

      queueItem.scoreEligible = true;
      await queueItems.save(queueItem);
      const access = await this.resolveWithManager(manager, ownerId, session);
      return this.withAccess(session, access);
    });
  }

  async assertRuntimeAccess(ownerId: string, sessionId: string): Promise<void> {
    await this.rolloverOwner(ownerId);
    const session = await this.sessions.findOne({ where: { id: sessionId, ownerId } });
    if (!session) throw new ConflictException('Karaoke session not found.');
    if (session.status !== KaraokeSessionStatus.ACTIVE) {
      throw session.status === KaraokeSessionStatus.LOCKED_QUOTA
        ? this.accessDenied(session.status)
        : this.notActive(session.status);
    }
    const access = await this.resolveKaraokeAccess(ownerId, session);
    if (!access.canUseKaraoke) throw this.accessDenied(session.status);
  }

  async assertRemoteCommandAccess(
    ownerId: string,
    sessionId: string,
    eventName: string,
  ): Promise<void> {
    await this.rolloverOwner(ownerId);
    const session = await this.sessions.findOne({ where: { id: sessionId, ownerId } });
    if (!session) throw new ConflictException('Karaoke session not found.');
    if (session.status !== KaraokeSessionStatus.ACTIVE && session.status !== KaraokeSessionStatus.LOCKED_QUOTA) {
      throw this.notActive(session.status);
    }
    const access = await this.resolveKaraokeAccess(ownerId, session);
    if (eventName === 'stopAllSong') return;
    const startsOrChangesPlayback = ['playVideo', 'restartVideo', 'reserveSong', 'moveReservedSong', 'removeReservedSong'].includes(eventName);
    if (
      session.status === KaraokeSessionStatus.LOCKED_QUOTA ||
      (!access.canUseKaraoke && !session.quotaExhaustionPending) ||
      (session.quotaExhaustionPending && startsOrChangesPlayback)
    ) {
      throw this.accessDenied(session.status);
    }
  }

  async rolloverOwner(ownerId: string, now = new Date()): Promise<void> {
    const today = this.getUsageDate(now);
    await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queueItems = manager.getRepository(KaraokeQueueItem);
      const candidates = await sessions.find({
        where: { ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      for (const session of candidates) {
        if (![KaraokeSessionStatus.ACTIVE, KaraokeSessionStatus.LOCKED_QUOTA].includes(session.status)) continue;
        const sessionDay = session.sessionDay || this.getUsageDate(session.createdAt);
        if (sessionDay === today) continue;
        // Midnight grace is only for a host that is genuinely still running
        // the current song. A disconnected host returning later must not keep
        // yesterday's session current and block today's allowance.
        if (session.currentSongActive && this.hasConnectedHostPresence(session.id)) continue;
        session.status = KaraokeSessionStatus.ENDED;
        session.endedAt = now;
        session.currentSongActive = false;
        session.currentQueueItemId = null;
        session.quotaExhaustionPending = false;
        await queueItems.update({ sessionId: session.id, scoreEligible: true }, { scoreEligible: false });
        await sessions.save(session);
        this.logger.log(`Daily rollover finalized session: ${session.id.slice(0, 8)}…`);
      }
    });
  }

  private async flushPresence(): Promise<void> {
    for (const [sessionId, presence] of [...this.presence.entries()]) {
      const now = new Date();
      if (presence.connected) {
        await this.accountPresence(sessionId, presence, now);
        continue;
      }
      const disconnectedAt = presence.disconnectedAt?.getTime() ?? now.getTime();
      if (!presence.connected && now.getTime() - disconnectedAt >= this.usageConfig.usageDisconnectGraceSeconds * 1000) {
        await this.accountPresence(sessionId, presence, now);
        if (!presence.connected && presence.socketIds.size === 0) this.presence.delete(sessionId);
      }
    }
  }

  private accountPresence(sessionId: string, presence: HostPresence, now: Date): Promise<void> {
    const previous = this.accountingInFlight.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.accountPresenceNow(sessionId, presence, now));
    this.accountingInFlight.set(sessionId, current);
    return current.finally(() => {
      if (this.accountingInFlight.get(sessionId) === current) {
        this.accountingInFlight.delete(sessionId);
      }
    });
  }

  private async accountPresenceNow(sessionId: string, presence: HostPresence, now: Date): Promise<void> {
    const end = presence.connected
      ? now
      : new Date(Math.min(now.getTime(), (presence.disconnectedAt?.getTime() ?? now.getTime()) + this.usageConfig.usageDisconnectGraceSeconds * 1000));
    const elapsedSeconds = Math.min(
      Math.max(0, Math.floor((end.getTime() - presence.lastAccountedAt.getTime()) / 1000)),
      this.usageConfig.usageHeartbeatGapCapSeconds,
    );
    if (elapsedSeconds <= 0) return;
    await this.accountElapsed(presence.ownerId, sessionId, elapsedSeconds, end);
    presence.lastAccountedAt = end;
  }

  private async accountElapsed(ownerId: string, sessionId: string, seconds: number, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const sessions = manager.getRepository(KaraokeSession);
      const usage = manager.getRepository(DailyKaraokeUsage);
      await users.findOne({ where: { id: ownerId }, lock: { mode: 'pessimistic_write' } });
      const session = await sessions.findOne({ where: { id: sessionId, ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!session || ![KaraokeSessionStatus.ACTIVE].includes(session.status)) return;
      const usageDate = session.sessionDay || this.getUsageDate(now);
      let row = await usage.findOne({ where: { userId: ownerId, usageDate }, lock: { mode: 'pessimistic_write' } });
      if (!row) {
        row = usage.create({ userId: ownerId, usageDate, usedSeconds: 0 });
      }
      const allowance = this.usageConfig.freeDailyKaraokeMinutes * 60;
      row.usedSeconds = Math.min(allowance, Math.max(0, row.usedSeconds + seconds));
      await usage.save(row);
      if (row.usedSeconds >= allowance) {
        if (session.currentSongActive && this.usageConfig.allowCurrentSongToFinishAfterLimit) {
          session.quotaExhaustionPending = true;
        } else {
          session.status = KaraokeSessionStatus.LOCKED_QUOTA;
          session.quotaExhaustionPending = false;
          this.logger.log(`Session quota locked: ${session.id.slice(0, 8)}…`);
        }
        await sessions.save(session);
      }
    });
  }

  private async reconcileSession(ownerId: string, sessionId: string, now: Date): Promise<void> {
    const session = await this.sessions.findOne({ where: { id: sessionId, ownerId } });
    if (!session || session.status !== KaraokeSessionStatus.ACTIVE) return;
    const access = await this.resolveKaraokeAccess(ownerId, session, now);
    if (access.remainingSeconds === 0) {
      await this.dataSource.transaction(async (manager) => {
        const sessions = manager.getRepository(KaraokeSession);
        const locked = await sessions.findOne({ where: { id: sessionId, ownerId }, lock: { mode: 'pessimistic_write' } });
        if (!locked || locked.status !== KaraokeSessionStatus.ACTIVE) return;
        // A reconnect cannot prove that the browser still owns a safely
        // restorable player for the exhausted song. Lock rather than granting
        // a fresh grace window after refresh/reconnect.
        locked.status = KaraokeSessionStatus.LOCKED_QUOTA;
        locked.currentSongActive = false;
        locked.currentQueueItemId = null;
        locked.quotaExhaustionPending = false;
        await sessions.save(locked);
        if (locked.status === KaraokeSessionStatus.LOCKED_QUOTA) {
          this.logger.log(`Session quota locked: ${sessionId.slice(0, 8)}…`);
        }
      });
    }
  }

  private hasConnectedHostPresence(sessionId: string): boolean {
    const presence = this.presence.get(sessionId);
    return !!presence && presence.connected && presence.socketIds.size > 0;
  }

  private async resolveWithManager(manager: EntityManager, ownerId: string, session: KaraokeSession): Promise<KaraokeUsageSummaryResponse> {
    const usage = manager.getRepository(DailyKaraokeUsage);
    const usageDate = session.sessionDay || this.getUsageDate();
    const row = await usage.findOne({ where: { userId: ownerId, usageDate } });
    return this.toSummary(row?.usedSeconds ?? 0, usageDate, session.status === KaraokeSessionStatus.LOCKED_QUOTA, session.quotaExhaustionPending, new Date());
  }

  private toSummary(usedSecondsInput: number, usageDate: string, quotaLocked: boolean, quotaExhaustionPending: boolean, now: Date): KaraokeUsageSummaryResponse {
    const dailyAllowanceSeconds = DEFAULT_KARAOKE_USAGE_CONFIG.freeDailyKaraokeMinutes * 60;
    const allowance = this.usageConfig.freeDailyKaraokeMinutes * 60;
    const usedSeconds = Math.min(allowance, Math.max(0, Number(usedSecondsInput) || 0));
    return {
      usageDate,
      dailyAllowanceSeconds: allowance || dailyAllowanceSeconds,
      usedSeconds,
      remainingSeconds: Math.max(0, allowance - usedSeconds),
      accessSource: 'free',
      quotaLocked,
      quotaExhaustionPending,
      canUseKaraoke: !quotaLocked && !quotaExhaustionPending && usedSeconds < allowance,
      nextResetAt: this.nextResetAt(now),
    };
  }

  private withAccess(session: KaraokeSession, access: KaraokeUsageSummaryResponse): KaraokeSessionResponse {
    return {
      id: session.id,
      alias: session.alias,
      status: session.status,
      lastHeartbeatAt: session.lastHeartbeatAt.toISOString(),
      leaseExpiresAt: session.leaseExpiresAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      usage: access,
    };
  }

  private accessDenied(status: KaraokeSessionStatus): ConflictException {
    return new ConflictException({
      code: 'karaoke_quota_exhausted',
      message: "You've used today's free karaoke time. Your current session is safely saved.",
      status,
    });
  }

  private notActive(status: KaraokeSessionStatus): ConflictException {
    return new ConflictException({
      code: 'karaoke_session_not_active',
      message: 'This karaoke session is no longer active.',
      status,
    });
  }

  private nextResetAt(now: Date): string {
    return getNextApplicationMidnight(now).toISOString();
  }
}
