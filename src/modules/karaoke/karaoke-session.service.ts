import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
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
  ) {
    const configuredMaximum = Number(
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
  ): Promise<KaraokeSessionResponse> {
    const alias = this.normalizeAlias(aliasInput);
    const clientId = this.normalizeClientId(clientIdInput);
    const created =
      await this.dataSource.transaction<KaraokeSessionResponse | null>(
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

          const activeCount = await sessions.count({
            where: {
              ownerId,
              status: KaraokeSessionStatus.ACTIVE,
              leaseExpiresAt: MoreThan(now),
            },
          });
          if (activeCount >= this.maxActiveSessions) {
            // Returning instead of throwing commits the stale-session cleanup.
            return null;
          }

          const session = sessions.create({
            ownerId,
            alias,
            status: KaraokeSessionStatus.ACTIVE,
            lastHeartbeatAt: now,
            leaseExpiresAt: this.nextLease(now),
            clientId,
            endedAt: null,
          });
          return this.toResponse(await sessions.save(session));
        },
      );
    if (!created) throw this.sessionLimitException();
    return created;
  }

  async listActive(ownerId: string): Promise<KaraokeSessionResponse[]> {
    await this.expireStale(ownerId);
    const now = new Date();
    const sessions = await this.sessions.find({
      where: {
        ownerId,
        status: KaraokeSessionStatus.ACTIVE,
        leaseExpiresAt: MoreThan(now),
      },
      order: { createdAt: 'ASC' },
    });
    return sessions.map((session) => this.toResponse(session));
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
      const activeCount = await sessions.count({
        where: {
          ownerId,
          status: KaraokeSessionStatus.ACTIVE,
          leaseExpiresAt: MoreThan(now),
        },
      });
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
        lastHeartbeatAt: now,
        leaseExpiresAt: this.nextLease(now),
        clientId,
        endedAt: null,
      });
      const saved = await sessions.save(claimed);
      const savedQueue = queue.length
        ? await queueRepository.save(queue.map((item, position) => queueRepository.create({ ...item, sessionId: saved.id, position })))
        : [];
      const savedPerformers = performers.length
        ? await performerRepository.save(performers.map((name, position) => performerRepository.create({ sessionId: saved.id, position, name })))
        : [];

      host.claimedOwnerId = ownerId;
      host.claimedAt = now;
      await hosts.save(host);

      return {
        session: this.toResponse(saved),
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
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    this.assertClientOwnership(
      session,
      this.normalizeClientId(clientIdInput),
      false,
      false,
    );
    return this.toResponse(session);
  }

  async getQueue(
    ownerId: string,
    id: string,
    clientIdInput?: unknown,
  ): Promise<KaraokeQueueItemResponse[]> {
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    this.assertActive(session);
    this.assertClientOwnership(
      session,
      this.normalizeClientId(clientIdInput),
      false,
      false,
    );
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
    await this.expireStale(ownerId, id);
    const session = await this.findOwned(ownerId, id);
    this.assertActive(session);
    this.assertClientOwnership(
      session,
      this.normalizeClientId(clientIdInput),
      false,
      false,
    );
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
          queue.create({ ...item, sessionId: id, position }),
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
    includePerformers = true,
    clientIdInput?: unknown,
  ): Promise<KaraokeSessionTransferResponse> {
    const clientId = this.normalizeClientId(clientIdInput);
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

      const sourcePerformers = includePerformers
        ? await performerRepository.find({
            where: { sessionId: sourceId },
            order: { position: 'ASC' },
          })
        : [];

      const now = new Date();
      source!.status = KaraokeSessionStatus.ENDED;
      source!.endedAt = now;
      await sessions.save(source!);

      const replacement = await sessions.save(
        sessions.create({
          ownerId,
          alias: source!.alias,
          status: KaraokeSessionStatus.ACTIVE,
          lastHeartbeatAt: now,
          leaseExpiresAt: this.nextLease(now),
          clientId,
          endedAt: null,
        }),
      );
      const sourceQueue = await queue.find({
        where: { sessionId: sourceId },
        order: { position: 'ASC' },
      });
      const copied = sourceQueue.length
        ? await queue.save(
            sourceQueue.map((item) =>
              queue.create({
                sessionId: replacement.id,
                position: item.position,
                videoId: item.videoId,
                title: item.title,
                description: item.description,
                thumbnails: item.thumbnails,
                performer: item.performer,
              }),
            ),
          )
        : [];
      const copiedPerformers = sourcePerformers.length
        ? await performerRepository.save(
            sourcePerformers.map((performer, position) =>
              performerRepository.create({
                sessionId: replacement.id,
                position,
                name: performer.name,
              }),
            ),
          )
        : [];
      await queue.delete({ sessionId: sourceId });
      await performerRepository.delete({ sessionId: sourceId });

      return {
        session: this.toResponse(replacement),
        queue: copied.map((item) => this.toQueueResponse(item)),
        performers: copiedPerformers
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
    const result = await this.dataSource.transaction<
      KaraokeSessionResponse | KaraokeSessionStatus
    >(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Karaoke session not found.');

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
        // Returning commits an ACTIVE -> EXPIRED transition before the
        // service reports the conflict to the caller.
        return session.status;
      }

      this.assertClientOwnership(session, clientId, takeOver);
      session.lastHeartbeatAt = now;
      session.leaseExpiresAt = this.nextLease(now);
      return this.toResponse(await sessions.save(session));
    });
    if (typeof result === 'string') throw this.notActiveException(result);
    return result;
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
      if (claimIfUnassigned) session.clientId = clientId;
      return;
    }

    if (session.clientId === clientId) return;
    if (takeOver) {
      session.clientId = clientId;
      return;
    }
    throw this.sessionTakenOverException();
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
      videoId: item.videoId,
      title: item.title,
      description: item.description,
      thumbnails: item.thumbnails,
      performer: item.performer,
    };
  }

  private notActiveException(status: KaraokeSessionStatus): ConflictException {
    return new ConflictException({
      code: 'karaoke_session_not_active',
      message: 'This karaoke session is no longer active.',
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
      lastHeartbeatAt: session.lastHeartbeatAt,
      leaseExpiresAt: session.leaseExpiresAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
