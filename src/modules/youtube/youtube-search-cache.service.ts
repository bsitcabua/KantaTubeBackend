import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeSearchResponse } from './youtube.types';

interface YoutubeSearchCacheEntry {
  response: YoutubeSearchResponse;
  expiresAt: number;
}

@Injectable()
export class YoutubeSearchCacheService {
  private readonly logger = new Logger(YoutubeSearchCacheService.name);
  private readonly cache = new Map<string, YoutubeSearchCacheEntry>();
  private readonly inFlight = new Map<string, Promise<YoutubeSearchResponse>>();
  private readonly ttlMs: number;
  private readonly maximumEntries: number;

  constructor(private readonly configService: ConfigService) {
    this.ttlMs = this.getPositiveInteger(
      'YOUTUBE_SEARCH_CACHE_TTL_MS',
      6 * 60 * 60 * 1000,
    );
    this.maximumEntries = this.getPositiveInteger(
      'YOUTUBE_SEARCH_CACHE_MAX_ENTRIES',
      500,
    );
  }

  getOrCreate(
    keyword: string,
    factory: () => Promise<YoutubeSearchResponse>,
  ): Promise<YoutubeSearchResponse> {
    const cacheKey = this.normalizeKeyword(keyword);
    const cachedResponse = this.get(cacheKey);
    if (cachedResponse) {
      this.logger.debug(`YouTube search cache hit for "${cacheKey}".`);
      return Promise.resolve(cachedResponse);
    }

    const pendingRequest = this.inFlight.get(cacheKey);
    if (pendingRequest) {
      this.logger.debug(`Joined in-flight YouTube search for "${cacheKey}".`);
      return pendingRequest;
    }

    const request = factory()
      .then((response) => {
        this.set(cacheKey, response);
        return response;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, request);
    return request;
  }

  private get(cacheKey: string): YoutubeSearchResponse | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    return entry.response;
  }

  private set(cacheKey: string, response: YoutubeSearchResponse): void {
    this.removeExpiredEntries();
    this.cache.delete(cacheKey);

    while (this.cache.size >= this.maximumEntries) {
      const leastRecentlyUsedKey = this.cache.keys().next().value as
        | string
        | undefined;
      if (!leastRecentlyUsedKey) {
        break;
      }
      this.cache.delete(leastRecentlyUsedKey);
    }

    this.cache.set(cacheKey, {
      response,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  private removeExpiredEntries(): void {
    const now = Date.now();
    for (const [cacheKey, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(cacheKey);
      }
    }
  }

  private normalizeKeyword(keyword: string): string {
    return keyword.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private getPositiveInteger(name: string, fallback: number): number {
    const configuredValue = this.configService.get<string | number>(name);
    const parsedValue = Number(configuredValue);
    return Number.isInteger(parsedValue) && parsedValue > 0
      ? parsedValue
      : fallback;
  }
}
