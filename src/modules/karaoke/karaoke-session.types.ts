import { KaraokeSessionStatus } from './entities/karaoke-session.entity';
import type {
  KaraokeScoreHistoryResponse,
  KaraokeScoreLeaderboardResponse,
} from './karaoke-score-history.types';

export interface KaraokeSessionResponse {
  id: string;
  alias: string;
  status: KaraokeSessionStatus;
  lastHeartbeatAt: Date;
  leaseExpiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
