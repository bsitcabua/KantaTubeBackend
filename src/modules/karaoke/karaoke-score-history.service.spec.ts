import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionStatus } from './entities/karaoke-session.entity';
import { KaraokeScoreHistory } from './entities/karaoke-score-history.entity';
import { buildKaraokeLeaderboard, KaraokeScoreHistoryService } from './karaoke-score-history.service';
import { KaraokeSessionService } from './karaoke-session.service';

describe('KaraokeScoreHistoryService', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174000';
  const sessionId = '123e4567-e89b-42d3-a456-426614174001';
  const performanceInstanceId = '123e4567-e89b-42d3-a456-426614174002';
  const clientId = '123e4567-e89b-42d3-a456-426614174003';

  const activeSession = {
    id: sessionId,
    status: KaraokeSessionStatus.ACTIVE,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };

  type HistoryMock = { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock };
  type QueueMock = { findOne: jest.Mock };
  type SessionsMock = { get: jest.Mock };

  function createService(overrides: {
    history?: Partial<HistoryMock>;
    queue?: Partial<QueueMock>;
    sessions?: Partial<SessionsMock>;
  } = {}) {
    const history = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'history-id', createdAt: new Date(), ...value })),
      find: jest.fn().mockResolvedValue([]),
      ...overrides.history,
    } as HistoryMock;
    const queue = {
      findOne: jest.fn().mockResolvedValue({
        id: performanceInstanceId,
        sessionId,
        performer: 'ELVIN',
        videoId: 'dQw4w9WgXcQ',
        title: 'Bahay Kubo',
      }),
      ...overrides.queue,
    } as QueueMock;
    const sessions = {
      get: jest.fn().mockResolvedValue(activeSession),
      ...overrides.sessions,
    } as SessionsMock;
    return {
      service: new KaraokeScoreHistoryService(
        history as unknown as Repository<KaraokeScoreHistory>,
        queue as unknown as Repository<KaraokeQueueItem>,
        sessions as unknown as KaraokeSessionService,
      ),
      history,
      queue,
      sessions,
    };
  }

  it('stores one valid completed performance using server-side queue snapshots', async () => {
    const { service, history, queue } = createService();

    const result = await service.create(ownerId, sessionId, {
      performanceInstanceId,
      score: 95,
      scoreMessage: "Superstar! You're the next big thing!",
      artistSnapshot: 'Ang Karaoke Kho',
      clientId,
    });

    expect(queue.findOne).toHaveBeenCalledWith({ where: { id: performanceInstanceId, sessionId } });
    expect(history.save).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      performanceInstanceId,
      performerNameSnapshot: 'ELVIN',
      songTitleSnapshot: 'Bahay Kubo',
      score: 95,
    }));
    expect(result.performerName).toBe('ELVIN');
  });

  it('does not write for an unauthorized session', async () => {
    const { service, history } = createService({
      sessions: { get: jest.fn().mockRejectedValue(new ForbiddenException()) },
    });

    await expect(service.create(ownerId, sessionId, {
      performanceInstanceId,
      score: 95,
      scoreMessage: 'Great',
      clientId,
    })).rejects.toThrow(ForbiddenException);
    expect(history.save).not.toHaveBeenCalled();
  });

  it('returns an existing row for duplicate completion callbacks', async () => {
    const existing = {
      id: 'history-id',
      performanceInstanceId,
      performerNameSnapshot: 'ELVIN',
      songTitleSnapshot: 'Bahay Kubo',
      artistSnapshot: 'Artist',
      youtubeVideoId: 'dQw4w9WgXcQ',
      score: 95,
      scoreMessage: 'Great',
      completedAt: new Date(),
    } as KaraokeScoreHistory;
    const { service, history, queue } = createService({ history: { findOne: jest.fn().mockResolvedValue(existing) } });

    const result = await service.create(ownerId, sessionId, {
      performanceInstanceId,
      score: 95,
      scoreMessage: 'Great',
      clientId,
    });

    expect(result.id).toBe(existing.id);
    expect(queue.findOne).not.toHaveBeenCalled();
    expect(history.save).not.toHaveBeenCalled();
  });

  it('rejects invalid scores before touching persistence', async () => {
    const { service, sessions } = createService();
    await expect(service.create(ownerId, sessionId, {
      performanceInstanceId,
      score: 101,
      scoreMessage: 'Invalid',
      clientId,
    })).rejects.toThrow('score must be an integer between 0 and 100');
    expect(sessions.get).not.toHaveBeenCalled();
  });

  it('keeps history session-scoped', async () => {
    const { service, history } = createService({
      history: { find: jest.fn().mockResolvedValue([]) },
    });

    await service.list(ownerId, sessionId, clientId);
    expect(history.find).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId } }));
  });
});

describe('buildKaraokeLeaderboard', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
  const record = (performerName: string, score: number, minute: number) => ({ performerName, score, completedAt: at(minute) });

  it('builds all three categories and excludes performers below the average threshold', () => {
    const result = buildKaraokeLeaderboard([
      record('ELVIN', 95, 1), record('ELVIN', 97, 2), record('ELVIN', 93, 3),
      record('GINA', 91, 4), record('GINA', 94, 5), record('GINA', 96, 6),
      record('GEMMA', 92, 7), record('MARK', 89, 8),
    ]);

    expect(result.highestScore.entries.slice(0, 3).map((entry) => [entry.performerName, entry.bestScore])).toEqual([
      ['ELVIN', 97], ['GINA', 96], ['GEMMA', 92],
    ]);
    expect(result.mostSongs.entries.slice(0, 2).map((entry) => [entry.performerName, entry.songCount])).toEqual([
      ['ELVIN', 3], ['GINA', 3],
    ]);
    expect(result.bestAverage.entries.map((entry) => [entry.performerName, entry.averageScore])).toEqual([
      ['ELVIN', 95], ['GINA', 93.7],
    ]);
    expect(result.bestAverage.minimumSongs).toBe(3);
  });

  it('uses earliest achievement and stable name order for ties', () => {
    const result = buildKaraokeLeaderboard([
      record('Zoe', 95, 2),
      record('Amy', 95, 1),
      record('Bea', 90, 3),
      record('Bea', 90, 4),
    ]);

    expect(result.highestScore.entries.slice(0, 3).map((entry) => [entry.performerName, entry.rank])).toEqual([
      ['Amy', 1], ['Zoe', 1], ['Bea', 3],
    ]);
    expect(result.mostSongs.entries.slice(0, 3).map((entry) => [entry.performerName, entry.rank])).toEqual([
      ['Bea', 1], ['Amy', 2], ['Zoe', 2],
    ]);
  });

  it('uses competition ranks for tied highest scores and skips the next position', () => {
    const result = buildKaraokeLeaderboard([
      record('EM', 100, 1),
      record('GERSON', 100, 2),
      record('BALOK', 100, 3),
      record('PEDRO', 94, 4),
    ]);

    expect(result.highestScore.entries.map((entry) => [entry.performerName, entry.rank])).toEqual([
      ['EM', 1], ['GERSON', 1], ['BALOK', 1], ['PEDRO', 4],
    ]);
  });

  it('ranks tied song counts and raw averages before display rounding', () => {
    const records = [
      ...[80, 80, 80, 80].map((score, index) => record('EM', score, index + 1)),
      ...[80, 80, 80, 80].map((score, index) => record('GERSON', score, index + 10)),
      ...[75, 75, 75, 75].map((score, index) => record('BALOK', score, index + 20)),
      record('PEDRO', 100, 30),
    ];
    const result = buildKaraokeLeaderboard(records);

    expect(result.mostSongs.entries.map((entry) => [entry.performerName, entry.rank])).toEqual([
      ['EM', 1], ['GERSON', 1], ['BALOK', 1], ['PEDRO', 4],
    ]);
    expect(result.bestAverage.entries.map((entry) => [entry.performerName, entry.averageScore, entry.rank, entry.songCount])).toEqual([
      ['EM', 80, 1, 4], ['GERSON', 80, 1, 4], ['BALOK', 75, 3, 4],
    ]);
  });
});
