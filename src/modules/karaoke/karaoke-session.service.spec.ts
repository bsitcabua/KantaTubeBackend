import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionPerformer } from './entities/karaoke-session-performer.entity';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';
import { KaraokeSessionService } from './karaoke-session.service';
import { KaraokeUsageService } from './karaoke-usage.service';

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
    queueRepository?: Partial<Repository<KaraokeQueueItem>>;
    leaseSeconds?: string;
    maxActiveSessions?: string;
    usage?: Partial<KaraokeUsageService>;
  }) {
    const repository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      ...options?.repository,
    } as unknown as Repository<KaraokeSession>;
    const config = {
      get: jest.fn((key: string) =>
        key === 'MAX_ACTIVE_SESSIONS'
          ? options?.maxActiveSessions
          : options?.leaseSeconds,
      ),
    } as unknown as ConfigService;
    const dataSource = options?.dataSource as DataSource;
    const queueRepository = (options?.queueRepository ?? {}) as Repository<KaraokeQueueItem>;
    return {
      repository,
      service: new KaraokeSessionService(
        dataSource,
        repository,
        queueRepository,
        config,
        options?.usage as KaraokeUsageService | undefined,
      ),
    };
  }

  it('allows the owner to read leaderboard data for an ended session', async () => {
    const historicalSession = session({
      status: KaraokeSessionStatus.ENDED,
      endedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const { service } = createService({
      repository: { findOne: jest.fn().mockResolvedValue(historicalSession) },
    });

    await expect(service.assertScoreReadAccess(ownerId, sessionId)).resolves.toBeUndefined();
  });

  it('does not authorize leaderboard reads for a session owned by another account', async () => {
    const { service } = createService({
      repository: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.assertScoreReadAccess(ownerId, sessionId)).rejects.toThrow('Karaoke session not found.');
  });

  it('serializes concurrent creation and rejects duplicate current sessions', async () => {
    const stored: KaraokeSession[] = [];
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn(async (options?: { select?: unknown }) =>
        options?.select ? [] : stored,
      ),
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
    const { service } = createService({ dataSource, maxActiveSessions: '1' });

    const results = await Promise.allSettled([
      service.create(ownerId, 'Living Room'),
      service.create(ownerId, 'Bedroom'),
      service.create(ownerId, 'Party Room'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.getResponse()).toMatchObject({
      code: 'karaoke_session_limit_reached',
      limit: 1,
    });
    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('reuses the same current row for a second bootstrap request', async () => {
    const stored: KaraokeSession[] = [];
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      find: jest.fn(async (options?: { select?: unknown }) =>
        options?.select ? [] : stored,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value: KaraokeSession) => {
        const saved = session({
          ...value,
          id: '123e4567-e89b-42d3-a456-426614174005',
        });
        stored.push(saved);
        return saved;
      }),
    };
    const queueRepository = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === KaraokeSession) return sessionRepository;
        return queueRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      assertCanStartNewSession: jest.fn().mockResolvedValue(undefined),
      getUsageDate: jest.fn().mockReturnValue('2026-10-27'),
      hasLiveHost: jest.fn().mockReturnValue(false),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });
    const firstClient = '123e4567-e89b-42d3-a456-426614174006';
    const secondClient = '123e4567-e89b-42d3-a456-426614174007';

    const first = await service.create(ownerId, 'Karaoke session', firstClient, true);
    const second = await service.create(ownerId, 'Karaoke session', secondClient);

    expect(first.id).toBe('123e4567-e89b-42d3-a456-426614174005');
    expect(second.id).toBe(first.id);
    expect(sessionRepository.save).toHaveBeenCalledTimes(2);
    expect(sessionRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientId: secondClient }),
    );
  });

  it('claims an unassigned current session only when no live Host exists', async () => {
    const candidate = session({ clientId: null });
    const sessions = {
      findOne: jest.fn().mockResolvedValue(candidate),
      save: jest.fn(async (value: KaraokeSession) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === KaraokeSession ? sessions : { delete: jest.fn() },
      ),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(false),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });
    const clientId = '123e4567-e89b-42d3-a456-426614174009';

    await service.claimHost(ownerId, candidate.id, clientId);

    expect(candidate.clientId).toBe(clientId);
    expect(sessions.save).toHaveBeenCalledWith(candidate);
  });

  it('rejects a second Host claim even when the persisted client is unassigned', async () => {
    const candidate = session({ clientId: null });
    const sessions = {
      findOne: jest.fn().mockResolvedValue(candidate),
      save: jest.fn(async (value: KaraokeSession) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === KaraokeSession ? sessions : { delete: jest.fn() },
      ),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(true),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });
    const clientId = '123e4567-e89b-42d3-a456-426614174010';

    await expect(service.claimHost(ownerId, candidate.id, clientId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'karaoke_session_taken_over' }),
    });
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('reconciles duplicate current rows without deleting their queue or performer data', async () => {
    const duplicate = session({
      id: '123e4567-e89b-42d3-a456-426614174011',
      hasStartedSong: true,
    });
    const canonical = session({
      id: '123e4567-e89b-42d3-a456-426614174012',
      currentSongActive: true,
    });
    const sessionRepository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn(async (options?: { select?: unknown }) =>
        options?.select ? [] : [duplicate, canonical],
      ),
      save: jest.fn(async (value: KaraokeSession) => value),
    };
    const userRepository = { findOne: jest.fn().mockResolvedValue({ id: ownerId }) };
    const queueRepository = {
      count: jest.fn().mockImplementation(({ where }: { where: { sessionId: string } }) =>
        where.sessionId === canonical.id ? 4 : 0,
      ),
      delete: jest.fn(),
    };
    const performerRepository = {
      count: jest.fn().mockReturnValue(2),
      delete: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === KaraokeSession) return sessionRepository;
        if (entity === KaraokeQueueItem) return queueRepository;
        return performerRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      assertCanStartNewSession: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(false),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({
      dataSource,
      repository: sessionRepository as unknown as Repository<KaraokeSession>,
      usage,
    });
    const clientId = '123e4567-e89b-42d3-a456-426614174013';

    const result = await service.create(ownerId, 'Karaoke session', clientId);

    expect(result.id).toBe(canonical.id);
    expect(duplicate.status).toBe(KaraokeSessionStatus.ENDED);
    expect(canonical.clientId).toBe(clientId);
    expect(queueRepository.delete).not.toHaveBeenCalled();
    expect(performerRepository.delete).not.toHaveBeenCalled();
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

  it('runs daily rollover before lease expiration when resolving current sessions', async () => {
    const yesterdayLocked = session({
      status: KaraokeSessionStatus.LOCKED_QUOTA,
      sessionDay: '2026-10-21',
    });
    const order: string[] = [];
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: () => ({
            find: jest.fn(async () => {
              order.push('expire');
              return [];
            }),
          }),
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      configuration: { maxCurrentSessions: 1 } as KaraokeUsageService['configuration'],
      rolloverOwner: jest.fn(async () => {
        order.push('rollover');
        yesterdayLocked.status = KaraokeSessionStatus.ENDED;
        yesterdayLocked.endedAt = new Date('2026-10-22T00:00:01.000Z');
      }),
    } as Partial<KaraokeUsageService>;
    const { service, repository } = createService({
      dataSource,
      repository: {
        find: jest.fn(async () => {
          order.push('list');
          return yesterdayLocked.status === KaraokeSessionStatus.ENDED
            ? []
            : [yesterdayLocked];
        }),
      },
      usage,
    });

    await expect(service.listActive(ownerId)).resolves.toEqual([]);

    expect(usage.rolloverOwner).toHaveBeenCalledWith(ownerId);
    expect(order).toEqual(['rollover', 'expire', 'list']);
    expect(yesterdayLocked.status).toBe(KaraokeSessionStatus.ENDED);
    expect(repository.find).toHaveBeenCalled();
  });

  it('hides orphaned duplicate rows when a live Host session is present', async () => {
    const live = session({ id: sessionId, currentSongActive: true });
    const duplicateLive = session({
      id: '123e4567-e89b-42d3-a456-426614174008',
    });
    const orphan = session({
      id: '123e4567-e89b-42d3-a456-426614174004',
    });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      find: jest.fn(async (options?: { select?: unknown }) =>
        options?.select ? [] : [live, duplicateLive, orphan],
      ),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      save: jest.fn(async (value: KaraokeSession) => value),
    };
    const queueRepository = {
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    };
    const performerRepository = {
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) => {
            if (entity === User) return userRepository;
            if (entity === KaraokeSession) return sessionRepository;
            if (entity === KaraokeQueueItem) return queueRepository;
            return performerRepository;
          },
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn((id: string) => id === sessionId || id === duplicateLive.id),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({
      dataSource,
      repository: { find: jest.fn().mockResolvedValue([live, duplicateLive, orphan]) },
      usage,
    });

    const result = await service.listActive(ownerId);

    expect(result.map((current) => current.id)).toEqual([sessionId]);
    expect(duplicateLive.status).toBe(KaraokeSessionStatus.ENDED);
    expect(orphan.status).toBe(KaraokeSessionStatus.ENDED);
    expect(sessionRepository.save).toHaveBeenCalledTimes(2);
    expect(queueRepository.delete).not.toHaveBeenCalled();
    expect(performerRepository.delete).not.toHaveBeenCalled();
  });

  it('includes the persisted queue count and Host presence in the account summary', async () => {
    const queueRepository = { count: jest.fn().mockResolvedValue(5) };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? { find: jest.fn().mockResolvedValue([]) }
              : { delete: jest.fn().mockResolvedValue({ affected: 0 }) },
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(true),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({
      dataSource,
      repository: { find: jest.fn().mockResolvedValue([session()]) },
      queueRepository,
      usage,
    });

    await expect(service.listActive(ownerId)).resolves.toEqual([
      expect.objectContaining({ id: sessionId, queueCount: 5, hostPresence: 'live' }),
    ]);
    expect(queueRepository.count).toHaveBeenCalledWith({ where: { sessionId } });
    expect(usage.hasLiveHost).toHaveBeenCalledWith(sessionId);
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

    expect(Date.parse(result.leaseExpiresAt)).toBeGreaterThan(oldExpiry);
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      where: { id: sessionId, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('reopens a quota-locked session when the owner has an active paid pass', async () => {
    const existing = session({ status: KaraokeSessionStatus.LOCKED_QUOTA });
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => ({ ...value, updatedAt: new Date() })),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession ? transactionRepository : { delete: jest.fn() },
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      resolveKaraokeAccess: jest.fn().mockResolvedValue({
        accessSource: 'paid',
        canUseKaraoke: true,
      }),
      heartbeatHost: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(false),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });

    const result = await service.heartbeat(ownerId, sessionId);

    expect(result.id).toBe(sessionId);
    expect(result.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(existing.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(existing.endedAt).toBeNull();
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: KaraokeSessionStatus.ACTIVE,
        quotaExhaustionPending: false,
      }),
    );
  });

  it('rejects the previous client after a session is taken over', async () => {
    const previousClientId = '123e4567-e89b-42d3-a456-426614174002';
    const newClientId = '123e4567-e89b-42d3-a456-426614174003';
    const existing = session({ clientId: previousClientId });
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => ({ ...value, updatedAt: new Date() })),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? transactionRepository
              : { delete: jest.fn().mockResolvedValue({ affected: 0 }) },
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    await expect(
      service.heartbeat(ownerId, sessionId, newClientId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'karaoke_session_taken_over',
      }),
    });

    const result = await service.heartbeat(
      ownerId,
      sessionId,
      newClientId,
      true,
    );

    expect(result).toEqual(expect.objectContaining({ id: sessionId }));
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: newClientId }),
    );
  });

  it('automatically reclaims a resumable session when no Host is live', async () => {
    const previousClientId = '123e4567-e89b-42d3-a456-426614174002';
    const newClientId = '123e4567-e89b-42d3-a456-426614174003';
    const existing = session({ clientId: previousClientId });
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => ({ ...value, updatedAt: new Date() })),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? transactionRepository
              : { delete: jest.fn().mockResolvedValue({ affected: 0 }) },
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(false),
      heartbeatHost: jest.fn().mockResolvedValue(undefined),
      resolveKaraokeAccess: jest.fn().mockResolvedValue(undefined),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });

    const result = await service.heartbeat(ownerId, sessionId, newClientId);

    expect(result.id).toBe(sessionId);
    expect(usage.hasLiveHost).toHaveBeenCalledWith(sessionId);
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: newClientId }),
    );
  });

  it('keeps ownership protection when another Host is live', async () => {
    const previousClientId = '123e4567-e89b-42d3-a456-426614174002';
    const newClientId = '123e4567-e89b-42d3-a456-426614174003';
    const existing = session({ clientId: previousClientId });
    const transactionRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? transactionRepository
              : { delete: jest.fn().mockResolvedValue({ affected: 0 }) },
        }),
      ),
    } as unknown as DataSource;
    const usage = {
      rolloverOwner: jest.fn().mockResolvedValue(undefined),
      hasLiveHost: jest.fn().mockReturnValue(true),
    } as Partial<KaraokeUsageService>;
    const { service } = createService({ dataSource, usage });

    await expect(
      service.heartbeat(ownerId, sessionId, newClientId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'karaoke_session_taken_over',
      }),
    });
    expect(transactionRepository.save).not.toHaveBeenCalled();
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
    const performerRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) =>
            entity === KaraokeSession
              ? transactionRepository
              : entity === KaraokeSessionPerformer
                ? performerRepository
                : queueRepository,
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
    expect(performerRepository.delete).toHaveBeenCalledTimes(2);
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
        queueItemId: 'queue-0',
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Karaoke',
        description: 'Description',
        thumbnails: 'https://i.ytimg.com/test.jpg',
        performer: 'SINGER',
      },
    ]);
  });

  it('transfers an active session in place and preserves its queue and performers', async () => {
    const previousClientId = '123e4567-e89b-42d3-a456-426614174002';
    const newClientId = '123e4567-e89b-42d3-a456-426614174003';
    const source = session({ clientId: previousClientId });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(source),
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
    const performerRepository = {
      find: jest.fn().mockResolvedValue([
        { sessionId, position: 0, name: 'ELVIN' },
        { sessionId, position: 1, name: 'GERSON' },
      ]),
      create: jest.fn((value) => value),
      save: jest.fn(async (values) => values),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const dataSource = {
      transaction: jest.fn((work) =>
        work({
          getRepository: (entity: unknown) => {
            if (entity === User) return userRepository;
            if (entity === KaraokeSession) return sessionRepository;
            if (entity === KaraokeSessionPerformer) return performerRepository;
            return queueRepository;
          },
        }),
      ),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });

    const result = await service.transfer(ownerId, sessionId, newClientId);

    expect(source.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(source.clientId).toBe(newClientId);
    expect(result.session.id).toBe(sessionId);
    expect(result.session.alias).toBe('Living Room');
    expect(result.queue[0]).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      title: 'Transferred Karaoke',
    });
    expect(result.performers).toEqual(['ELVIN', 'GERSON']);
    expect(performerRepository.create).not.toHaveBeenCalled();
    expect(performerRepository.delete).not.toHaveBeenCalled();
    expect(queueRepository.create).not.toHaveBeenCalled();
    expect(queueRepository.delete).not.toHaveBeenCalled();
    expect(sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId, status: KaraokeSessionStatus.ACTIVE }),
    );
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

  it('claims a guest host in place and is idempotent on a repeated callback', async () => {
    const guestId = '123e4567-e89b-42d3-a456-426614174099';
    const host = {
      id: guestId,
      tokenHash: 'unused-in-test',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      claimedOwnerId: null,
      claimedAt: null,
    };
    const guestQueue = {
      sessionId: guestId,
      position: 0,
      videoId: 'dQw4w9WgXcQ',
      title: 'A Little Respect',
      description: 'Karaoke',
      thumbnails: 'https://i.ytimg.com/test.jpg',
      performer: 'ELVIN',
    } as KaraokeQueueItem;
    const guestPerformer = { sessionId: guestId, position: 0, name: 'ELVIN' };
    let claimedSession: KaraokeSession | undefined;
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: ownerId }),
    };
    const sessionRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockImplementation(async () => claimedSession),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const now = new Date();
        claimedSession = {
          ...(value as KaraokeSession),
          createdAt: (value as KaraokeSession).createdAt ?? now,
          updatedAt: (value as KaraokeSession).updatedAt ?? now,
        };
        return claimedSession;
      }),
    };
    const queueRepository = {
      find: jest.fn().mockResolvedValue([guestQueue]),
      create: jest.fn((value) => value),
      save: jest.fn(async (values) => values),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const performerRepository = {
      find: jest.fn().mockResolvedValue([guestPerformer]),
      create: jest.fn((value) => value),
      save: jest.fn(async (values) => values),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const hostRepository = {
      findOne: jest.fn().mockResolvedValue(host),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return userRepository;
        if (entity === KaraokeSession) return sessionRepository;
        if (entity === KaraokeSessionPerformer) return performerRepository;
        if (entity === KaraokeRemoteHostSession) return hostRepository;
        return queueRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const { service } = createService({ dataSource });
    const input = {
      videoId: guestQueue.videoId,
      title: guestQueue.title,
      description: guestQueue.description,
      thumbnails: guestQueue.thumbnails,
      performer: guestQueue.performer,
    };
    const token = 'guest-host-token-123456789012345678901234567890';

    const first = await service.claimGuest(
      ownerId,
      guestId,
      token,
      '123e4567-e89b-42d3-a456-426614174001',
      [input],
      ['ELVIN'],
    );
    const second = await service.claimGuest(
      ownerId,
      guestId,
      token,
      '123e4567-e89b-42d3-a456-426614174001',
      [input],
      ['ELVIN'],
    );

    expect(first.session.id).toBe(guestId);
    expect(first.queue.map((song) => song.videoId)).toEqual([guestQueue.videoId]);
    expect(first.performers).toEqual(['ELVIN']);
    expect(second.session.id).toBe(guestId);
    expect(sessionRepository.save).toHaveBeenCalledTimes(1);
    expect(queueRepository.save).toHaveBeenCalledTimes(1);
    expect(host.claimedOwnerId).toBe(ownerId);
  });
});
