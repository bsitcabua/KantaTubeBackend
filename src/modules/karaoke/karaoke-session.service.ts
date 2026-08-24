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
import { User, UserStatus } from '../users/entities/user.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokeSessionResponse } from './karaoke-session.types';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import {
  KaraokeQueueItemResponse,
  KaraokeSessionTransferResponse,
} from './karaoke-session.types';

@Injectable()
export class KaraokeSessionService implements OnModuleInit, OnModuleDestroy {
  static readonly maxActiveSessions = 2;
  static readonly defaultLeaseSeconds = 120;

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
  ): Promise<KaraokeSessionResponse> {
    const alias = this.normalizeAlias(aliasInput);
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
          if (activeCount >= KaraokeSessionService.maxActiveSessions) {
            // Returning instead of throwing commits the stale-session cleanup.
            return null;
          }

          const session = sessions.create({
            ownerId,
            alias,
            status: KaraokeSessionStatus.ACTIVE,
            lastHeartbeatAt: now,
            leaseExpiresAt: this.nextLease(now),
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

  async get(ownerId: string, id: string): Promise<KaraokeSessionResponse> {
    await this.expireStale(ownerId, id);
    return this.toResponse(await this.findOwned(ownerId, id));
  }

  async getQueue(
    ownerId: string,
    id: string,
  ): Promise<KaraokeQueueItemResponse[]> {
    await this.expireStale(ownerId, id);
    this.assertActive(await this.findOwned(ownerId, id));
    const items = await this.queueItems.find({
      where: { sessionId: id },
      order: { position: 'ASC' },
    });
    return items.map((item) => this.toQueueResponse(item));
  }

  async replaceQueue(
    ownerId: string,
    id: string,
    input: unknown,
  ): Promise<KaraokeQueueItemResponse[]> {
    const items = this.normalizeQueue(input);
    await this.expireStale(ownerId, id);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertActive(session);

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
  ): Promise<KaraokeSessionTransferResponse> {
    await this.expireStale(ownerId, sourceId);
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
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
      await queue.delete({ sessionId: sourceId });

      return {
        session: this.toResponse(replacement),
        queue: copied.map((item) => this.toQueueResponse(item)),
      };
    });
  }

  async heartbeat(
    ownerId: string,
    id: string,
  ): Promise<KaraokeSessionResponse> {
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
        }
        // Returning commits an ACTIVE -> EXPIRED transition before the
        // service reports the conflict to the caller.
        return session.status;
      }

      session.lastHeartbeatAt = now;
      session.leaseExpiresAt = this.nextLease(now);
      return this.toResponse(await sessions.save(session));
    });
    if (typeof result === 'string') throw this.notActiveException(result);
    return result;
  }

  async end(ownerId: string, id: string): Promise<KaraokeSessionResponse> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(KaraokeSession);
      const queue = manager.getRepository(KaraokeQueueItem);
      const session = await sessions.findOne({
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Karaoke session not found.');

      if (session.status === KaraokeSessionStatus.ACTIVE) {
        const now = new Date();
        session.status =
          session.leaseExpiresAt.getTime() <= now.getTime()
            ? KaraokeSessionStatus.EXPIRED
            : KaraokeSessionStatus.ENDED;
        session.endedAt = now;
        await sessions.save(session);
      }
      await queue.delete({ sessionId: id });
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
        throw new BadRequestException(`Queue item ${index + 1} has an invalid videoId.`);
      }
      const thumbnails = this.requiredString(item.thumbnails, 2048, 'thumbnails');
      if (!/^https?:\/\//i.test(thumbnails)) {
        throw new BadRequestException(`Queue item ${index + 1} has an invalid thumbnail URL.`);
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

  private normalizeAlias(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) {
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
      limit: KaraokeSessionService.maxActiveSessions,
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
