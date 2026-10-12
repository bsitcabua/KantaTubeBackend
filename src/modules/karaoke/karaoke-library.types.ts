import { KaraokeFavoriteSourceType } from './entities/karaoke-favorite.entity';
import { KaraokeLibraryVisibility } from './karaoke-library-visibility';

export interface FavoriteResponse {
  id: string;
  sourceType: KaraokeFavoriteSourceType;
  visibility: KaraokeLibraryVisibility;
  songbookSongId: number | null;
  youtubeVideoId: string | null;
  title: string;
  artist: string | null;
  language: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FavoritesListResponse {
  data: FavoriteResponse[];
  pagination: PaginationResponse;
}

export interface PlaylistListResponse {
  data: PlaylistSummaryResponse[];
  pagination: PaginationResponse;
}

export interface PlaylistSummaryResponse {
  id: string;
  name: string;
  itemCount: number;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  visibility: KaraokeLibraryVisibility;
}

export interface PlaylistItemResponse {
  id: string;
  sourceType: KaraokeFavoriteSourceType;
  songbookSongId: number | null;
  youtubeVideoId: string | null;
  title: string;
  artist: string | null;
  language: string | null;
  category: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistResponse {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItemResponse[];
  itemCount: number;
  thumbnailUrl: string | null;
  visibility: KaraokeLibraryVisibility;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
