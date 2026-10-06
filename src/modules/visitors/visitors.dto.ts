import { BadRequestException } from '@nestjs/common';

export class VisitorCreateDto {
  ip!: string;
  device!: string;
  browser!: string;
  latitude!: string;
  longitude!: string;
  source!: string;
}

export function parseVisitorCreateDto(value: unknown): VisitorCreateDto {
  const body = asRecord(value);
  return {
    ip: readString(body.ip, 'ip', 45),
    device: readString(body.device, 'device', 100),
    browser: readString(body.browser, 'browser', 100),
    latitude: readStringOrNumber(body.latitude, 'latitude', 50),
    longitude: readStringOrNumber(body.longitude, 'longitude', 50),
    source: readString(body.source, 'source', 50),
  };
}

function readString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new BadRequestException(`A valid ${field} is required.`);
  }
  return value.trim();
}

function readStringOrNumber(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new BadRequestException(`A valid ${field} is required.`);
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new BadRequestException(`A valid ${field} is required.`);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('A request body is required.');
  }
  return value as Record<string, unknown>;
}
