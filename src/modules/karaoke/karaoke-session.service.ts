import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { createHash } from 'crypto';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokeSessionResponse } from './karaoke-session.types';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionPerformer } from './entities/karaoke-session-performer.entity';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';
import { KaraokeUsageService } from './karaoke-usage.service';
import { getApplicationDateKey } from '../../common/date-time/application-date-time';
import {
  KaraokeGuestSessionClaimResponse,
  KaraokeQueueItemResponse,
  KaraokeSessionTransferResponse,
} from './karaoke-session.types';

@Injectable()
export class KaraokeSessionService implements OnModuleInit, OnModuleDestroy {
  static readonly defaultMaxActiveSessions = 1;
  static readonly defaultLeaseSeconds = 120;

  private readonly maxActiveSessions: number;
  private readonly leaseMs: number;
  private readonly logger = new Logger(KaraokeSessionService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(KaraokeSession)
    private readonly sessions: Repository<KaraokeSession>,
    @InjectRepository(KaraokeQueueItem)
    private readonly queueItems: Repository<KaraokeQueueItem>,
    private readonly config: ConfigService,
    @Optional()
    private readonly usage?: KaraokeUsageService,
  ) {
    const configuredMaximum = Number(
      this.usage?.configuration?.maxCurrentSessions ??
        this.config.get<string>('MAX_CURRENT_SESSIONS') ??
        this.config.get<string>('MAX_ACTIVE_SESSIONS'),
    );
    this.maxActiveSessions =
      Number.isInteger(configuredMaximum) && configuredMaximum > 0
        ? configuredMaximum
        : KaraokeSessionService.defaultMaxActiveSessions;

    const configuredSeconds = Number(
      this.config.get<string>('KARAOKE_SESSION_LEASE_SECONDS'),
    );
    const leaseSeconds = Number.isFinite(configuredSeconds)
      ? Math.min(Math.max(Math.floor(configuredSeconds), 30), 3600)
      : KaraokeSessionService.defaultLeaseSeconds;
    this.leaseMs = leaseSeconds * 1000;
  }

  onModuleInit(): void {
    void this.cleanupExpiredSessions();
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredSessions(),
      30_000,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async cleanupExpiredSessions(): Promise<void> {
    try {
      await this.dataSource.transaction((manager) =>
        this.expireStaleWithManager(manager),
      );
    } catch (error) {
      this.logger.warn(
        `Unable to clean up expired karaoke sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async create(
    ownerId: string,
    aliasInput: unknown,
    clientIdInput?: unknown,
    resumeExisting = false,
  ): Promise<KaraokeSessionResponse> {
    const alias = this.normalizeAlias(aliasInput);
    const clientId = this.normalizeClientId(clientIdInput);
    await this.usage?.rolloverOwner(ownerId);
    await this.usage?.assertCanStartNewSession(ownerId);
    const created =
      await this.dataSource.transaction<KaraokeSession | null>(
        async (manager) => {
          const users = manager.getRepository(User);
          const sessions = manager.getRepository(KaraokeSession);

          // Locking the owner row serializes all creation attempts for the same
          // account, including when it currently has no karaoke session rows.
          const owner = await users.findOne({
            where: { id: ownerId, status: UserStatus.ACTIVE },
            lock: { mode: 'pessimistic_write' },
          });
          if (!owner) throw new NotFoundException('User not found.');

          const now = new Date();
          await this.expireStaleWithManager(manager, ownerId, undefined, now);

          const currentSessions = await sessions.find({
            where: [
              {
                ownerId,
                status: KaraokeSessionStatus.ACTIVE,
                leaseExpiresAt: MoreThan(now),
              },
              { ownerId, status: KaraokeSessionStatus.LOCKED_QUOTA },
            ],
            order: { createdAt: 'ASC' },
          });
          if (currentSessions.length > 0) {
            const canonical = await this.selectCanonicalCurrentSession(
              manager,
              currentSessions,
            );
            await this.finalizeDuplicateCurrentSessions(
              manager,
              currentSessions,
              canonical,
              now,
            );

            if (this.hasOccupiedHostSlot(canonical.id)) {
              // A live Host is never implicitly replaced by a bootstrap or a
              // named-session request. The caller must use the explicit
              // transfer flow to move authority.
              return null;
            }

            // The bootstrap request may come from a new tab/device. Reuse and
            // claim the durable current session instead of creating a second
            // current row, even when the caller did not send resumeExisting.
            if (canonical.status === KaraokeSessionStatus.ACTIVE) {
              this.assertClientOwnership(canonical, clientId, true);
              canonical.lastHeartbeatAt = now;
              canonical.leaseExpiresAt = this.nextLease(now);
              return sessions.save(canonical);
            }
            return canonical;
          }

          const session = sessions.create({
            ownerId,
            alias,
            status: KaraokeSessionStatus.ACTIVE,
            sessionDay: this.sessionDay(now),
            lastHeartbeatAt: now,
            leaseExpiresAt: this.nextLease(now),
            clientId,
            endedAt: null,
            hasStartedSong: false,
            firstSongStartedAt: null,
            currentSongActive: false,
            currentQueueItemId: null,
            quotaExhaustionPending: false,
          });
          const saved = await sessions.save(session);
          return saved;
        },
      );
    if (!created) throw this.sessionLimitException();
    return this.toResponseWithUsage(ownerId, created);
  }

  async listActive(ownerId: string): Promise<KaraokeSessionResponse[]> {
    // A day boundary takes precedence over the normal lease cleanup.  If an
    // old ACTIVE session is expired first, it can no longer be finalized as a
    // previous-day session (and will miss the same history lifecycle as an
    // old quota-locked session).
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId);
    const now = new Date();
    const sessions = await this.sessions.find({
      where: [
        { ownerId, status: KaraokeSessionStatus.ACTIVE, leaseExpiresAt: MoreThan(now) },
        { ownerId, status: KaraokeSessionStatus.LOCKED_QUOTA },
      ],
      order: { createdAt: 'ASC' },
    });
    const reconciledSessions =
      sessions.length > 1
        ? await this.reconcileCurrentSessions(ownerId)
        : sessions;
    return Promise.all(
      this.sessionsForBootstrap(reconciledSessions).map((session) =>
        this.toResponseWithUsage(ownerId, session, true),
      ),
    );
  }

  async listHistory(ownerId: string, limit = 25): Promise<KaraokeSessionResponse[]> {
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId);
    const sessions = await this.sessions.find({
      where: {
        ownerId,
        status: In([KaraokeSessionStatus.ENDED, KaraokeSessionStatus.EXPIRED]),
        hasStartedSong: true,
      },
      order: { endedAt: 'DESC', createdAt: 'DESC' },
      take: Math.min(Math.max(Math.floor(limit), 1), 100),
    });
    return sessions.map((session) => this.toResponse(session));
  }

  async getHistorySession(ownerId: string, id: string): Promise<KaraokeSessionResponse> {
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId);
    const session = await this.sessions.findOne({ where: { id, ownerId } });
    if (!session) throw new NotFoundException('Karaoke session not found.');
    if ([KaraokeSessionStatus.ACTIVE, KaraokeSessionStatus.LOCKED_QUOTA].includes(session.status)) {
      throw new ConflictException('The active karaoke session is not in session history.');
    }
    return this.toResponse(session);
  }

  /**
   * Upgrade an anonymous host into an account-owned session in place. The
   * guest host UUID becomes the karaoke session UUID, so queue identity and
   * remote routing do not pass through a second session.
   */
  async claimGuest(
    ownerId: string,
    hostSessionIdInput: unknown,
    hostTokenInput: unknown,
    clientIdInput: unknown,
    queueInput: unknown,
    performersInput: unknown,
    aliasInput?: unknown,
    replaceSessionIdInput?: unknown,
  ): Promise<KaraokeGuestSessionClaimResponse> {
    const hostSessionId = this.requiredUuid(hostSessionIdInput, 'sessionId');
    const hostToken = this.requiredToken(hostTokenInput, 'hostToken');
    const clientId = this.normalizeClientId(clientIdInput);
    if (!clientId) throw new BadRequestException('clientId must be a UUID.');
    const queue = this.normalizeQueue(queueInput);
    const performers = this.normalizePerformers(performersInput);
    const alias = aliasInput === undefined
      ? 'Karaoke session'
      : this.normalizeAlias(aliasInput);
    const replaceSessionId = replaceSessionIdInput === undefined || replaceSessionIdInput === null || replaceSessionIdInput === ''
      ? null
      : this.requiredUuid(replaceSessionIdInput, 'replaceSessionId');

    await this.usage?.rolloverOwner(ownerId);
    await this.usage?.assertCanStartNewSession(ownerId);

    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const sessions = manager.getRepository(KaraokeSession);
      const queueRepository = manager.getRepository(KaraokeQueueItem);
      const performerRepository = manager.getRepository(KaraokeSessionPerformer);
      const hosts = manager.getRepository(KaraokeRemoteHostSession);
      const owner = await users.findOne({
        where: { id: ownerId, status: UserStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      if (!owner) throw new NotFoundException('User not found.');

      const host = await hosts.findOne({
        where: { id: hostSessionId, tokenHash: this.hash(hostToken) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!host || host.revokedAt || host.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({
          code: 'guest_session_not_claimable',
          message: 'This guest karaoke session is no longer available.',
        });
      }

      const existing = await sessions.findOne({
        where: { id: hostSessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (host.claimedOwnerId) {
        if (host.claimedOwnerId !== ownerId || !existing) {
          throw new ConflictException({
            code: 'guest_session_not_claimable',
            message: 'This guest karaoke session belongs to another account.',
          });
        }
        this.assertActive(existing);
        this.assertClientOwnership(existing, clientId, false, false);
        return this.readClaimResponse(existing, queueRepository, performerRepository, null);
      }

      const now = new Date();
      await this.expireStaleWithManager(manager, ownerId, undefined, now);
      const currentSessions = await sessions.find({
        where: {
          ownerId,
          status: KaraokeSessionStatus.ACTIVE,
          leaseExpiresAt: MoreThan(now),
        },
      });
      const activeCount = currentSessions.filter((current) =>
        this.hasOccupiedHostSlot(current.id),
      ).length;
      if (activeCount >= this.maxActiveSessions && !replaceSessionId) {
        throw this.sessionLimitException();
      }

      let replacedSessionId: string | null = null;
      if (replaceSessionId) {
        if (replaceSessionId === hostSessionId) {
          throw new BadRequestException('replaceSessionId must be different from the guest session.');
        }
        const replace = await sessions.findOne({
          where: { id: replaceSessionId, ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        this.assertActive(replace);
        replace.status = KaraokeSessionStatus.ENDED;
        replace.endedAt = now;
        await sessions.save(replace);
        await queueRepository.delete({ sessionId: replace.id });
        await performerRepository.delete({ sessionId: replace.id });
        replacedSessionId = replace.id;
      }

      if (existing) {
        throw new ConflictException({
          code: 'guest_session_not_claimable',
          message: 'This guest karaoke session has already been claimed.',
        });
      }

      const claimed = sessions.create({
        id: hostSessionId,
        ownerId,
        alias,
        status: KaraokeSessionStatus.ACTIVE,
        sessionDay: this.sessionDay(now),
        lastHeartbeatAt: now,
        leaseExpiresAt: this.nextLease(now),
        clientId,
        endedAt: null,
        hasStartedSong: false,
        firstSongStartedAt: null,
        currentSongActive: false,
        currentQueueItemId: null,
        quotaExhaustionPending: false,
      });
      const saved = await sessions.save(claimed);
      const savedQueue = queue.length
        ? await queueRepository.save(queue.map((item, position) => queueRepository.create(this.toQueueEntity(item, saved.id, position))))
        : [];
      const savedPerformers = performers.length
        ? await performerRepository.save(performers.map((name, position) => performerRepository.create({ sessionId: saved.id, position, name })))
        : [];

      host.claimedOwnerId = ownerId;
      host.claimedAt = now;
      await hosts.save(host);

      return {
        session: await this.toResponseWithUsage(ownerId, saved),
        queue: savedQueue.map((item) => this.toQueueResponse(item)),
        performers: savedPerformers.sort((left, right) => left.position - right.position).map((performer) => performer.name),
        replacedSessionId,
      };
    });
  }

  async get(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeSessionResponse> {
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    // Historical sessions are read-only account data and are not tied to the
    // device that originally hosted them. Keep client ownership enforcement
    // for active sessions, where it protects the live karaoke session from a
    // second device taking over playback state.
    if (session.status === KaraokeSessionStatus.ACTIVE && this.hasOccupiedHostSlot(id)) {
      this.assertClientOwnership(
        session,
        this.normalizeClientId(clientIdInput),
        false,
        false,
      );
    }
    return this.toResponseWithUsage(ownerId, session);
  }

  /**
   * Atomically claims the durable Host client identity before a main socket
   * is allowed to register. A socket connection alone must never replace the
   * current Host; only an already-authorized bootstrap or explicit transfer
   * may change client ownership.
   */
  async claimHost(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeSessionResponse> {
    const clientId = this.normalizeClientId(clientIdInput);
    if (!clientId) throw new BadRequestException('clientId must be a UUID.');
    await this.usage?.rolloverOwner(ownerId);

    const result = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Karaoke session not found.');
      if (session.status === KaraokeSessionStatus.LOCKED_QUOTA) {
        throw this.quotaAccessDenied(session.status);
      }
      const now = new Date();
      if (
        session.status !== KaraokeSessionStatus.ACTIVE ||
        session.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        if (session.status === KaraokeSessionStatus.ACTIVE) {
          session.status = KaraokeSessionStatus.EXPIRED;
          session.endedAt = now;
          await sessions.save(session);
          await queue.delete({ sessionId: id });
          await manager
            .getRepository(KaraokeSessionPerformer)
            .delete({ sessionId: id });
        }
        throw this.notActiveException(session.status);
      }

      const liveHost = this.hasOccupiedHostSlot(id);
      this.assertClientOwnership(session, clientId, false, !liveHost);
      session.lastHeartbeatAt = now;
      session.leaseExpiresAt = this.nextLease(now);
      return sessions.save(session);
    });

    return this.toResponseWithUsage(ownerId, result);
  }

  /**
   * Authorizes a read of score data without starting the daily rollover
   * transaction. Scoreboard reads are side-effect free, and taking the
   * rollover's pessimistic locks here can otherwise make a quota-locked
   * leaderboard wait behind background usage accounting.
   *
   * Account > Session History uses the same leaderboard endpoint as the
   * current-session modal. Historical sessions are read-only, but still have
   * to belong to the authenticated owner.
   */
  async assertScoreReadAccess(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<void> {
    const session = await this.findOwned(ownerId, id);
    const isCurrentSession = [
      KaraokeSessionStatus.ACTIVE,
      KaraokeSessionStatus.LOCKED_QUOTA,
    ].includes(session.status);

    if (isCurrentSession) {
      this.assertCurrent(session);
    }

    if (session.status === KaraokeSessionStatus.ACTIVE) {
      this.assertClientOwnership(
        session,
        this.normalizeClientId(clientIdInput),
        false,
        false,
      );
    }
  }

  async markSongStarted(
    ownerId: string,
    id: string,
    queueItemId?: unknown,
  ): Promise<KaraokeSessionResponse> {
    const normalizedQueueItemId =
      queueItemId === undefined || queueItemId === null || queueItemId === ''
        ? undefined
        : this.requiredUuid(queueItemId, 'queueItemId');
    if (!this.usage) throw new ConflictException('Karaoke usage is unavailable.');
    await this.usage.rolloverOwner(ownerId);
    return this.usage.markSongStarted(ownerId, id, normalizedQueueItemId);
  }

  async markSongCompleted(
    ownerId: string,
    id: string,
    queueItemIdInput?: unknown,
  ): Promise<KaraokeSessionResponse> {
    const queueItemId = this.requiredUuid(queueItemIdInput, 'queueItemId');
    if (!this.usage) throw new ConflictException('Karaoke usage is unavailable.');
    await this.usage.rolloverOwner(ownerId);
    return this.usage.markSongCompleted(ownerId, id, queueItemId);
  }

  async finalizeSong(ownerId: string, id: string): Promise<KaraokeSessionResponse> {
    if (!this.usage) throw new ConflictException('Karaoke usage is unavailable.');
    await this.usage.rolloverOwner(ownerId);
    return this.usage.finalizeSong(ownerId, id);
  }

  async terminateSong(ownerId: string, id: string): Promise<KaraokeSessionResponse> {
    if (!this.usage) throw new ConflictException('Karaoke usage is unavailable.');
    await this.usage.rolloverOwner(ownerId);
    return this.usage.terminateSong(ownerId, id);
  }

  async getQueue(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeQueueItemResponse[]> {
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    this.assertCurrent(session);
    if (session.status === KaraokeSessionStatus.ACTIVE) {
      this.assertClientOwnership(
        session,
        this.normalizeClientId(clientIdInput),
        false,
        false,
      );
    }
    const items = await this.queueItems.find({
      where: { sessionId: id },
      order: { position: 'ASC' },
    });
    return items.map((item) => this.toQueueResponse(item));
  }

  async getPerformers(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<string[]> {
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    this.assertCurrent(session);
    if (session.status === KaraokeSessionStatus.ACTIVE) {
      this.assertClientOwnership(
        session,
        this.normalizeClientId(clientIdInput),
        false,
        false,
      );
    }
    const performers = await this.dataSource
      .getRepository(KaraokeSessionPerformer)
      .find({ where: { sessionId: id }, order: { position: 'ASC' } });
    return performers.map((performer) => performer.name);
  }

  async replacePerformers(
    ownerId: string,
    id: string,
    input: unknown,
    clientIdInput?: unknown,
  ): Promise<string[]> {
    const performers = this.normalizePerformers(input);
    const clientId = this.normalizeClientId(clientIdInput);
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId, id);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const performerRepository = manager.getRepository(KaraokeSessionPerformer);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertActive(session);
      this.assertClientOwnership(session, clientId);

      await performerRepository.delete({ sessionId: id });
      if (performers.length === 0) return [];

      const saved = await performerRepository.save(
        performers.map((name, position) =>
          performerRepository.create({ sessionId: id, position, name }),
        ),
      );
      return saved
        .sort((left, right) => left.position - right.position)
        .map((performer) => performer.name);
    });
  }

  async replaceQueue(
    ownerId: string,
    id: string,
    input: unknown,
    clientIdInput?: unknown,
  ): Promise<KaraokeQueueItemResponse[]> {
    const items = this.normalizeQueue(input);
    const clientId = this.normalizeClientId(clientIdInput);
    await this.usage?.rolloverOwner(ownerId);
    await this.expireStale(ownerId, id);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertActive(session);
      this.assertClientOwnership(session, clientId);

      await queue.delete({ sessionId: id });
      if (items.length === 0) return [];
      const saved = await queue.save(
        items.map((item, position) =>
          queue.create(this.toQueueEntity(item, id, position)),
        ),
      );
      return saved
        .sort((left, right) => left.position - right.position)
        .map((item) => this.toQueueResponse(item));
    });
  }

  async transfer(
    ownerId: string,
    sourceId: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeSessionTransferResponse> {
    const clientId = this.normalizeClientId(clientIdInput);
    await this.usage?.rolloverOwner(ownerId);
    await this.usage?.assertCanStartNewSession(ownerId);
    await this.expireStale(ownerId, sourceId);
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const performerRepository = manager.getRepository(KaraokeSessionPerformer);
      const owner = await users.findOne({
        where: { id: ownerId, status: UserStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      if (!owner) throw new NotFoundException('User not found.');

      const source = await sessions.findOne({
        where: { id: sourceId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertActive(source);
      this.assertClientOwnership(source, clientId, true);

      const now = new Date();
      const sourceQueue = await queue.find({
        where: { sessionId: sourceId },
        order: { position: 'ASC' },
      });
      const performers = await performerRepository.find({
        where: { sessionId: sourceId },
        order: { position: 'ASC' },
      });

      // Transfer ownership in place. Queue items, performers, scores, and
      // history are already keyed by this session ID, so creating a
      // replacement row would unnecessarily split the session's history.
      source!.lastHeartbeatAt = now;
      source!.leaseExpiresAt = this.nextLease(now);
      const transferred = await sessions.save(source!);

      return {
        session: this.toResponse(transferred),
        queue: sourceQueue.map((item) => this.toQueueResponse(item)),
        performers: performers
          .sort((left, right) => left.position - right.position)
          .map((performer) => performer.name),
      };
    });
  }

  async heartbeat(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
    takeOver = false,
  ): Promise<KaraokeSessionResponse> {
    const clientId = this.normalizeClientId(clientIdInput);
    await this.usage?.rolloverOwner(ownerId);
    const result = await this.dataSource.transaction<
      KaraokeSession | KaraokeSessionStatus
    >(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Karaoke session not found.');

      const now = new Date();
      if (session.status === KaraokeSessionStatus.LOCKED_QUOTA) {
        // A pass can be activated while the durable session is still marked
        // quota-locked (for example when the webhook/poll completed after a
        // browser reload). Reconcile the authoritative paid entitlement on
        // the next heartbeat so the same session can resume without creating
        // a replacement session or leaving the frontend in a retrying loader.
        const access = await this.usage?.resolveKaraokeAccess(ownerId, session, now);
        if (!access?.canUseKaraoke || access.accessSource !== 'paid') {
          return session;
        }

        session.status = KaraokeSessionStatus.ACTIVE;
        session.endedAt = null;
        session.quotaExhaustionPending = false;
        session.lastHeartbeatAt = now;
        session.leaseExpiresAt = this.nextLease(now);
      }
      if (
        session.status !== KaraokeSessionStatus.ACTIVE ||
        session.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        if (session.status === KaraokeSessionStatus.ACTIVE) {
          session.status = KaraokeSessionStatus.EXPIRED;
          session.endedAt = now;
          await sessions.save(session);
          await queue.delete({ sessionId: id });
          await manager
            .getRepository(KaraokeSessionPerformer)
            .delete({ sessionId: id });
        }
        // Returning commits an ACTIVE -> EXPIRED transition before the
        // service reports the conflict to the caller.
        return session.status;
      }

      // A valid ACTIVE row is also the durable resumable session.  It is not
      // proof that another browser is currently hosting it.  Only a live Host
      // socket blocks an ordinary heartbeat claim; explicit takeover remains
      // available for the explicit transfer action in the conflict UI.
      const liveHost = this.hasOccupiedHostSlot(id);
      const mayClaimOrTakeOver = takeOver || !liveHost;
      this.assertClientOwnership(
        session,
        clientId,
        mayClaimOrTakeOver,
        !liveHost,
      );
      session.lastHeartbeatAt = now;
      session.leaseExpiresAt = this.nextLease(now);
      return await sessions.save(session);
    });
    if (typeof result === 'string') throw this.notActiveException(result);
    await this.usage?.heartbeatHost(ownerId, id);
    return this.toResponseWithUsage(ownerId, result);
  }

  async end(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeSessionResponse> {
    const clientId = this.normalizeClientId(clientIdInput);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Karaoke session not found.');

      if (session.status === KaraokeSessionStatus.ACTIVE) {
        this.assertClientOwnership(session, clientId);
        const now = new Date();
        session.status =
          session.leaseExpiresAt.getTime() <= now.getTime()
            ? KaraokeSessionStatus.EXPIRED
            : KaraokeSessionStatus.ENDED;
        session.endedAt = now;
        await sessions.save(session);
      }
      await queue.delete({ sessionId: id });
      await manager
        .getRepository(KaraokeSessionPerformer)
        .delete({ sessionId: id });
      return this.toResponse(session);
    });
  }

  private async expireStale(ownerId: string, id?: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.expireStaleWithManager(manager, ownerId, id),
    );
  }

  private async expireStaleWithManager(
    manager: EntityManager,
    ownerId?: string,
    id?: string,
    now = new Date(),
  ): Promise<void> {
    const sessions = manager.getRepository(KaraokeSession);
    const queue = manager.getRepository(KaraokeQueueItem);
    const stale = await sessions.find({
      select: { id: true },
      where: {
        ...(id ? { id } : {}),
        ...(ownerId ? { ownerId } : {}),
        status: KaraokeSessionStatus.ACTIVE,
        leaseExpiresAt: LessThanOrEqual(now),
      },
    });
    if (stale.length === 0) return;

    const ids = stale.map((session) => session.id);
    await sessions.update(
      { id: In(ids) },
      { status: KaraokeSessionStatus.EXPIRED, endedAt: now },
    );
    await queue.delete({ sessionId: In(ids) });
    await manager
      .getRepository(KaraokeSessionPerformer)
      .delete({ sessionId: In(ids) });
  }

  private async findOwned(
    ownerId: string,
    id: string,
  ): Promise<KaraokeSession> {
    const session = await this.sessions.findOne({ where: { id, ownerId } });
    if (!session) throw new NotFoundException('Karaoke session not found.');
    return session;
  }

  private nextLease(now: Date): Date {
    return new Date(now.getTime() + this.leaseMs);
  }

  private sessionDay(now: Date): string {
    return this.usage?.getUsageDate(now) ?? getApplicationDateKey(now);
  }

  private async toResponseWithUsage(
    ownerId: string,
    session: KaraokeSession,
    includeAccountSummary = false,
  ): Promise<KaraokeSessionResponse> {
    const response = this.toResponse(session);
    if (includeAccountSummary) {
      response.queueCount =
        typeof this.queueItems.count === 'function'
          ? await this.queueItems.count({ where: { sessionId: session.id } })
          : 0;
      response.hostPresence = this.usage?.hasLiveHost(session.id) ? 'live' : 'none';
    }
    if (this.usage) {
      response.usage = await this.usage.resolveKaraokeAccess(ownerId, session);
    }
    return response;
  }

  private async readClaimResponse(
    session: KaraokeSession,
    queueRepository: Repository<KaraokeQueueItem>,
    performerRepository: Repository<KaraokeSessionPerformer>,
    replacedSessionId: string | null,
  ): Promise<KaraokeGuestSessionClaimResponse> {
    const queue = await queueRepository.find({
      where: { sessionId: session.id },
      order: { position: 'ASC' },
    });
    const performers = await performerRepository.find({
      where: { sessionId: session.id },
      order: { position: 'ASC' },
    });
    return {
      session: this.toResponse(session),
      queue: queue.map((item) => this.toQueueResponse(item)),
      performers: performers.map((performer) => performer.name),
      replacedSessionId,
    };
  }

  private assertActive(
    session: KaraokeSession | null,
  ): asserts session is KaraokeSession {
    if (!session) throw new NotFoundException('Karaoke session not found.');
    if (
      session.status !== KaraokeSessionStatus.ACTIVE ||
      session.leaseExpiresAt.getTime() <= Date.now()
    ) {
      throw this.notActiveException(
        session.status === KaraokeSessionStatus.ACTIVE
          ? KaraokeSessionStatus.EXPIRED
          : session.status,
      );
    }
  }

  private assertCurrent(
    session: KaraokeSession | null,
  ): asserts session is KaraokeSession {
    if (!session) throw new NotFoundException('Karaoke session not found.');
    if (
      ![KaraokeSessionStatus.ACTIVE, KaraokeSessionStatus.LOCKED_QUOTA].includes(
        session.status,
      ) ||
      (session.status === KaraokeSessionStatus.ACTIVE &&
        session.leaseExpiresAt.getTime() <= Date.now())
    ) {
      throw this.notActiveException(
        session.status === KaraokeSessionStatus.ACTIVE
          ? KaraokeSessionStatus.EXPIRED
          : session.status,
      );
    }
  }

  private assertClientOwnership(
    session: KaraokeSession,
    clientId: string | null,
    takeOver = false,
    claimIfUnassigned = true,
  ): void {
    if (!clientId) {
      if (session.clientId) throw this.sessionTakenOverException();
      return;
    }

    if (!session.clientId) {
      if (claimIfUnassigned) {
        session.clientId = clientId;
        return;
      }
      throw this.sessionTakenOverException();
    }

    if (session.clientId === clientId) return;
    if (takeOver) {
      session.clientId = clientId;
      return;
    }
    throw this.sessionTakenOverException();
  }

  private hasOccupiedHostSlot(sessionId: string): boolean {
    // The usage service is optional in focused session-service tests and in
    // degraded module configurations.  Preserve the previous conservative
    // limit behavior when the authoritative presence service is unavailable.
    return this.usage ? this.usage.hasLiveHost(sessionId) : true;
  }

  private async selectCanonicalCurrentSession(
    manager: EntityManager,
    sessions: KaraokeSession[],
  ): Promise<KaraokeSession> {
    if (sessions.length === 1) return sessions[0];

    const queueRepository = manager.getRepository(KaraokeQueueItem);
    const performerRepository = manager.getRepository(KaraokeSessionPerformer);
    const candidates = await Promise.all(
      sessions.map(async (session) => ({
        session,
        live: this.hasOccupiedHostSlot(session.id),
        queueCount:
          typeof queueRepository.count === 'function'
            ? await queueRepository.count({ where: { sessionId: session.id } })
            : 0,
        performerCount:
          typeof performerRepository.count === 'function'
            ? await performerRepository.count({ where: { sessionId: session.id } })
            : 0,
      })),
    );

    candidates.sort((left, right) => {
      if (left.live !== right.live) return left.live ? -1 : 1;
      const leftStatus = left.session.status === KaraokeSessionStatus.ACTIVE ? 1 : 0;
      const rightStatus = right.session.status === KaraokeSessionStatus.ACTIVE ? 1 : 0;
      if (leftStatus !== rightStatus) return rightStatus - leftStatus;
      const leftActivity =
        (left.session.currentSongActive ? 1000 : 0) +
        (left.session.hasStartedSong ? 100 : 0) +
        left.queueCount * 10 +
        left.performerCount;
      const rightActivity =
        (right.session.currentSongActive ? 1000 : 0) +
        (right.session.hasStartedSong ? 100 : 0) +
        right.queueCount * 10 +
        right.performerCount;
      if (leftActivity !== rightActivity) return rightActivity - leftActivity;
      return right.session.updatedAt.getTime() - left.session.updatedAt.getTime();
    });

    return candidates[0].session;
  }

  private async finalizeDuplicateCurrentSessions(
    manager: EntityManager,
    currentSessions: KaraokeSession[],
    canonical: KaraokeSession,
    now: Date,
  ): Promise<void> {
    if (currentSessions.length <= 1) return;
    const sessions = manager.getRepository(KaraokeSession);
    for (const duplicate of currentSessions) {
      if (duplicate.id === canonical.id) continue;
      // Keep queue, performers, scores, and history rows attached to the
      // duplicate for auditability. Only remove its current-session status.
      duplicate.status = KaraokeSessionStatus.ENDED;
      duplicate.endedAt = now;
      duplicate.currentSongActive = false;
      duplicate.currentQueueItemId = null;
      duplicate.quotaExhaustionPending = false;
      await sessions.save(duplicate);
    }
  }

  private async reconcileCurrentSessions(ownerId: string): Promise<KaraokeSession[]> {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const sessions = manager.getRepository(KaraokeSession);
      const owner = await users.findOne({
        where: { id: ownerId, status: UserStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      if (!owner) return [];

      const now = new Date();
      await this.expireStaleWithManager(manager, ownerId, undefined, now);
      const currentSessions = await sessions.find({
        where: [
          { ownerId, status: KaraokeSessionStatus.ACTIVE, leaseExpiresAt: MoreThan(now) },
          { ownerId, status: KaraokeSessionStatus.LOCKED_QUOTA },
        ],
        order: { createdAt: 'ASC' },
      });
      if (currentSessions.length <= 1) return currentSessions;

      const canonical = await this.selectCanonicalCurrentSession(
        manager,
        currentSessions,
      );
      await this.finalizeDuplicateCurrentSessions(
        manager,
        currentSessions,
        canonical,
        now,
      );
      return [canonical];
    });
  }

  private sessionsForBootstrap(sessions: KaraokeSession[]): KaraokeSession[] {
    // The normal product limit is one current session. If an earlier startup
    // race left an orphaned row beside a genuinely hosted row, expose only
    // the authoritative live row so the second tab does not show duplicate
    // conflict cards. When no Host is live, keep the oldest resumable row as
    // the canonical session for automatic restoration.
    if (!this.usage || this.maxActiveSessions > 1 || sessions.length <= 1) {
      return sessions;
    }
    const live = sessions.filter((session) =>
      this.hasOccupiedHostSlot(session.id),
    );
    return live.length > 0 ? live.slice(0, 1) : sessions.slice(0, 1);
  }

  private sessionTakenOverException(): ConflictException {
    return new ConflictException({
      code: 'karaoke_session_taken_over',
      message: 'This karaoke session is active on another device.',
    });
  }

  private normalizeClientId(input: unknown): string | null {
    if (input === undefined || input === null || input === '') return null;
    if (typeof input !== 'string') {
      throw new BadRequestException('clientId must be a UUID.');
    }
    const clientId = input.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        clientId,
      )
    ) {
      throw new BadRequestException('clientId must be a UUID.');
    }
    return clientId;
  }

  private requiredUuid(input: unknown, field: string): string {
    if (
      typeof input !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.trim())
    ) {
      throw new BadRequestException(`${field} must be a UUID.`);
    }
    return input.trim();
  }

  private requiredToken(input: unknown, field: string): string {
    if (
      typeof input !== 'string' ||
      input.trim().length < 32 ||
      input.trim().length > 200
    ) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return input.trim();
  }

  private normalizeQueue(input: unknown): KaraokeQueueItemResponse[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException('Queue items must be an array.');
    }
    if (input.length > 100) {
      throw new BadRequestException(
        'A karaoke session can queue at most 100 songs.',
      );
    }
    return input.map((value, index) => {
      if (!value || typeof value !== 'object') {
        throw new BadRequestException(`Queue item ${index + 1} is invalid.`);
      }
      const item = value as Record<string, unknown>;
      const queueItemId = item.queueItemId === undefined
        ? undefined
        : this.requiredUuid(item.queueItemId, `Queue item ${index + 1} queueItemId`);
      const videoId = this.requiredString(item.videoId, 20, 'videoId');
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
        throw new BadRequestException(
          `Queue item ${index + 1} has an invalid videoId.`,
        );
      }
      const thumbnails = this.requiredString(
        item.thumbnails,
        2048,
        'thumbnails',
      );
      if (!/^https?:\/\//i.test(thumbnails)) {
        throw new BadRequestException(
          `Queue item ${index + 1} has an invalid thumbnail URL.`,
        );
      }
      return {
        ...(queueItemId ? { queueItemId } : {}),
        videoId,
        title: this.requiredString(item.title, 200, 'title'),
        description:
          typeof item.description === 'string'
            ? item.description.trim().slice(0, 1000)
            : '',
        thumbnails,
        performer: this.requiredString(item.performer, 60, 'performer'),
      };
    });
  }

  private normalizePerformers(input: unknown): string[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException('Performers must be an array.');
    }
    if (input.length > 100) {
      throw new BadRequestException(
        'A karaoke session can have at most 100 performers.',
      );
    }

    const seen = new Set<string>();
    return input.reduce<string[]>((result, value, index) => {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > 60
      ) {
        throw new BadRequestException(`Performer ${index + 1} is invalid.`);
      }
      const name = value.trim().toUpperCase();
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
      return result;
    }, []);
  }

  private requiredString(value: unknown, max: number, field: string): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > max
    ) {
      throw new BadRequestException(`Queue item ${field} is invalid.`);
    }
    return value.trim();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private normalizeAlias(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 20
    ) {
      throw new BadRequestException(
        'Session name must be between 1 and 20 characters.',
      );
    }
    return value.trim();
  }

  private toQueueResponse(item: KaraokeQueueItem): KaraokeQueueItemResponse {
    return {
      queueItemId: item.id,
      videoId: item.videoId,
      title: item.title,
      description: item.description,
      thumbnails: item.thumbnails,
      performer: item.performer,
    };
  }

  private toQueueEntity(
    item: KaraokeQueueItemResponse,
    sessionId: string,
    position: number,
  ): Partial<KaraokeQueueItem> {
    const { queueItemId, ...song } = item;
    return {
      ...(queueItemId ? { id: queueItemId } : {}),
      ...song,
      sessionId,
      position,
    };
  }

  private notActiveException(status: KaraokeSessionStatus): ConflictException {
    return new ConflictException({
      code: 'karaoke_session_not_active',
      message: 'This karaoke session is no longer active.',
      status,
    });
  }

  private quotaAccessDenied(status: KaraokeSessionStatus): ConflictException {
    return new ConflictException({
      code: 'karaoke_quota_exhausted',
      message: "You've used today's free karaoke time. Your current session is safely saved.",
      status,
    });
  }

  private sessionLimitException(): ConflictException {
    return new ConflictException({
      code: 'karaoke_session_limit_reached',
      message: 'End an active karaoke session before starting another.',
      limit: this.maxActiveSessions,
    });
  }

  private toResponse(session: KaraokeSession): KaraokeSessionResponse {
    return {
      id: session.id,
      alias: session.alias,
      status: session.status,
      lastHeartbeatAt: session.lastHeartbeatAt.toISOString(),
      leaseExpiresAt: session.leaseExpiresAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }
}
