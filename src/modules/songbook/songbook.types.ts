export interface SongbookSongResponse {
  id: number;
  title: string;
  artist: string;
  language: string;
  category: string;
  youtubeVideoId: string | null;
  source: string;
  isVerifiedKaraoke: boolean;
}

export interface SongbookPaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SongbookSearchResponse {
  data: SongbookSongResponse[];
  pagination: SongbookPaginationResponse;
}

export interface SongbookFiltersResponse {
  languages: string[];
  categories: string[];
}
