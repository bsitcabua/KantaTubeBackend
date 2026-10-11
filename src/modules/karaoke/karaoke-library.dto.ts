import { BadRequestException } from '@nestjs/common';
import { KaraokeFavoriteSourceType } from './entities/karaoke-favorite.entity';

export interface FavoriteInput {
  sourceType: KaraokeFavoriteSourceType;
  songbookSongId?: number;
  youtubeVideoId?: string;
  title?: string;
  artist?: string;
  thumbnailUrl?: string;
}

export interface PlaylistInput {
  name: string;
  description?: string;
}

export interface PlaylistItemInput extends FavoriteInput {
  description?: string;
}

export function parseFavoriteInput(value: unknown): FavoriteInput {
  if (!value || typeof value !== 'object') {
    throw new BadRequestException('Favorite payload must be an object.');
  }
  const input = value as Record<string, unknown>;
  return {
    sourceType: parseSourceType(input.sourceType),
    ...(input.songbookSongId !== undefined
      ? { songbookSongId: parseSongbookId(input.songbookSongId) }
      : {}),
    ...(input.youtubeVideoId !== undefined
      ? { youtubeVideoId: parseYoutubeVideoId(input.youtubeVideoId) }
      : {}),
    ...(input.title !== undefined ? { title: parseText(input.title, 255, 'title') } : {}),
    ...(input.artist !== undefined ? { artist: parseNullableText(input.artist, 255, 'artist') ?? undefined } : {}),
    ...(input.thumbnailUrl !== undefined
      ? { thumbnailUrl: parseUrl(input.thumbnailUrl, 2048, 'thumbnailUrl') }
      : {}),
  };
}

export function parsePlaylistInput(value: unknown): PlaylistInput {
  if (!value || typeof value !== 'object') {
    throw new BadRequestException('Playlist payload must be an object.');
  }
  const input = value as Record<string, unknown>;
  return {
    name: parsePlaylistName(input.name),
    ...(input.description !== undefined
      ? { description: parseNullableText(input.description, 500, 'description') ?? undefined }
      : {}),
  };
}

export function parsePlaylistItemInput(value: unknown): PlaylistItemInput {
  const input = parseFavoriteInput(value);
  const description =
    value && typeof value === 'object' && 'description' in value
      ? parseNullableText((value as Record<string, unknown>).description, 1000, 'description')
      : undefined;
  return { ...input, ...(description ? { description } : {}) };
}

export function parsePagination(pageInput: unknown, limitInput: unknown): { page: number; limit: number } {
  const page = parsePositiveInteger(pageInput, 1, 100000, 1, 'page');
  const limit = parsePositiveInteger(limitInput, 1, 100, 50, 'limit');
  return { page, limit };
}

export function parseSearch(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > 100) {
    throw new BadRequestException('search must be at most 100 characters.');
  }
  const search = value.trim().replace(/\s+/g, ' ');
  return search || undefined;
}

export function parseUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return value;
}

export function parseReorderInput(value: unknown): string[] {
  const itemIdsValue = value && typeof value === 'object' ? (value as Record<string, unknown>).itemIds : undefined;
  if (!Array.isArray(itemIdsValue)) {
    throw new BadRequestException('itemIds must be an array.');
  }
  const itemIds = itemIdsValue.map((itemId, index) => parseUuid(String(itemId), `itemIds[${index}]`));
  if (new Set(itemIds).size !== itemIds.length) throw new BadRequestException('itemIds must not contain duplicates.');
  return itemIds;
}

export function parseSourceType(value: unknown): KaraokeFavoriteSourceType {
  if (value === KaraokeFavoriteSourceType.SONGBOOK || value === KaraokeFavoriteSourceType.YOUTUBE) return value;
  throw new BadRequestException('sourceType must be songbook or youtube.');
}

export function parseSongbookId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 4294967295) throw new BadRequestException('songbookSongId is invalid.');
  return id;
}

export function parseYoutubeVideoId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(value.trim())) {
    throw new BadRequestException('youtubeVideoId is invalid.');
  }
  return value.trim();
}

export function parsePlaylistName(value: unknown): string {
  return parseText(value, 80, 'name').replace(/\s+/g, ' ');
}

function parseText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`${field} is required.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > maxLength) throw new BadRequestException(`${field} must be between 1 and ${maxLength} characters.`);
  return text;
}

function parseNullableText(value: unknown, maxLength: number, field: string): string | null {
  if (value === null || value === '') return null;
  return parseText(value, maxLength, field);
}

function parseUrl(value: unknown, maxLength: number, field: string): string {
  const url = parseText(value, maxLength, field);
  if (!/^https?:\/\//i.test(url)) throw new BadRequestException(`${field} must be an http(s) URL.`);
  return url;
}

function parsePositiveInteger(value: unknown, minimum: number, maximum: number, fallback: number, field: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new BadRequestException(`${field} is invalid.`);
  return parsed;
}
