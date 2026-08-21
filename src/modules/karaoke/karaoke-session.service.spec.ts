import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionService } from './karaoke-session.service';

describe('KaraokeSessionService', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174000';
  const sessionId = '123e4567-e89b-42d3-a456-426614174001';

  function session(overrides: Partial<KaraokeSession> = {}): KaraokeSession {
    const now = new Date();
    return {
      id: sessionId,
      ownerId,
      alias: 'Living Room',
      status: KaraokeSessionStatus.ACTIVE,
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as KaraokeSession;
  }

  function createService(options?: {
    dataSource?: Partial<DataSource>;
    repository?: Partial<Repository<KaraokeSession>>;
    leaseSeconds?: string;
  }) {
    const repository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      ...options?.repository,
    } as unknown as Repository<KaraokeSession>;
    const config = {
      get: jest.fn(() => options?.leaseSeconds),
    } as unknown as ConfigService;
    const dataSource = options?.dataSource as DataSource;
    const queueRepository = {} as Repository<KaraokeQueueItem>;
    return {
      repository,
      service: new KaraokeSessionService(
        dataSource,
        repository,
        queueRepository,
        config,
      ),
    };
  }

  it('serializes concurrent creation and rejects a third active session', async () => {
    const stored: KaraokeSession[] = [];
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn(async () => stored.length),
      create: jest.fn((value) => value),
      save: jest.fn(async (value: KaraokeSession) => {
        const now = new Date();
        const saved = session({
          ...value,
          id: `123e4567-e89b-42d3-a456-${String(stored.length + 1).padStart(12, '0')}`,
          createdAt: now,
          updatedAt: now,
        });
        stored.push(saved);
        return saved;
      }),
    };
    const queueRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === KaraokeSession) return sessionRepository;
        return queueRepository;
      }),
    };

    let transactionTail = Promise.resolve();
    const dataSource = {
      transaction: jest.fn(async (work) => {
        const previous = transactionTail;
        let release: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await work(manager);
        } finally {
          release!();
        }
      }),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    const results = await Promise.allSettled([
      service.create(ownerId, 'Living Room'),
      service.create(ownerId, 'Bedroom'),
      service.create(ownerId, 'Party Room'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect(rejected?.reason.getResponse()).toMatchObject({
      code: 'karaoke_session_limit_reached',
      limit: 2,
    });
    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('does not expose sessions owned by another user', async () => {
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? { find: jest.fn().mockResolvedValue([]) }
              : { delete: jest.fn() },
        }),
      ),
    } as unknown as DataSource;
    const { service, repository } = createService({
      dataSource,
      repository: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.get(ownerId, sessionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: sessionId, ownerId },
    });
  });

  it('extends the lease for an active owned session', async () => {
    const existing = session();
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => ({ ...value, updatedAt: new Date() })),
    };
    const queueRepository = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession ? transactionRepository : queueRepository,
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource, leaseSeconds: '300' });
    const oldExpiry = existing.leaseExpiresAt.getTime();

    const result = await service.heartbeat(ownerId, sessionId);

    expect(result.leaseExpiresAt.getTime()).toBeGreaterThan(oldExpiry);
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      where: { id: sessionId, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('expires a session instead of reviving an elapsed lease', async () => {
    const existing = session({
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => value),
    };
    const queueRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession ? transactionRepository : queueRepository,
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    await expect(service.heartbeat(ownerId, sessionId)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'karaoke_session_not_active',
        status: KaraokeSessionStatus.EXPIRED,
      }),
    });
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: KaraokeSessionStatus.EXPIRED }),
    );
    expect(queueRepository.delete).toHaveBeenCalledWith({ sessionId });
  });

  it('ends an active session and makes repeated end calls idempotent', async () => {
    const existing = session();
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => value),
    };
    const queueRepository = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession ? transactionRepository : queueRepository,
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    const ended = await service.end(ownerId, sessionId);
    const repeated = await service.end(ownerId, sessionId);

    expect(ended.status).toBe(KaraokeSessionStatus.ENDED);
    expect(repeated.status).toBe(KaraokeSessionStatus.ENDED);
    expect(transactionRepository.save).toHaveBeenCalledTimes(1);
    expect(queueRepository.delete).toHaveBeenCalledTimes(2);
  });

  it('replaces an active session queue atomically', async () => {
    const existing = session();
    const queueRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((value) => value),
      save: jest.fn(async (values) =>
        values.map((value: KaraokeQueueItem, index: number) => ({
          ...value,
          id: `queue-${index}`,
        })),
      ),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? {
                  find: jest.fn().mockResolvedValue([]),
                  findOne: jest.fn().mockResolvedValue(existing),
                }
              : queueRepository,
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    const result = await service.replaceQueue(ownerId, sessionId, [
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Karaoke',
        description: 'Description',
        thumbnails: 'https://i.ytimg.com/test.jpg',
        performer: 'SINGER',
      },
    ]);

    expect(queueRepository.delete).toHaveBeenCalledWith({ sessionId });
    expect(result).toEqual([
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Karaoke',
        description: 'Description',
        thumbnails: 'https://i.ytimg.com/test.jpg',
        performer: 'SINGER',
      },
    ]);
  });

  it('atomically transfers an active session and copies its queue', async () => {
    const source = session();
    const replacement = session({ id: 'replacement-session' });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(source),
      create: jest.fn(() => replacement),
      save: jest.fn(async (value) => value),
    };
    const sourceItem = {
      sessionId,
      position: 0,
      videoId: 'dQw4w9WgXcQ',
      title: 'Transferred Karaoke',
      description: '',
      thumbnails: 'https://i.ytimg.com/test.jpg',
      performer: 'SINGER',
    } as KaraokeQueueItem;
    const queueRepository = {
      find: jest.fn().mockResolvedValue([sourceItem]),
      create: jest.fn((value) => value),
      save: jest.fn(async (values) => values),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) => {
            if (entity === User) return userRepository;
            if (entity === KaraokeSession) return sessionRepository;
            return queueRepository;
          },
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    const result = await service.transfer(ownerId, sessionId);

    expect(source.status).toBe(KaraokeSessionStatus.ENDED);
    expect(result.session.id).toBe('replacement-session');
    expect(result.session.alias).toBe('Living Room');
    expect(result.queue[0]).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      title: 'Transferred Karaoke',
    });
    expect(queueRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'replacement-session' }),
    );
    expect(queueRepository.delete).toHaveBeenCalledWith({ sessionId });
  });

  it('marks elapsed sessions expired and deletes only their queue items', async () => {
    const staleId = '123e4567-e89b-42d3-a456-426614174099';
    const sessionRepository = {
      find: jest.fn().mockResolvedValue([{ id: staleId }]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const queueRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession ? sessionRepository : queueRepository,
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    await service.cleanupExpiredSessions();

    expect(sessionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() }),
      expect.objectContaining({ status: KaraokeSessionStatus.EXPIRED }),
    );
    expect(queueRepository.delete).toHaveBeenCalledWith({
      sessionId: expect.anything(),
    });
  });
});
