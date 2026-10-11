import { Injectable } from '@nestjs/common';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  lastAccessedAt: number;
}

@Injectable()
export class KaraokeLibraryCacheService {
  static readonly ttlMs = 3 * 60 * 1000;
  static readonly maxEntries = 1000;

  private readonly entries = new Map<string, CacheEntry>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = KaraokeLibraryCacheService.ttlMs): void {
    this.removeExpired();
    if (!this.entries.has(key) && this.entries.size >= KaraokeLibraryCacheService.maxEntries) {
      const leastRecentlyUsedKey = [...this.entries.entries()]
        .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0]?.[0];
      if (leastRecentlyUsedKey) this.entries.delete(leastRecentlyUsedKey);
    }
    const now = Date.now();
    this.entries.set(key, { value, expiresAt: now + ttlMs, lastAccessedAt: now });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  invalidateUser(userId: string): void {
    this.deleteByPrefix(`favorites:${userId}:`);
    this.deleteByPrefix(`playlists:${userId}:`);
    this.deleteByPrefix(`playlist:${userId}:`);
  }

  invalidatePlaylist(userId: string, playlistId: string): void {
    this.deleteByPrefix(`playlists:${userId}:`);
    this.delete(`playlist:${userId}:${playlistId}`);
  }

  size(): number {
    this.removeExpired();
    return this.entries.size;
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
