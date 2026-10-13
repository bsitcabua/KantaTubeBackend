import { Injectable } from '@nestjs/common';

export type KaraokeLibraryResource = 'favorites' | 'playlists';
export type KaraokeLibraryChangeType =
  | 'favorite-created'
  | 'favorite-removed'
  | 'favorite-visibility-changed'
  | 'playlist-created'
  | 'playlist-renamed'
  | 'playlist-deleted'
  | 'playlist-visibility-changed'
  | 'playlist-song-added'
  | 'playlist-song-removed'
  | 'playlist-reordered';

export interface KaraokeLibraryChange {
  userId: string;
  resource: KaraokeLibraryResource;
  type: KaraokeLibraryChangeType;
  resourceId?: string;
  version: string;
}

type Listener = (change: KaraokeLibraryChange) => void;

@Injectable()
export class KaraokeLibraryEventsService {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(change: Omit<KaraokeLibraryChange, 'version'> & { version?: string }): void {
    const event: KaraokeLibraryChange = {
      ...change,
      version: change.version ?? new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(event);
  }
}
