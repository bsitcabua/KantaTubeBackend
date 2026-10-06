import { ConfigService } from '@nestjs/config';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';

describe('YoutubePersonalKeyService', () => {
  const userA = '123e4567-e89b-42d3-a456-426614174000';
  const userB = '123e4567-e89b-42d3-a456-426614174001';
  const apiKey = `AIza${'a'.repeat(35)}`;

  function createService(
    values: Record<string, string> = {},
  ): YoutubePersonalKeyService {
    const configService = {
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    return new YoutubePersonalKeyService(configService);
  }

  it('stores a key by authenticated user ID without returning the key value', () => {
    const service = createService();

    const response = service.register(userA, apiKey);

    expect(response).toEqual({
      available: true,
      alias: YoutubePersonalKeyService.alias,
    });
    expect(JSON.stringify(response)).not.toContain(apiKey);
    expect(service.resolve(userA)).toBe(apiKey);
  });

  it('does not allow another authenticated user to resolve the key', () => {
    const service = createService();
    service.register(userA, apiKey);

    expect(service.getStatus(userB).available).toBe(false);
    expect(() => service.resolve(userB)).toThrow();
  });

  it('replaces and removes the key only under the matching authenticated user ID', () => {
    const service = createService();
    const replacementKey = `AIza${'b'.repeat(35)}`;
    service.register(userA, apiKey);
    service.register(userA, replacementKey);

    expect(service.resolve(userA)).toBe(replacementKey);
    expect(service.remove(userB)).toEqual({ removed: false });
    expect(service.remove(userA)).toEqual({ removed: true });
    expect(service.getStatus(userA).available).toBe(false);
  });

  it('rejects invalid user IDs and invalid API-key formats', () => {
    const service = createService();

    expect(() => service.register('legacy123', apiKey)).toThrow();
    expect(() => service.register(userA, 'not-a-key')).toThrow();
  });

  it('rejects new sessions at capacity without evicting existing keys', () => {
    const service = createService({ YOUTUBE_PERSONAL_KEY_MAX_SESSIONS: '1' });
    service.register(userA, apiKey);

    expect(() => service.register(userB, apiKey)).toThrow();
    expect(service.resolve(userA)).toBe(apiKey);
  });

  it('can be disabled with configuration', () => {
    const service = createService({ YOUTUBE_PERSONAL_KEYS_ENABLED: 'false' });

    expect(() => service.register(userA, apiKey)).toThrow();
    expect(service.has(userA)).toBe(false);
  });
});
