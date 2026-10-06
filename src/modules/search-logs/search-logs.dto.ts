import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SearchLogCreateDto {
  visitor_id!: string;
  search!: string;
  result!: string;
}

export function parseSearchLogCreateDto(value: unknown): SearchLogCreateDto {
  const body = asRecord(value);
  const visitorId = readString(body.visitor_id, 'visitor_id', 36);
  if (!UUID_PATTERN.test(visitorId)) {
    throw new BadRequestException({
      code: 'invalid_visitor_id',
      message: 'A valid KantaTube visitor ID is required.',
    });
  }

  return {
    visitor_id: visitorId,
    search: readString(body.search, 'search', 100),
    result: readString(body.result, 'result', 100_000),
  };
}

function readString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new BadRequestException(`A valid ${field} is required.`);
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('A request body is required.');
  }
  return value as Record<string, unknown>;
}
