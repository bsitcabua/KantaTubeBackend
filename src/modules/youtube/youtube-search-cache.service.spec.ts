import { ConfigService } from '@nestjs/config';
import { YoutubeSearchResponse } from './youtube.types';
import { YoutubeSearchCacheService } from './youtube-search-cache.service';

describe('YoutubeSearchCacheService', () => {
  const emptyResponse: YoutubeSearchResponse = { items: [] };

  function createCache(config: Record<string, string> = {}) {
    const configService = {
      get: jest.fn((name: string) => config[name]),
    } as unknown as ConfigService;
    return new YoutubeSearchCacheService(configService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes keywords and caches successful responses', async () => {
    const cache = createCache();
    const factory = jest.fn().mockResolvedValue(emptyResponse);

    await cache.getOrCreate('  Disco   Karaoke  ', factory);
    await cache.getOrCreate('disco karaoke', factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('deduplicates simultaneous requests for the same keyword', async () => {
    const cache = createCache();
    let resolveRequest: ((response: YoutubeSearchResponse) => void) | undefined;
    const pendingResponse = new Promise<YoutubeSearchResponse>((resolve) => {
      resolveRequest = resolve;
    });
    const factory = jest.fn(() => pendingResponse);

    const firstRequest = cache.getOrCreate('OPM Karaoke', factory);
    const secondRequest = cache.getOrCreate(' opm  karaoke ', factory);
    resolveRequest?.(emptyResponse);

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      emptyResponse,
      emptyResponse,
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed requests', async () => {
    const cache = createCache();
    const factory = jest
      .fn<Promise<YoutubeSearchResponse>, []>()
      .mockRejectedValueOnce(new Error('YouTube unavailable'))
      .mockResolvedValueOnce(emptyResponse);

    await expect(cache.getOrCreate('failed search', factory)).rejects.toThrow(
      'YouTube unavailable',
    );
    await expect(cache.getOrCreate('failed search', factory)).resolves.toBe(
      emptyResponse,
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry at the configured limit', async () => {
    const cache = createCache({ YOUTUBE_SEARCH_CACHE_MAX_ENTRIES: '2' });
    const factory = jest.fn().mockResolvedValue(emptyResponse);

    await cache.getOrCreate('first', factory);
    await cache.getOrCreate('second', factory);
    await cache.getOrCreate('first', factory);
    await cache.getOrCreate('third', factory);
    await cache.getOrCreate('second', factory);

    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('expires entries after the configured TTL', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = createCache({ YOUTUBE_SEARCH_CACHE_TTL_MS: '1000' });
    const factory = jest.fn().mockResolvedValue(emptyResponse);

    await cache.getOrCreate('timed', factory);
    now = 1_999;
    await cache.getOrCreate('timed', factory);
    now = 2_000;
    await cache.getOrCreate('timed', factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
