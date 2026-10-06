import { BadRequestException } from '@nestjs/common';

export class BugReportCreateDto {
  name!: string;
  email!: string;
  description!: string;
  steps?: string;
  browserDevice?: string;
}

export function parseBugReportCreateDto(value: unknown): BugReportCreateDto {
  const body = asRecord(value);
  const email = readString(body.email, 'email', 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('A valid email address is required.');
  }

  return {
    name: readString(body.name, 'name', 100),
    email,
    description: readString(body.description, 'description', 10_000),
    steps: readOptionalString(body.steps, 'steps', 10_000),
    browserDevice: readOptionalString(body.browserDevice, 'browserDevice', 255),
  };
}

function readString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new BadRequestException(`A valid ${field} is required.`);
  }
  return value.trim();
}

function readOptionalString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new BadRequestException(`The ${field} value is too long.`);
  }
  return value.trim() || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('A request body is required.');
  }
  return value as Record<string, unknown>;
}
