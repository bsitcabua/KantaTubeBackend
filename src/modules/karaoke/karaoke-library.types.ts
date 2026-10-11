import { KaraokeFavoriteSourceType } from './entities/karaoke-favorite.entity';

export interface FavoriteResponse {
  id: string;
  sourceType: KaraokeFavoriteSourceType;
  songbookSongId: number | null;
  youtubeVideoId: string | null;
  title: string;
  artist: string | null;
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
}

export interface PlaylistItemResponse {
  id: string;
  sourceType: KaraokeFavoriteSourceType;
  songbookSongId: number | null;
  youtubeVideoId: string | null;
  title: string;
  artist: string | null;
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
}

export interface PaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
