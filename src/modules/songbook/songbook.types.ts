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
  /** Total before an A-Z/# browse-letter filter is applied. */
  catalogTotal?: number;
}

export interface SongbookSearchResponse {
  data: SongbookSongResponse[];
  pagination: SongbookPaginationResponse;
}

export interface SongbookArtistResponse {
  artist: string;
  songCount: number;
}

export interface SongbookArtistBrowseResponse {
  data: SongbookArtistResponse[];
  pagination: SongbookPaginationResponse;
}

export interface SongbookFiltersResponse {
  languages: string[];
  categories: string[];
}
