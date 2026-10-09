import { ConfigService } from '@nestjs/config';

import { SongbookSearchRequest } from './songbook.dto';
import { SongbookSearchCacheService } from './songbook-search-cache.service';
import { SongbookSearchResponse } from './songbook.types';

describe('SongbookSearchCacheService', () => {
  const emptyResponse: SongbookSearchResponse = {
    data: [],
    pagination: {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };

  function createCache(config: Record<string, string> = {}) {
    const configService = {
      get: jest.fn((name: string) => config[name]),
    } as unknown as ConfigService;
    return new SongbookSearchCacheService(configService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function request(overrides: Partial<SongbookSearchRequest> = {}): SongbookSearchRequest {
    return {
      page: 1,
      limit: 20,
      browse: 'songs',
      ...overrides,
    };
  }

  it('caches a successful empty response and deduplicates in-flight requests', async () => {
    const cache = createCache();
    let resolveRequest: ((response: SongbookSearchResponse) => void) | undefined;
    const pendingResponse = new Promise<SongbookSearchResponse>((resolve) => {
      resolveRequest = resolve;
    });
    const factory = jest.fn(() => pendingResponse);

    const firstRequest = cache.getOrCreateSearch(request({ query: 'unknown' }), factory);
    const secondRequest = cache.getOrCreateSearch(request({ query: ' UNKNOWN ' }), factory);
    resolveRequest?.(emptyResponse);

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      emptyResponse,
      emptyResponse,
    ]);
    await cache.getOrCreateSearch(request({ query: 'unknown' }), factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('separates filters, browse modes, and pagination in cache keys', async () => {
    const cache = createCache();
    const factory = jest.fn().mockResolvedValue(emptyResponse);

    await cache.getOrCreateSearch(request({ query: 'love', category: 'OPM' }), factory);
    await cache.getOrCreateSearch(request({ query: 'love', category: 'International' }), factory);
    await cache.getOrCreateSearch(request({ query: 'love', category: 'OPM', page: 2 }), factory);
    await cache.getOrCreateSearch(request({ letter: 'A' }), factory);
    await cache.getOrCreateSearch(request({ letter: 'B' }), factory);
    await cache.getOrCreateSearch(request({ browse: 'artists', letter: 'A' }), factory);
    await cache.getOrCreateSearch(request({ browse: 'songs', artist: 'Ben&Ben' }), factory);

    expect(factory).toHaveBeenCalledTimes(7);
  });

  it('evicts the least recently used entry at the configured limit', async () => {
    const cache = createCache({ SONGBOOK_SEARCH_CACHE_MAX_ENTRIES: '2' });
    const factory = jest.fn().mockResolvedValue(emptyResponse);

    await cache.getOrCreateSearch(request({ query: 'first' }), factory);
    await cache.getOrCreateSearch(request({ query: 'second' }), factory);
    await cache.getOrCreateSearch(request({ query: 'first' }), factory);
    await cache.getOrCreateSearch(request({ query: 'third' }), factory);
    await cache.getOrCreateSearch(request({ query: 'second' }), factory);

    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('expires entries and does not cache rejected requests', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = createCache({ SONGBOOK_SEARCH_CACHE_TTL_MS: '1000' });
    const factory = jest.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(emptyResponse);

    await expect(cache.getOrCreateSearch(request({ query: 'failed' }), factory)).rejects.toThrow('database unavailable');
    await cache.getOrCreateSearch(request({ query: 'failed' }), factory);
    now = 2_000;
    await cache.getOrCreateSearch(request({ query: 'failed' }), factory);

    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('caches filters independently with the configured filters TTL', async () => {
    const cache = createCache();
    const factory = jest.fn().mockResolvedValue({ languages: ['English'], categories: ['OPM'] });

    await cache.getOrCreateFilters(factory);
    await cache.getOrCreateFilters(factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });
});
