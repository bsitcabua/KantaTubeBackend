export interface KaraokeScoreHistoryCreateInput {
  performanceInstanceId?: unknown;
  score?: unknown;
  scoreMessage?: unknown;
  artistSnapshot?: unknown;
  clientId?: unknown;
}

export interface KaraokeScoreHistoryResponse {
  id: string;
  performanceInstanceId: string;
  performerName: string;
  songTitle: string;
  artist: string;
  youtubeVideoId: string;
  score: number;
  scoreMessage: string;
  completedAt: Date;
}

export interface KaraokeLeaderboardEntry {
  rank: number;
  performerName: string;
  bestScore?: number;
  songCount?: number;
  averageScore?: number;
}

export interface KaraokeLeaderboardCategory {
  entries: KaraokeLeaderboardEntry[];
  totalPerformers: number;
}

export interface KaraokeScoreLeaderboardResponse {
  highestScore: KaraokeLeaderboardCategory;
  mostSongs: KaraokeLeaderboardCategory;
  bestAverage: KaraokeLeaderboardCategory & { minimumSongs: number };
}
