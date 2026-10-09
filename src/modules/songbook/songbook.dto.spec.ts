import { BadRequestException } from '@nestjs/common';
import {
  parseSongbookId,
  parseSongbookSearchRequest,
} from './songbook.dto';

describe('Songbook DTO parsing', () => {
  it('uses browsing defaults and accepts short legitimate queries', () => {
    expect(parseSongbookSearchRequest('G', ' English ', 'OPM', undefined, undefined)).toEqual({
      query: 'G',
      language: 'English',
      category: 'OPM',
      page: 1,
      limit: 20,
    });
    expect(parseSongbookSearchRequest('', undefined, undefined, undefined, undefined)).toEqual({
      query: undefined,
      language: undefined,
      category: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('rejects invalid pagination and oversized query values', () => {
    expect(() => parseSongbookSearchRequest('x', undefined, undefined, '0', undefined)).toThrow(BadRequestException);
    expect(() => parseSongbookSearchRequest('x', undefined, undefined, undefined, '101')).toThrow(BadRequestException);
    expect(() => parseSongbookSearchRequest('x'.repeat(101), undefined, undefined, undefined, undefined)).toThrow(BadRequestException);
  });

  it('validates unsigned song IDs', () => {
    expect(parseSongbookId('1002')).toBe(1002);
    expect(() => parseSongbookId('0')).toThrow(BadRequestException);
    expect(() => parseSongbookId('abc')).toThrow(BadRequestException);
  });
});
