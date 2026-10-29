import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { DailyKaraokeUsage } from './entities/daily-karaoke-usage.entity';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokeUsageService } from './karaoke-usage.service';
import { getApplicationDateKey } from '../../common/date-time/application-date-time';

describe('KaraokeUsageService', () => {
  const createdServices: KaraokeUsageService[] = [];

  afterEach(() => {
    createdServices.splice(0).forEach((service) => service.onModuleDestroy());
  });
  const ownerId = '123e4567-e89b-42d3-a456-426614174000';
  const sessionId = '123e4567-e89b-42d3-a456-426614174001';

  function session(overrides: Partial<KaraokeSession> = {}): KaraokeSession {
    const now = new Date();
    return {
      id: sessionId,
      ownerId,
      alias: 'Living Room',
      sessionDay: serviceDate(new Date().toISOString()),
      status: KaraokeSessionStatus.ACTIVE,
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      clientId: null,
      endedAt: null,
      hasStartedSong: false,
      firstSongStartedAt: null,
      currentSongActive: false,
      currentQueueItemId: null,
      quotaExhaustionPending: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as KaraokeSession;
  }

  function createService(options: {
    freeMinutes?: string;
    usage?: Partial<Repository<DailyKaraokeUsage>>;
    sessions?: Partial<Repository<KaraokeSession>>;
    transactionRepositories?: Partial<Record<'user' | 'session' | 'usage' | 'queue', object>>;
  } = {}) {
    const usage = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      ...options.usage,
    } as unknown as Repository<DailyKaraokeUsage>;
    const sessions = {
      findOne: jest.fn().mockResolvedValue(session()),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
      ...options.sessions,
    } as unknown as Repository<KaraokeSession>;
    const transactionRepositories = options.transactionRepositories ?? {};
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return transactionRepositories.user ?? { findOne: jest.fn().mockResolvedValue({ id: ownerId }) };
        if (entity === KaraokeSession) return transactionRepositories.session ?? sessions;
        if (entity === DailyKaraokeUsage) return transactionRepositories.usage ?? usage;
        if (entity === KaraokeQueueItem) return transactionRepositories.queue ?? { findOne: jest.fn().mockResolvedValue(null) };
        return {};
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    } as unknown as DataSource;
    const values: Record<string, unknown> = {
      FREE_DAILY_KARAOKE_MINUTES: options.freeMinutes ?? '120',
      FREE_USAGE_RESET_TIMEZONE: 'Asia/Manila',
      USAGE_DISCONNECT_GRACE_SECONDS: '60',
      ALLOW_CURRENT_SONG_TO_FINISH_AFTER_LIMIT: 'true',
      MAX_CURRENT_SESSIONS: '1',
      USAGE_HEARTBEAT_GAP_CAP_SECONDS: '60',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const service = new KaraokeUsageService(dataSource, usage, sessions, config);
    createdServices.push(service);
    return {
      service,
      usage,
      sessions,
      manager,
    };
  }

  it('reports remaining allowance from the daily usage row', async () => {
    const { service } = createService({
      usage: { findOne: jest.fn().mockResolvedValue({ usedSeconds: 7_199 }) },
    });

    const result = await service.resolveKaraokeAccess(ownerId);

    expect(result.dailyAllowanceSeconds).toBe(7_200);
    expect(result.usedSeconds).toBe(7_199);
    expect(result.remainingSeconds).toBe(1);
    expect(result.canUseKaraoke).toBe(true);
    expect(result.accessSource).toBe('free');
  });

  it('returns the next Asia/Manila midnight as an unambiguous UTC timestamp', async () => {
    const { service } = createService();
    const result = await service.resolveKaraokeAccess(
      ownerId,
      null,
      new Date('2026-10-20T15:59:59.999Z'),
    );

    expect(result.usageDate).toBe('2026-10-20');
    expect(result.nextResetAt).toBe('2026-10-20T16:00:00.000Z');
  });

  it('caps a delayed heartbeat before accounting and locks at the allowance', async () => {
    const active = session();
    const transactionSession = {
      ...active,
      currentSongActive: false,
    };
    const usageRow = { usedSeconds: 0 };
    const { service, usage, sessions } = createService({
      freeMinutes: '1',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: {
          findOne: jest.fn().mockResolvedValue(usageRow),
          save: jest.fn(async (value) => value),
        },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    const presence = (service as unknown as { presence: Map<string, { lastAccountedAt: Date }> }).presence.get(sessionId)!;
    presence.lastAccountedAt = new Date(Date.now() - 120_000);
    await service.heartbeatHost(ownerId, sessionId);

    expect(usageRow.usedSeconds).toBe(60);
    expect(transactionSession.status).toBe(KaraokeSessionStatus.LOCKED_QUOTA);
    expect(sessions.findOne).toHaveBeenCalled();
    expect(usage.save).not.toHaveBeenCalled();
  });

  it('marks quota exhaustion pending while the current song is allowed to finish', async () => {
    const active = session({ currentSongActive: true });
    const transactionSession = session({ currentSongActive: true });
    const usageRow = { usedSeconds: 59 };
    const { service } = createService({
      freeMinutes: '1',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: {
          findOne: jest.fn().mockResolvedValue(usageRow),
          save: jest.fn(async (value) => value),
        },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    const presence = (service as unknown as { presence: Map<string, { lastAccountedAt: Date }> }).presence.get(sessionId)!;
    presence.lastAccountedAt = new Date(Date.now() - 2_000);
    await service.heartbeatHost(ownerId, sessionId);

    expect(usageRow.usedSeconds).toBe(60);
    expect(transactionSession.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(transactionSession.quotaExhaustionPending).toBe(true);
  });

  it('locks only after the current song is finalized at quota zero', async () => {
    const active = session({ currentSongActive: true });
    const transactionSession = session({ currentSongActive: true });
    const usageRow = { usedSeconds: 59 };
    const queueUpdate = jest.fn().mockResolvedValue({ affected: 0 });
    const { service } = createService({
      freeMinutes: '1',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: {
          findOne: jest.fn().mockResolvedValue(usageRow),
          save: jest.fn(async (value) => value),
        },
        queue: { update: queueUpdate },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    const presence = (service as unknown as { presence: Map<string, { lastAccountedAt: Date }> }).presence.get(sessionId)!;
    presence.lastAccountedAt = new Date(Date.now() - 2_000);
    await service.heartbeatHost(ownerId, sessionId);
    expect(transactionSession.quotaExhaustionPending).toBe(true);

    const finalized = await service.finalizeSong(ownerId, sessionId);

    expect(finalized.status).toBe(KaraokeSessionStatus.LOCKED_QUOTA);
    expect(transactionSession.status).toBe(KaraokeSessionStatus.LOCKED_QUOTA);
    expect(transactionSession.currentSongActive).toBe(false);
    expect(queueUpdate).toHaveBeenCalledWith({ sessionId, scoreEligible: true }, { scoreEligible: false });
  });

  it('allows the pending current queue item but rejects a different song', async () => {
    const currentQueueItemId = '123e4567-e89b-42d3-a456-426614174010';
    const nextQueueItemId = '123e4567-e89b-42d3-a456-426614174011';
    const active = session({ currentSongActive: true, currentQueueItemId, quotaExhaustionPending: true });
    const transactionSession = session({ currentSongActive: true, currentQueueItemId, quotaExhaustionPending: true });
    const currentQueueItem = { id: currentQueueItemId, sessionId, scoreEligible: false };
    const queueFindOne = jest.fn().mockResolvedValue(currentQueueItem);
    const { service } = createService({
      freeMinutes: '1',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: { findOne: jest.fn().mockResolvedValue({ usedSeconds: 60 }) },
        queue: { findOne: queueFindOne },
      },
    });

    const resumed = await service.markSongStarted(ownerId, sessionId, currentQueueItemId);
    expect(resumed.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(transactionSession.quotaExhaustionPending).toBe(true);

    await expect(service.markSongStarted(ownerId, sessionId, nextQueueItemId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'karaoke_quota_exhausted' }),
    });
  });

  it('terminates a pending song without score eligibility and locks the session', async () => {
    const active = session({ currentSongActive: true, quotaExhaustionPending: true });
    const transactionSession = session({ currentSongActive: true, quotaExhaustionPending: true });
    const queueUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const { service } = createService({
      freeMinutes: '1',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: { findOne: jest.fn().mockResolvedValue({ usedSeconds: 60 }) },
        queue: { update: queueUpdate },
      },
    });

    const terminated = await service.terminateSong(ownerId, sessionId);

    expect(terminated.status).toBe(KaraokeSessionStatus.LOCKED_QUOTA);
    expect(transactionSession.currentSongActive).toBe(false);
    expect(transactionSession.quotaExhaustionPending).toBe(false);
    expect(queueUpdate).toHaveBeenCalledWith({ sessionId, scoreEligible: true }, { scoreEligible: false });
  });

  it('accounts only the configured disconnect grace before removing presence', async () => {
    const active = session();
    const transactionSession = session();
    const usageRow = { usedSeconds: 0 };
    const { service } = createService({
      freeMinutes: '2',
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: {
          findOne: jest.fn().mockResolvedValue(usageRow),
          save: jest.fn(async (value) => value),
        },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    expect(service.hasLiveHost(sessionId)).toBe(true);
    await service.disconnectHost(sessionId, 'socket-1');
    expect(service.hasLiveHost(sessionId)).toBe(false);
    const presence = (service as unknown as { presence: Map<string, { disconnectedAt: Date; lastAccountedAt: Date }> }).presence.get(sessionId)!;
    const disconnectTime = new Date(Date.now() - 60_000);
    presence.disconnectedAt = disconnectTime;
    presence.lastAccountedAt = disconnectTime;
    await (service as unknown as { flushPresence: () => Promise<void> }).flushPresence();

    expect(usageRow.usedSeconds).toBe(60);
    expect((service as unknown as { presence: Map<string, unknown> }).presence.has(sessionId)).toBe(false);
  });

  it('keeps a locked session readable and blocks new playback commands', async () => {
    const locked = session({ status: KaraokeSessionStatus.LOCKED_QUOTA });
    const { service } = createService({ sessions: { findOne: jest.fn().mockResolvedValue(locked) } });

    await expect(service.assertRemoteCommandAccess(ownerId, sessionId, 'nextSong')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'karaoke_quota_exhausted' }),
    });
    const summary = await service.resolveKaraokeAccess(ownerId, locked);
    expect(summary.quotaLocked).toBe(true);
    expect(summary.canUseKaraoke).toBe(false);
  });

  it('allows a pending remote Next to reach the host termination path but blocks new playback', async () => {
    const pending = session({ currentSongActive: true, quotaExhaustionPending: true });
    const { service } = createService({ sessions: { findOne: jest.fn().mockResolvedValue(pending) } });

    await expect(service.assertRemoteCommandAccess(ownerId, sessionId, 'nextSong')).resolves.toBeUndefined();
    await expect(service.assertRemoteCommandAccess(ownerId, sessionId, 'restartVideo')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'karaoke_quota_exhausted' }),
    });
  });

  it('accounts concurrent host tabs once and keeps one tab alive when another disconnects', async () => {
    const active = session();
    const transactionSession = session();
    const usageRow = { usedSeconds: 0 };
    const { service } = createService({
      sessions: { findOne: jest.fn().mockResolvedValue(active) },
      transactionRepositories: {
        session: {
          findOne: jest.fn().mockResolvedValue(transactionSession),
          save: jest.fn(async (value) => value),
        },
        usage: {
          findOne: jest.fn().mockResolvedValue(usageRow),
          save: jest.fn(async (value) => value),
        },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    await service.connectHost(ownerId, sessionId, 'socket-2');
    const presence = (service as unknown as { presence: Map<string, { lastAccountedAt: Date; socketIds: Set<string>; connected: boolean }> }).presence.get(sessionId)!;
    presence.lastAccountedAt = new Date(Date.now() - 10_000);

    await Promise.all([
      service.heartbeatHost(ownerId, sessionId),
      service.heartbeatHost(ownerId, sessionId),
    ]);

    expect(usageRow.usedSeconds).toBeLessThanOrEqual(10);
    await service.disconnectHost(sessionId, 'socket-1');
    expect(presence.connected).toBe(true);
    expect(presence.socketIds).toEqual(new Set(['socket-2']));
  });

  it('rolls over prior-day active and locked sessions, including stale current-song state', async () => {
    const active = session({ sessionDay: '2026-10-20', currentSongActive: false });
    const locked = session({ id: '123e4567-e89b-42d3-a456-426614174002', sessionDay: '2026-10-20', status: KaraokeSessionStatus.LOCKED_QUOTA });
    const staleSong = session({ id: '123e4567-e89b-42d3-a456-426614174003', sessionDay: '2026-10-20', currentSongActive: true, hasStartedSong: true });
    const candidates = [active, locked, staleSong];
    const save = jest.fn(async (value) => value);
    const { service } = createService({
      sessions: { find: jest.fn().mockResolvedValue(candidates) },
      transactionRepositories: {
        session: { find: jest.fn().mockResolvedValue(candidates), save },
        queue: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
      },
    });

    await service.rolloverOwner(ownerId, new Date('2026-10-20T16:00:01.000Z'));

    expect(candidates.every((candidate) => candidate.status === KaraokeSessionStatus.ENDED)).toBe(true);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('does not roll over a same-day locked session', async () => {
    const locked = session({
      sessionDay: '2026-10-21',
      status: KaraokeSessionStatus.LOCKED_QUOTA,
    });
    const save = jest.fn(async (value) => value);
    const { service } = createService({
      sessions: { find: jest.fn().mockResolvedValue([locked]) },
      transactionRepositories: {
        session: { find: jest.fn().mockResolvedValue([locked]), save },
        queue: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
      },
    });

    await service.rolloverOwner(ownerId, new Date('2026-10-20T16:00:01.000Z'));

    expect(locked.status).toBe(KaraokeSessionStatus.LOCKED_QUOTA);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a prior-day song alive only while a host is connected', async () => {
    const active = session({ sessionDay: '2026-10-20', currentSongActive: true, hasStartedSong: true });
    const save = jest.fn(async (value) => value);
    const { service } = createService({
      sessions: { findOne: jest.fn().mockResolvedValue(active), find: jest.fn().mockResolvedValue([active]) },
      transactionRepositories: {
        session: { find: jest.fn().mockResolvedValue([active]), save },
        queue: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
      },
    });

    await service.connectHost(ownerId, sessionId, 'socket-1');
    await service.rolloverOwner(ownerId, new Date('2026-10-20T16:00:01.000Z'));

    expect(active.status).toBe(KaraokeSessionStatus.ACTIVE);
    expect(save).not.toHaveBeenCalled();
  });

  it('maps the configured Asia/Manila day boundary deterministically', () => {
    expect(serviceDate('2026-10-20T15:59:59.000Z')).toBe('2026-10-20');
    expect(serviceDate('2026-10-20T16:00:01.000Z')).toBe('2026-10-21');
  });
});

function serviceDate(iso: string): string {
  return getApplicationDateKey(new Date(iso));
}
