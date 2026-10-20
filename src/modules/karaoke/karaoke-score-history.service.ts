import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionStatus } from './entities/karaoke-session.entity';
import { KaraokeScoreHistory } from './entities/karaoke-score-history.entity';
import {
  KaraokeScoreHistoryCreateInput,
  KaraokeScoreHistoryResponse,
  KaraokeScoreLeaderboardResponse,
} from './karaoke-score-history.types';
import { KaraokeSessionService } from './karaoke-session.service';
import {
  KaraokeSessionHistoryDetailResponse,
  KaraokeSessionHistorySummaryResponse,
} from './karaoke-session.types';

export interface KaraokeLeaderboardSourceRecord {
  performerName: string;
  score: number;
  completedAt: Date;
}

export const LEADERBOARD_MIN_AVERAGE_SONGS = 3;
export const LEADERBOARD_MAX_PERFORMERS = 10;
const HISTORY_QUERY_LIMIT = 1000;

export function buildKaraokeLeaderboard(
  records: readonly KaraokeLeaderboardSourceRecord[],
  minimumAverageSongs = LEADERBOARD_MIN_AVERAGE_SONGS,
  maxPerformers = LEADERBOARD_MAX_PERFORMERS,
): KaraokeScoreLeaderboardResponse {
  const grouped = new Map<string, { performerName: string; scores: number[]; bestScore: number; bestAt: Date }>();

  for (const record of records) {
    const existing = grouped.get(record.performerName);
    if (!existing) {
      grouped.set(record.performerName, {
        performerName: record.performerName,
        scores: [record.score],
        bestScore: record.score,
        bestAt: record.completedAt,
      });
      continue;
    }

    existing.scores.push(record.score);
    if (record.score > existing.bestScore || (record.score === existing.bestScore && record.completedAt < existing.bestAt)) {
      existing.bestScore = record.score;
      existing.bestAt = record.completedAt;
    }
  }

  const groups = [...grouped.values()];
  const byName = (left: { performerName: string }, right: { performerName: string }) =>
    left.performerName.localeCompare(right.performerName, undefined, { sensitivity: 'base' }) || left.performerName.localeCompare(right.performerName);

  const highestScore = [...groups]
    .sort((left, right) => right.bestScore - left.bestScore || left.bestAt.getTime() - right.bestAt.getTime() || byName(left, right))
    .map((group) => ({ performerName: group.performerName, bestScore: group.bestScore }))
    .map((entry, index, entries) => ({ ...entry, rank: competitionRank(entries, index, (candidate) => candidate.bestScore ?? 0) }));

  const mostSongs = [...groups]
    .sort((left, right) => right.scores.length - left.scores.length || right.bestScore - left.bestScore || byName(left, right))
    .map((group) => ({ performerName: group.performerName, songCount: group.scores.length, bestScore: group.bestScore }))
    .map((entry, index, entries) => ({ ...entry, rank: competitionRank(entries, index, (candidate) => candidate.songCount ?? 0) }));

  const averageGroups = [...groups]
    .filter((group) => group.scores.length >= minimumAverageSongs)
    .map((group) => ({ ...group, rawAverageScore: average(group.scores) }))
    .sort((left, right) => right.rawAverageScore - left.rawAverageScore || right.bestScore - left.bestScore || byName(left, right));

  const bestAverage = averageGroups
    .map((group) => ({
      performerName: group.performerName,
      averageScore: Number(group.rawAverageScore.toFixed(1)),
      rawAverageScore: group.rawAverageScore,
      songCount: group.scores.length,
    }))
    .map((entry, index, entries) => ({ ...entry, rank: competitionRank(entries, index, (candidate) => candidate.rawAverageScore) }))
    .map(({ rawAverageScore: _rawAverageScore, ...entry }) => entry);

  return {
    highestScore: { entries: highestScore.slice(0, maxPerformers), totalPerformers: highestScore.length },
    mostSongs: { entries: mostSongs.slice(0, maxPerformers), totalPerformers: mostSongs.length },
    bestAverage: { entries: bestAverage.slice(0, maxPerformers), totalPerformers: bestAverage.length, minimumSongs: minimumAverageSongs },
  };
}

function average(scores: readonly number[]): number {
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

/**
 * Applies competition ranking: equal primary values share a rank and the next
 * rank skips the tied positions (1, 1, 1, 4). Secondary sort fields only make
 * tied entries deterministic; they never alter the rank.
 */
function competitionRank<T>(entries: readonly T[], index: number, value: (entry: T) => number): number {
  if (index === 0) return 1;
  return value(entries[index]) === value(entries[index - 1]) ? competitionRank(entries, index - 1, value) : index + 1;
}

@Injectable()
export class KaraokeScoreHistoryService {
  constructor(
    @InjectRepository(KaraokeScoreHistory)
    private readonly history: Repository<KaraokeScoreHistory>,
    @InjectRepository(KaraokeQueueItem)
    private readonly queueItems: Repository<KaraokeQueueItem>,
    private readonly sessions: KaraokeSessionService,
  ) {}

  async create(ownerId: string, sessionIdInput: unknown, input: KaraokeScoreHistoryCreateInput): Promise<KaraokeScoreHistoryResponse> {
    const sessionId = this.requiredUuid(sessionIdInput, 'sessionId');
    const performanceInstanceId = this.requiredUuid(input.performanceInstanceId, 'performanceInstanceId');
    const score = this.requiredScore(input.score);
    const scoreMessage = this.requiredText(input.scoreMessage, 255, 'scoreMessage');
    const artistSnapshot = this.optionalText(input.artistSnapshot, 255) || 'Unknown artist';
    const clientId = this.optionalUuid(input.clientId, 'clientId');

    await this.sessions.get(ownerId, sessionId, clientId);
    const existing = await this.history.findOne({ where: { sessionId, performanceInstanceId } });
    if (existing) return this.toResponse(existing);

    const session = await this.sessions.get(ownerId, sessionId, clientId);
    this.assertActive(session);
    const queueItem = await this.queueItems.findOne({ where: { id: performanceInstanceId, sessionId } });
    if (!queueItem) throw new BadRequestException('performanceInstanceId must identify the active queued song.');

    const performance = this.history.create({
      sessionId,
      performanceInstanceId,
      performerNameSnapshot: queueItem.performer,
      youtubeVideoId: queueItem.videoId,
      songTitleSnapshot: queueItem.title,
      artistSnapshot,
      score,
      scoreMessage,
      completedAt: new Date(),
    });

    try {
      return this.toResponse(await this.history.save(performance));
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const duplicate = await this.history.findOne({ where: { sessionId, performanceInstanceId } });
        if (duplicate) return this.toResponse(duplicate);
      }
      throw error;
    }
  }

  async list(ownerId: string, sessionIdInput: unknown, clientIdInput?: unknown): Promise<KaraokeScoreHistoryResponse[]> {
    const sessionId = this.requiredUuid(sessionIdInput, 'sessionId');
    await this.sessions.get(ownerId, sessionId, this.optionalUuid(clientIdInput, 'clientId'));
    const rows = await this.history.find({ where: { sessionId }, order: { completedAt: 'DESC', id: 'DESC' }, take: HISTORY_QUERY_LIMIT });
    return rows.map((row) => this.toResponse(row));
  }

  async leaderboard(ownerId: string, sessionIdInput: unknown, clientIdInput?: unknown): Promise<KaraokeScoreLeaderboardResponse> {
    const sessionId = this.requiredUuid(sessionIdInput, 'sessionId');
    await this.sessions.get(ownerId, sessionId, this.optionalUuid(clientIdInput, 'clientId'));
    const rows = await this.history.find({ where: { sessionId }, order: { completedAt: 'ASC', id: 'ASC' }, take: HISTORY_QUERY_LIMIT });
    return buildKaraokeLeaderboard(rows.map((row) => ({ performerName: row.performerNameSnapshot, score: row.score, completedAt: row.completedAt })));
  }

  async listSessionHistory(ownerId: string): Promise<KaraokeSessionHistorySummaryResponse[]> {
    const sessions = await this.sessions.listHistory(ownerId);
    if (sessions.length === 0) return [];

    const rows = await this.history.find({
      where: { sessionId: In(sessions.map((session) => session.id)) },
      order: { completedAt: 'ASC', id: 'ASC' },
    });
    const rowsBySession = new Map<string, KaraokeScoreHistory[]>();
    for (const row of rows) {
      const sessionRows = rowsBySession.get(row.sessionId) || [];
      sessionRows.push(row);
      rowsBySession.set(row.sessionId, sessionRows);
    }

    return sessions.map((session) => {
      const sessionRows = rowsBySession.get(session.id) || [];
      const topRow = [...sessionRows].sort((left, right) => right.score - left.score || left.completedAt.getTime() - right.completedAt.getTime())[0];
      return {
        ...session,
        totalPerformances: sessionRows.length,
        topScore: topRow?.score ?? null,
        topPerformer: topRow?.performerNameSnapshot ?? null,
      };
    });
  }

  async getSessionHistoryDetail(ownerId: string, sessionIdInput: unknown): Promise<KaraokeSessionHistoryDetailResponse> {
    const sessionId = this.requiredUuid(sessionIdInput, 'sessionId');
    const session = await this.sessions.getHistorySession(ownerId, sessionId);
    const rows = await this.history.find({ where: { sessionId }, order: { completedAt: 'DESC', id: 'DESC' } });
    return {
      session,
      performances: rows.map((row) => this.toResponse(row)),
      leaderboard: buildKaraokeLeaderboard(rows.map((row) => ({ performerName: row.performerNameSnapshot, score: row.score, completedAt: row.completedAt }))),
    };
  }

  private toResponse(row: KaraokeScoreHistory): KaraokeScoreHistoryResponse {
    return { id: row.id, performanceInstanceId: row.performanceInstanceId, performerName: row.performerNameSnapshot, songTitle: row.songTitleSnapshot, artist: row.artistSnapshot, youtubeVideoId: row.youtubeVideoId, score: row.score, scoreMessage: row.scoreMessage, completedAt: row.completedAt };
  }

  private assertActive(session: { status: KaraokeSessionStatus; leaseExpiresAt: Date }): void {
    if (session.status !== KaraokeSessionStatus.ACTIVE || session.leaseExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException({ code: 'karaoke_session_not_active', message: 'This karaoke session is no longer active.', status: session.status });
    }
  }

  private requiredUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) throw new BadRequestException(`${field} must be a UUID.`);
    return value.trim();
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    return this.requiredUuid(value, field);
  }

  private requiredScore(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new BadRequestException('score must be an integer between 0 and 100.');
    return value;
  }

  private requiredText(value: unknown, max: number, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private optionalText(value: unknown, max: number): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException('artistSnapshot is invalid.');
    return value.trim();
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && ((error as { code?: unknown }).code === 'ER_DUP_ENTRY' || (error as { code?: unknown }).code === '23505');
  }
}
