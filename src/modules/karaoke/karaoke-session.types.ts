import { KaraokeSessionStatus } from './entities/karaoke-session.entity';

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

export interface KaraokeQueueItemResponse {
  videoId: string;
  title: string;
  description: string;
  thumbnails: string;
  performer: string;
}

export interface KaraokeSessionTransferResponse {
  session: KaraokeSessionResponse;
  queue: KaraokeQueueItemResponse[];
}
