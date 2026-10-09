import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SongbookSearchRequest } from './songbook.dto';
import {
  SongbookArtistBrowseResponse,
  SongbookFiltersResponse,
  SongbookSearchResponse,
} from './songbook.types';

type SongbookCachedResponse = SongbookSearchResponse | SongbookArtistBrowseResponse;

interface CacheEntry<T> {
  response: T;
  expiresAt: number;
}

@Injectable()
export class SongbookSearchCacheService {
  private readonly logger = new Logger(SongbookSearchCacheService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly searchTtlMs: number;
  private readonly filtersTtlMs: number;
  private readonly maximumEntries: number;

  constructor(private readonly configService: ConfigService) {
    this.searchTtlMs = this.getPositiveInteger(
      'SONGBOOK_SEARCH_CACHE_TTL_MS',
      15 * 60 * 1000,
    );
    this.filtersTtlMs = this.getPositiveInteger(
      'SONGBOOK_FILTERS_CACHE_TTL_MS',
      30 * 60 * 1000,
    );
    this.maximumEntries = this.getPositiveInteger(
      'SONGBOOK_SEARCH_CACHE_MAX_ENTRIES',
      250,
    );
  }

  getOrCreateSearch(
    request: SongbookSearchRequest,
    factory: () => Promise<SongbookCachedResponse>,
  ): Promise<SongbookCachedResponse> {
    return this.getOrCreate(this.getSearchCacheKey(request), this.searchTtlMs, factory);
  }

  getOrCreateFilters(
    factory: () => Promise<SongbookFiltersResponse>,
  ): Promise<SongbookFiltersResponse> {
    return this.getOrCreate('songbook:v1:filters', this.filtersTtlMs, factory);
  }

  private getOrCreate<T>(
    cacheKey: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cachedResponse = this.get<T>(cacheKey);
    if (cachedResponse !== undefined) {
      this.logger.debug('Songbook cache hit.');
      return Promise.resolve(cachedResponse);
    }

    const pendingRequest = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (pendingRequest) {
      this.logger.debug('Joined in-flight Songbook request.');
      return pendingRequest;
    }

    const request = Promise.resolve()
      .then(factory)
      .then((response) => {
        this.set(cacheKey, response, ttlMs);
        return response;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, request);
    return request;
  }

  private get<T>(cacheKey: string): T | undefined {
    const entry = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    return entry.response;
  }

  private set<T>(cacheKey: string, response: T, ttlMs: number): void {
    this.removeExpiredEntries();
    this.cache.delete(cacheKey);

    while (this.cache.size >= this.maximumEntries) {
      const leastRecentlyUsedKey = this.cache.keys().next().value as string | undefined;
      if (!leastRecentlyUsedKey) break;
      this.cache.delete(leastRecentlyUsedKey);
    }

    this.cache.set(cacheKey, {
      response,
      expiresAt: Date.now() + ttlMs,
    });
  }

  private removeExpiredEntries(): void {
    const now = Date.now();
    for (const [cacheKey, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) this.cache.delete(cacheKey);
    }
  }

  private getSearchCacheKey(request: SongbookSearchRequest): string {
    const params = [
      ['q', this.normalizeQuery(request.query)],
      ['language', this.normalizeFilter(request.language)],
      ['category', this.normalizeFilter(request.category)],
      ['browse', request.browse ?? 'songs'],
      ['letter', this.normalizeLetter(request.letter)],
      ['artist', this.normalizeArtist(request.artist)],
      ['page', String(request.page ?? 1)],
      ['limit', String(request.limit ?? 20)],
    ] as const;

    return `songbook:v1:${params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')}`;
  }

  private normalizeQuery(value?: string): string {
    return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
  }

  private normalizeFilter(value?: string): string {
    return value?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private normalizeLetter(value?: string): string {
    return value?.trim().toUpperCase() ?? '';
  }

  private normalizeArtist(value?: string): string {
    return value?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private getPositiveInteger(name: string, fallback: number): number {
    const configuredValue = this.configService.get<string | number>(name);
    const parsedValue = Number(configuredValue);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
  }
}
