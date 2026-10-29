import { KaraokeSessionStatus } from './entities/karaoke-session.entity';
import type {
  KaraokeScoreHistoryResponse,
  KaraokeScoreLeaderboardResponse,
} from './karaoke-score-history.types';

export interface KaraokeSessionResponse {
  id: string;
  alias: string;
  status: KaraokeSessionStatus;
  /** Absolute instants serialized as UTC ISO-8601 strings. */
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Persisted queue size exposed to account/session summary views. */
  queueCount?: number;
  /** In-memory authoritative Host presence, when the session is active. */
  hostPresence?: 'live' | 'none';
  usage?: KaraokeUsageSummaryResponse;
}

export interface KaraokeUsageSummaryResponse {
  usageDate: string;
  dailyAllowanceSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  accessSource: 'free' | 'paid';
  quotaLocked: boolean;
  quotaExhaustionPending: boolean;
  canUseKaraoke: boolean;
  nextResetAt: string;
}

export interface KaraokeSessionHistorySummaryResponse extends KaraokeSessionResponse {
  totalPerformances: number;
  topScore: number | null;
  topPerformer: string | null;
}

export interface KaraokeSessionHistoryDetailResponse {
  session: KaraokeSessionResponse;
  performances: KaraokeScoreHistoryResponse[];
  leaderboard: KaraokeScoreLeaderboardResponse;
}

export interface KaraokeQueueItemResponse {
  queueItemId?: string;
  videoId: string;
  title: string;
  description: string;
  thumbnails: string;
  performer: string;
}

export interface KaraokeSessionTransferResponse {
  session: KaraokeSessionResponse;
  queue: KaraokeQueueItemResponse[];
  performers: string[];
}

export interface KaraokeGuestSessionClaimResponse {
  session: KaraokeSessionResponse;
  queue: KaraokeQueueItemResponse[];
  performers: string[];
  replacedSessionId: string | null;
}
