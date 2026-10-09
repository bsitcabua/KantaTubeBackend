import { BadRequestException } from '@nestjs/common';

export const SONGBOOK_DEFAULT_PAGE = 1;
export const SONGBOOK_DEFAULT_LIMIT = 20;
export const SONGBOOK_MAX_LIMIT = 100;
export const SONGBOOK_MAX_PAGE = 100_000;
export const SONGBOOK_MAX_QUERY_LENGTH = 100;
export const SONGBOOK_MAX_FILTER_LENGTH = 60;
export const SONGBOOK_MAX_ARTIST_LENGTH = 255;

export type SongbookBrowseMode = 'songs' | 'artists';
export type SongbookBrowseLetter = string;

export interface SongbookSearchRequest {
  query?: string;
  language?: string;
  category?: string;
  browse?: SongbookBrowseMode;
  letter?: SongbookBrowseLetter;
  artist?: string;
  page: number;
  limit: number;
}

export function parseSongbookSearchRequest(
  query: unknown,
  language: unknown,
  category: unknown,
  page: unknown,
  limit: unknown,
  browse: unknown = undefined,
  letter: unknown = undefined,
  artist: unknown = undefined,
): SongbookSearchRequest {
  const browseMode = parseBrowseMode(browse);
  return {
    query: parseOptionalQuery(query),
    language: parseOptionalFilter(language, 'language'),
    category: parseOptionalFilter(category, 'category'),
    browse: browseMode,
    letter: parseBrowseLetter(letter),
    artist: parseOptionalArtist(artist),
    page: parsePositiveInteger(
      page,
      'page',
      SONGBOOK_DEFAULT_PAGE,
      SONGBOOK_MAX_PAGE,
    ),
    limit: parsePositiveInteger(
      limit,
      'limit',
      SONGBOOK_DEFAULT_LIMIT,
      SONGBOOK_MAX_LIMIT,
    ),
  };
}

export function parseSongbookId(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw new BadRequestException({
      code: 'invalid_song_id',
      message: 'Song ID must be a positive integer.',
    });
  }

  const id = Number(value.trim());
  if (!Number.isSafeInteger(id) || id <= 0 || id > 4_294_967_295) {
    throw new BadRequestException({
      code: 'invalid_song_id',
      message: 'Song ID must be a positive integer.',
    });
  }

  return id;
}

function parseOptionalQuery(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalidSearchQuery();
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  if (normalized.length > SONGBOOK_MAX_QUERY_LENGTH) {
    throw invalidSearchQuery();
  }

  return normalized;
}

function parseOptionalFilter(
  value: unknown,
  field: 'language' | 'category',
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalidFilter(field);
  }

  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > SONGBOOK_MAX_FILTER_LENGTH) {
    throw invalidFilter(field);
  }

  return normalized;
}

function parseBrowseMode(value: unknown): SongbookBrowseMode {
  if (value === undefined || value === null || value === '') return 'songs';
  if (value === 'songs' || value === 'artists') return value;
  throw new BadRequestException({
    code: 'invalid_songbook_browse_mode',
    message: 'browse must be either songs or artists.',
  });
}

function parseBrowseLetter(value: unknown): SongbookBrowseLetter | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw invalidBrowseLetter();

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]$/.test(normalized) && normalized !== '#') throw invalidBrowseLetter();
  return normalized;
}

function parseOptionalArtist(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw invalidArtist();

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > SONGBOOK_MAX_ARTIST_LENGTH) throw invalidArtist();
  return normalized;
}

function parsePositiveInteger(
  value: unknown,
  field: 'page' | 'limit',
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw invalidPagination(field, maximum);
  }

  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw invalidPagination(field, maximum);
  }

  return parsed;
}

function invalidSearchQuery(): BadRequestException {
  return new BadRequestException({
    code: 'invalid_songbook_query',
    message: `Search text must be ${SONGBOOK_MAX_QUERY_LENGTH} characters or fewer.`,
  });
}

function invalidFilter(field: 'language' | 'category'): BadRequestException {
  return new BadRequestException({
    code: 'invalid_songbook_filter',
    message: `${field} must be ${SONGBOOK_MAX_FILTER_LENGTH} characters or fewer.`,
  });
}

function invalidBrowseLetter(): BadRequestException {
  return new BadRequestException({
    code: 'invalid_songbook_browse_letter',
    message: 'letter must be A-Z or #.',
  });
}

function invalidArtist(): BadRequestException {
  return new BadRequestException({
    code: 'invalid_songbook_artist',
    message: `artist must be ${SONGBOOK_MAX_ARTIST_LENGTH} characters or fewer.`,
  });
}

function invalidPagination(
  field: 'page' | 'limit',
  maximum: number,
): BadRequestException {
  return new BadRequestException({
    code: 'invalid_songbook_pagination',
    message: `${field} must be a positive integer no greater than ${maximum}.`,
  });
}
