import { KaraokeLibraryCacheService } from './karaoke-library-cache.service';

describe('KaraokeLibraryCacheService', () => {
  it('keeps cache entries user-scoped and invalidates writes', () => {
    const cache = new KaraokeLibraryCacheService();
    cache.set('favorites:user-a:page:1', { owner: 'a' });
    cache.set('favorites:user-b:page:1', { owner: 'b' });

    expect(cache.get<{ owner: string }>('favorites:user-a:page:1')?.owner).toBe('a');
    expect(cache.get<{ owner: string }>('favorites:user-b:page:1')?.owner).toBe('b');

    cache.invalidateUser('user-a');

    expect(cache.get('favorites:user-a:page:1')).toBeUndefined();
    expect(cache.get<{ owner: string }>('favorites:user-b:page:1')?.owner).toBe('b');
  });

  it('invalidates playlist lists and one playlist detail after a playlist write', () => {
    const cache = new KaraokeLibraryCacheService();
    cache.set('playlists:user-a:page:1:limit:50', []);
    cache.set('playlist:user-a:playlist-1', { id: 'playlist-1' });
    cache.set('playlist:user-a:playlist-2', { id: 'playlist-2' });

    cache.invalidatePlaylist('user-a', 'playlist-1');

    expect(cache.get('playlists:user-a:page:1:limit:50')).toBeUndefined();
    expect(cache.get('playlist:user-a:playlist-1')).toBeUndefined();
    expect(cache.get('playlist:user-a:playlist-2')).toEqual({ id: 'playlist-2' });
  });
});
