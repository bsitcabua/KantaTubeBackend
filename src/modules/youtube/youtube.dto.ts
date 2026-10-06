import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class YoutubePersonalKeyRequestDto {
  apiKey!: string;
}

export interface YoutubeSearchRequestDto {
  query: string;
  keyAlias?: string;
  visitorId?: string;
}

export function parseYoutubePersonalKeyRequest(
  value: unknown,
): YoutubePersonalKeyRequestDto {
  const body = asRecord(value, 'A request body is required.');
  if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
    throw new BadRequestException({
      code: 'invalid_personal_key_request',
      message: 'A YouTube API key is required.',
    });
  }

  if (body.apiKey.length > 100) {
    throw new BadRequestException({
      code: 'invalid_personal_key_request',
      message: 'The YouTube API key is too long.',
    });
  }

  return { apiKey: body.apiKey.trim() };
}

export function parseYoutubeSearchRequest(
  query: unknown,
  keyAlias: unknown,
  visitorId: unknown,
): YoutubeSearchRequestDto {
  if (typeof query !== 'string' || !query.trim()) {
    throw new BadRequestException({
      code: 'invalid_search_query',
      message: 'Please enter a song or artist to search.',
    });
  }

  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  if (normalizedQuery.length > 100) {
    throw new BadRequestException({
      code: 'invalid_search_query',
      message: 'Search text must be 100 characters or fewer.',
    });
  }

  const normalizedAlias = parseOptionalAlias(keyAlias);
  return {
    query: normalizedQuery,
    keyAlias: normalizedAlias,
    visitorId: parseOptionalVisitorId(visitorId),
  };
}

export function parseOptionalVisitorId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new BadRequestException({
      code: 'invalid_visitor_id',
      message: 'A valid KantaTube visitor ID is required.',
    });
  }
  return value.trim();
}

function parseOptionalAlias(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length > 100) {
    throw new BadRequestException({
      code: 'invalid_api_key_alias',
      message: 'The selected YouTube API key is not available.',
    });
  }
  return value.trim();
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}
