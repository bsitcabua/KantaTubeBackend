import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

export const BUG_REPORT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const BUG_REPORT_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export type BugReportImageFormat = 'png' | 'jpeg' | 'webp';

export interface BugReportUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export function bugReportFileFilter(
  _request: { ip?: string },
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!BUG_REPORT_ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    callback(
      new BadRequestException({
        code: 'unsupported_bug_report_attachment',
        message: 'Only PNG, JPEG, and WebP screenshots are allowed.',
      }),
      false,
    );
    return;
  }
  callback(null, true);
}

export function detectBugReportImageFormat(
  buffer: Buffer,
): BugReportImageFormat | undefined {
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  if (isPng) return 'png';

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  return undefined;
}

export function validateBugReportUpload(file: BugReportUpload): BugReportImageFormat {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.size > BUG_REPORT_MAX_FILE_SIZE_BYTES ||
    file.buffer.length > BUG_REPORT_MAX_FILE_SIZE_BYTES
  ) {
    throw new BadRequestException({
      code: 'bug_report_attachment_too_large',
      message: 'Screenshot attachments must be 5 MB or smaller.',
    });
  }

  const mimeType = file.mimetype.toLowerCase();
  if (!BUG_REPORT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException({
      code: 'unsupported_bug_report_attachment',
      message: 'Only PNG, JPEG, and WebP screenshots are allowed.',
    });
  }

  const format = detectBugReportImageFormat(file.buffer);
  const expectedMimeType = format === 'jpeg' ? 'image/jpeg' : format ? `image/${format}` : '';
  if (!format || expectedMimeType !== mimeType) {
    throw new BadRequestException({
      code: 'invalid_bug_report_attachment',
      message: 'The screenshot content does not match its declared image type.',
    });
  }

  return format;
}

export function createSafeBugReportFilename(format: BugReportImageFormat): string {
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${randomBytes(16).toString('hex')}.${extension}`;
}
