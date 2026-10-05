import { BadRequestException } from '@nestjs/common';
import {
  BUG_REPORT_MAX_FILE_SIZE_BYTES,
  createSafeBugReportFilename,
  detectBugReportImageFormat,
  validateBugReportUpload,
} from './bug-report.upload';

describe('bug report upload validation', () => {
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  it('accepts a valid PNG signature and generates a safe normalized filename', () => {
    const format = validateBugReportUpload({
      buffer: pngSignature,
      mimetype: 'image/png',
      size: pngSignature.length,
    });

    expect(format).toBe('png');
    expect(createSafeBugReportFilename(format)).toMatch(/^[a-f0-9]{32}\.png$/);
  });

  it('accepts JPEG and WebP signatures', () => {
    expect(detectBugReportImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(
      detectBugReportImageFormat(
        Buffer.from('RIFFxxxxWEBP', 'ascii'),
      ),
    ).toBe('webp');
  });

  it('rejects unsupported MIME types', () => {
    expect(() =>
      validateBugReportUpload({
        buffer: pngSignature,
        mimetype: 'application/javascript',
        size: pngSignature.length,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects spoofed image MIME types and oversized files', () => {
    expect(() =>
      validateBugReportUpload({
        buffer: Buffer.from('not an image'),
        mimetype: 'image/png',
        size: 12,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateBugReportUpload({
        buffer: pngSignature,
        mimetype: 'image/png',
        size: BUG_REPORT_MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toThrow(BadRequestException);
  });
});
