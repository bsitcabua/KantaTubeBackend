import { ConfigService } from '@nestjs/config';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';

describe('YoutubePersonalKeyService', () => {
  const visitorId = '123e4567-e89b-42d3-a456-426614174000';
  const otherVisitorId = '123e4567-e89b-42d3-a456-426614174001';
  const apiKey = `AIza${'a'.repeat(35)}`;

  function createService(
    values: Record<string, string> = {},
  ): YoutubePersonalKeyService {
    const configService = {
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    return new YoutubePersonalKeyService(configService);
  }

  it('stores a key by visitor ID without returning the key value', () => {
    const service = createService();

    const response = service.register(visitorId, apiKey);

    expect(response).toEqual({
      available: true,
      alias: YoutubePersonalKeyService.alias,
    });
    expect(JSON.stringify(response)).not.toContain(apiKey);
    expect(service.resolve(visitorId)).toBe(apiKey);
  });

  it('does not allow another visitor ID to resolve the key', () => {
    const service = createService();
    service.register(visitorId, apiKey);

    expect(service.getStatus(otherVisitorId).available).toBe(false);
    expect(() => service.resolve(otherVisitorId)).toThrow();
  });

  it('replaces and removes the key only under the matching visitor ID', () => {
    const service = createService();
    const replacementKey = `AIza${'b'.repeat(35)}`;
    service.register(visitorId, apiKey);
    service.register(visitorId, replacementKey);

    expect(service.resolve(visitorId)).toBe(replacementKey);
    expect(service.remove(otherVisitorId)).toEqual({ removed: false });
    expect(service.remove(visitorId)).toEqual({ removed: true });
    expect(service.getStatus(visitorId).available).toBe(false);
  });

  it('rejects invalid visitor IDs and invalid API-key formats', () => {
    const service = createService();

    expect(() => service.register('legacy123', apiKey)).toThrow();
    expect(() => service.register(visitorId, 'not-a-key')).toThrow();
  });

  it('rejects new sessions at capacity without evicting existing keys', () => {
    const service = createService({ YOUTUBE_PERSONAL_KEY_MAX_SESSIONS: '1' });
    service.register(visitorId, apiKey);

    expect(() => service.register(otherVisitorId, apiKey)).toThrow();
    expect(service.resolve(visitorId)).toBe(apiKey);
  });

  it('can be disabled with configuration', () => {
    const service = createService({ YOUTUBE_PERSONAL_KEYS_ENABLED: 'false' });

    expect(() => service.register(visitorId, apiKey)).toThrow();
    expect(service.has(visitorId)).toBe(false);
  });
});
