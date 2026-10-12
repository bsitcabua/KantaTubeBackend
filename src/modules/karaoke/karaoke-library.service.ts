import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  Like,
  Repository,
} from 'typeorm';
import { KaraokeSong } from './entities/karaoke-song.entity';
import { KaraokeFavorite, KaraokeFavoriteSourceType } from './entities/karaoke-favorite.entity';
import { KaraokePlaylist } from './entities/karaoke-playlist.entity';
import { KaraokePlaylistItem } from './entities/karaoke-playlist-item.entity';
import { KaraokeLibraryCacheService } from './karaoke-library-cache.service';
import { KaraokeLibraryEventsService } from './karaoke-library-events.service';
import {
  FavoriteInput,
  PlaylistInput,
  PlaylistItemInput,
} from './karaoke-library.dto';
import {
  FavoriteResponse,
  FavoritesListResponse,
  PaginationResponse,
  PlaylistItemResponse,
  PlaylistListResponse,
  PlaylistResponse,
  PlaylistSummaryResponse,
} from './karaoke-library.types';
import {
  KaraokeLibraryVisibility,
  normalizeKaraokeLibraryVisibility,
} from './karaoke-library-visibility';

@Injectable()
export class KaraokeLibraryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(KaraokeFavorite)
    private readonly favorites: Repository<KaraokeFavorite>,
    @InjectRepository(KaraokePlaylist)
    private readonly playlists: Repository<KaraokePlaylist>,
    @InjectRepository(KaraokePlaylistItem)
    private readonly playlistItems: Repository<KaraokePlaylistItem>,
    @InjectRepository(KaraokeSong)
    private readonly songs: Repository<KaraokeSong>,
    private readonly cache: KaraokeLibraryCacheService,
    private readonly events: KaraokeLibraryEventsService,
  ) {}

  async listFavorites(userId: string, page: number, limit: number, search?: string, publicOnly = false): Promise<FavoritesListResponse> {
    const cacheKey = `favorites:${userId}:scope:${publicOnly ? 'public' : 'owner'}:page:${page}:limit:${limit}:search:${(search ?? '').toLowerCase()}`;
    const cached = this.cache.get<FavoritesListResponse>(cacheKey);
    if (cached) return cached;

    const query = this.favorites
      .createQueryBuilder('favorite')
      .leftJoinAndSelect('favorite.songbookSong', 'songbookSong')
      .where('favorite.userId = :userId', { userId });
    if (publicOnly) {
      query.andWhere('favorite.visibility = :visibility', {
        visibility: KaraokeLibraryVisibility.PUBLIC,
      });
    }
    if (search) {
      query.andWhere('(LOWER(favorite.title) LIKE LOWER(:search) OR LOWER(favorite.artist) LIKE LOWER(:search))', { search: `%${this.escapeLike(search)}%` });
    }
    query.orderBy('favorite.createdAt', 'DESC').skip((page - 1) * limit).take(limit);
    const [rows, total] = await query.getManyAndCount();
    const response = { data: rows.map((favorite) => this.toFavoriteResponse(favorite)), pagination: this.toPagination(page, limit, total) };
    this.cache.set(cacheKey, response);
    return response;
  }

  async createFavorite(userId: string, input: FavoriteInput): Promise<FavoriteResponse> {
    const materialized = await this.materializeSource(input, 'favorite');
    const existing = await this.favorites.findOne({ where: { userId, dedupeKey: materialized.dedupeKey } });
    if (existing) throw new ConflictException({ code: 'favorite_already_exists', message: 'This song is already in Favorites.' });

    try {
      const favorite = this.favorites.create({ userId, ...materialized });
      const saved = await this.favorites.save(favorite);
      this.cache.deleteByPrefix(`favorites:${userId}:`);
      this.events.publish({ userId, resource: 'favorites', type: 'favorite-created', resourceId: saved.id });
      return this.toFavoriteResponse(saved);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) throw new ConflictException({ code: 'favorite_already_exists', message: 'This song is already in Favorites.' });
      throw error;
    }
  }

  async removeFavorite(userId: string, favoriteId: string): Promise<{ removed: boolean }> {
    const result = await this.favorites.delete({ id: favoriteId, userId });
    if (!result.affected) throw new NotFoundException('Favorite not found.');
    this.cache.deleteByPrefix(`favorites:${userId}:`);
    this.events.publish({ userId, resource: 'favorites', type: 'favorite-removed', resourceId: favoriteId });
    return { removed: true };
  }

  async setFavoriteVisibility(
    userId: string,
    favoriteId: string,
    visibility: KaraokeLibraryVisibility,
  ): Promise<FavoriteResponse> {
    const favorite = await this.favorites.findOne({
      where: { id: favoriteId, userId },
      relations: { songbookSong: true },
    });
    if (!favorite) throw new NotFoundException('Favorite not found.');
    favorite.visibility = normalizeKaraokeLibraryVisibility(visibility);
    const saved = await this.favorites.save(favorite);
    this.cache.deleteByPrefix(`favorites:${userId}:`);
    this.events.publish({ userId, resource: 'favorites', type: 'favorite-visibility-changed', resourceId: saved.id });
    return this.toFavoriteResponse(saved);
  }

  async setAllFavoriteVisibility(
    userId: string,
    visibility: KaraokeLibraryVisibility,
  ): Promise<{ updated: number; visibility: KaraokeLibraryVisibility }> {
    const normalizedVisibility = normalizeKaraokeLibraryVisibility(visibility);
    const result = await this.favorites
      .createQueryBuilder()
      .update(KaraokeFavorite)
      .set({ visibility: normalizedVisibility })
      .where('user_id = :userId', { userId })
      .execute();
    this.cache.deleteByPrefix(`favorites:${userId}:`);
    this.events.publish({ userId, resource: 'favorites', type: 'favorite-visibility-changed' });
    return { updated: result.affected ?? 0, visibility: normalizedVisibility };
  }

  async listPlaylists(userId: string, page: number, limit: number, publicOnly = false): Promise<PlaylistListResponse> {
    const cacheKey = `playlists:${userId}:scope:${publicOnly ? 'public' : 'owner'}:page:${page}:limit:${limit}`;
    const cached = this.cache.get<PlaylistListResponse>(cacheKey);
    if (cached) return cached;

    const query = this.playlists
      .createQueryBuilder('playlist')
      .leftJoin(KaraokePlaylistItem, 'item', 'item.playlist_id = playlist.id')
      .where('playlist.user_id = :userId', { userId })
      .select([
        'playlist.id AS id',
        'playlist.name AS name',
        'playlist.visibility AS visibility',
        'playlist.created_at AS createdAt',
        'playlist.updated_at AS updatedAt',
        'COUNT(item.id) AS itemCount',
      ])
      .groupBy('playlist.id')
      .addGroupBy('playlist.name')
      .addGroupBy('playlist.visibility')
      .addGroupBy('playlist.created_at')
      .addGroupBy('playlist.updated_at')
      .orderBy('playlist.updated_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (publicOnly) {
      query.andWhere('playlist.visibility = :visibility', {
        visibility: KaraokeLibraryVisibility.PUBLIC,
      });
    }
    const [rows, total] = await Promise.all([
      query.getRawMany<Record<string, unknown>>(),
      this.playlists.count(publicOnly
        ? { where: { userId, visibility: KaraokeLibraryVisibility.PUBLIC } }
        : { where: { userId } }),
    ]);
    const ids = rows.map((row) => String(row.id));
    const thumbnails = ids.length
      ? await this.playlistItems.find({ where: { playlistId: In(ids) }, order: { position: 'ASC', createdAt: 'ASC' } })
      : [];
    const firstThumbnail = new Map<string, string | null>();
    for (const item of thumbnails) {
      if (!firstThumbnail.has(item.playlistId)) firstThumbnail.set(item.playlistId, item.thumbnailUrl);
    }
    const response: PlaylistListResponse = {
      data: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        itemCount: Number(row.itemCount),
        visibility: normalizeKaraokeLibraryVisibility(row.visibility),
        thumbnailUrl: firstThumbnail.get(String(row.id)) ?? null,
        createdAt: new Date(row.createdAt as string | Date).toISOString(),
        updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
      })),
      pagination: this.toPagination(page, limit, total),
    };
    this.cache.set(cacheKey, response);
    return response;
  }

  async createPlaylist(userId: string, input: PlaylistInput): Promise<PlaylistResponse> {
    const playlist = this.playlists.create({
      userId,
      name: input.name,
      normalizedName: this.normalizeName(input.name),
      description: input.description ?? null,
      visibility: normalizeKaraokeLibraryVisibility(input.visibility),
    });
    try {
      const saved = await this.playlists.save(playlist);
      this.cache.deleteByPrefix(`playlists:${userId}:`);
      this.events.publish({ userId, resource: 'playlists', type: 'playlist-created', resourceId: saved.id });
      return this.toPlaylistResponse(saved, []);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) throw new ConflictException({ code: 'playlist_name_already_exists', message: 'A playlist with that name already exists.' });
      throw error;
    }
  }

  async getPlaylist(userId: string, playlistId: string, publicOnly = false): Promise<PlaylistResponse> {
    const cacheKey = `playlist:${userId}:${publicOnly ? 'public' : 'owner'}:${playlistId}`;
    const cached = this.cache.get<PlaylistResponse>(cacheKey);
    if (cached) return cached;
    const playlist = await this.findOwnedPlaylist(userId, playlistId, publicOnly);
    const items = await this.playlistItems.find({
      where: { playlistId: playlist.id },
      relations: { songbookSong: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const response = this.toPlaylistResponse(playlist, items);
    this.cache.set(cacheKey, response);
    return response;
  }

  async renamePlaylist(userId: string, playlistId: string, input: PlaylistInput): Promise<PlaylistResponse> {
    const playlist = await this.findOwnedPlaylist(userId, playlistId);
    playlist.name = input.name;
    playlist.normalizedName = this.normalizeName(input.name);
    if (input.description !== undefined) playlist.description = input.description ?? null;
    try {
      const saved = await this.playlists.save(playlist);
      this.cache.invalidatePlaylist(userId, playlistId);
      this.events.publish({ userId, resource: 'playlists', type: 'playlist-renamed', resourceId: saved.id });
      return this.getPlaylist(userId, saved.id);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) throw new ConflictException({ code: 'playlist_name_already_exists', message: 'A playlist with that name already exists.' });
      throw error;
    }
  }

  async setPlaylistVisibility(
    userId: string,
    playlistId: string,
    visibility: KaraokeLibraryVisibility,
  ): Promise<PlaylistResponse> {
    const playlist = await this.findOwnedPlaylist(userId, playlistId);
    playlist.visibility = normalizeKaraokeLibraryVisibility(visibility);
    const saved = await this.playlists.save(playlist);
    this.cache.invalidatePlaylist(userId, playlistId);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-visibility-changed', resourceId: saved.id });
    return this.getPlaylist(userId, saved.id);
  }

  async setAllPlaylistVisibility(
    userId: string,
    visibility: KaraokeLibraryVisibility,
  ): Promise<{ updated: number; visibility: KaraokeLibraryVisibility }> {
    const normalizedVisibility = normalizeKaraokeLibraryVisibility(visibility);
    const result = await this.playlists
      .createQueryBuilder()
      .update(KaraokePlaylist)
      .set({ visibility: normalizedVisibility })
      .where('user_id = :userId', { userId })
      .execute();
    this.cache.deleteByPrefix(`playlists:${userId}:`);
    this.cache.deleteByPrefix(`playlist:${userId}:`);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-visibility-changed' });
    return { updated: result.affected ?? 0, visibility: normalizedVisibility };
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<{ deleted: boolean }> {
    const result = await this.playlists.delete({ id: playlistId, userId });
    if (!result.affected) throw new NotFoundException('Playlist not found.');
    this.cache.invalidatePlaylist(userId, playlistId);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-deleted', resourceId: playlistId });
    return { deleted: true };
  }

  async addPlaylistItem(userId: string, playlistId: string, input: PlaylistItemInput): Promise<PlaylistResponse> {
    const materialized = await this.materializeSource(input, 'playlist item');
    try {
      await this.dataSource.transaction(async (manager) => {
        const playlists = manager.getRepository(KaraokePlaylist);
        const items = manager.getRepository(KaraokePlaylistItem);
        const playlist = await playlists.findOne({ where: { id: playlistId, userId }, lock: { mode: 'pessimistic_write' } });
        if (!playlist) throw new NotFoundException('Playlist not found.');
        const duplicate = await items.findOne({ where: { playlistId, dedupeKey: materialized.dedupeKey } });
        if (duplicate) throw new ConflictException({ code: 'playlist_item_already_exists', message: `This song is already in ${playlist.name}.` });
        const raw = await items.createQueryBuilder('item').select('MAX(item.position)', 'maxPosition').where('item.playlist_id = :playlistId', { playlistId }).getRawOne<{ maxPosition: string | null }>();
        const item = items.create({ playlistId, position: Number(raw?.maxPosition ?? -1) + 1, ...materialized });
        await items.save(item);
        playlist.updatedAt = new Date();
        await playlists.save(playlist);
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) throw new ConflictException({ code: 'playlist_item_already_exists', message: 'This song is already in the playlist.' });
      throw error;
    }
    this.cache.invalidatePlaylist(userId, playlistId);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-song-added', resourceId: playlistId });
    return this.getPlaylist(userId, playlistId);
  }

  async removePlaylistItem(userId: string, playlistId: string, itemId: string): Promise<PlaylistResponse> {
    await this.dataSource.transaction(async (manager) => {
      const playlists = manager.getRepository(KaraokePlaylist);
      const items = manager.getRepository(KaraokePlaylistItem);
      const playlist = await playlists.findOne({ where: { id: playlistId, userId }, lock: { mode: 'pessimistic_write' } });
      if (!playlist) throw new NotFoundException('Playlist not found.');
      const item = await items.findOne({ where: { id: itemId, playlistId } });
      if (!item) throw new NotFoundException('Playlist item not found.');
      await items.remove(item);
      await this.compactPositions(manager, playlistId);
      playlist.updatedAt = new Date();
      await playlists.save(playlist);
    });
    this.cache.invalidatePlaylist(userId, playlistId);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-song-removed', resourceId: playlistId });
    return this.getPlaylist(userId, playlistId);
  }

  async reorderPlaylistItems(userId: string, playlistId: string, itemIds: string[]): Promise<PlaylistResponse> {
    await this.dataSource.transaction(async (manager) => {
      const playlists = manager.getRepository(KaraokePlaylist);
      const items = manager.getRepository(KaraokePlaylistItem);
      const playlist = await playlists.findOne({ where: { id: playlistId, userId }, lock: { mode: 'pessimistic_write' } });
      if (!playlist) throw new NotFoundException('Playlist not found.');
      const existing = await items.find({ where: { playlistId }, select: { id: true } });
      if (existing.length !== itemIds.length || existing.some((item) => !itemIds.includes(item.id))) {
        throw new BadRequestException('itemIds must contain every item in the playlist exactly once.');
      }
      await items.update({ playlistId }, { position: 1000000 });
      await Promise.all(itemIds.map((id, position) => items.update({ id, playlistId }, { position })));
      playlist.updatedAt = new Date();
      await playlists.save(playlist);
    });
    this.cache.invalidatePlaylist(userId, playlistId);
    this.events.publish({ userId, resource: 'playlists', type: 'playlist-reordered', resourceId: playlistId });
    return this.getPlaylist(userId, playlistId);
  }

  private async materializeSource(input: FavoriteInput | PlaylistItemInput, context: string): Promise<Partial<KaraokeFavorite & KaraokePlaylistItem>> {
    if (input.sourceType === KaraokeFavoriteSourceType.SONGBOOK) {
      if (!input.songbookSongId) throw new BadRequestException(`${context} requires songbookSongId.`);
      const song = await this.songs.findOne({ where: { id: input.songbookSongId } });
      if (!song) throw new NotFoundException('Songbook song not found.');
      const youtubeVideoId = song.youtubeVideoId ?? input.youtubeVideoId ?? null;
      return {
        sourceType: KaraokeFavoriteSourceType.SONGBOOK,
        songbookSongId: song.id,
        youtubeVideoId,
        songbookSong: song,
        title: song.title,
        artist: song.artist || null,
        description: 'description' in input ? input.description ?? null : null,
        thumbnailUrl: input.thumbnailUrl ?? (youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg` : null),
        dedupeKey: `songbook:${song.id}`,
      };
    }

    if (!input.youtubeVideoId) throw new BadRequestException(`${context} requires youtubeVideoId.`);
    if (!input.title) throw new BadRequestException(`${context} requires title.`);
    return {
      sourceType: KaraokeFavoriteSourceType.YOUTUBE,
      songbookSongId: null,
      youtubeVideoId: input.youtubeVideoId,
      title: input.title,
      artist: input.artist ?? null,
      description: 'description' in input ? input.description ?? null : null,
      thumbnailUrl: input.thumbnailUrl ?? `https://i.ytimg.com/vi/${input.youtubeVideoId}/mqdefault.jpg`,
      dedupeKey: `youtube:${input.youtubeVideoId}`,
    };
  }

  private async findOwnedPlaylist(userId: string, playlistId: string, publicOnly = false): Promise<KaraokePlaylist> {
    const playlist = await this.playlists.findOne({
      where: {
        id: playlistId,
        userId,
        ...(publicOnly ? { visibility: KaraokeLibraryVisibility.PUBLIC } : {}),
      },
    });
    if (!playlist) throw new NotFoundException('Playlist not found.');
    return playlist;
  }

  private async compactPositions(manager: import('typeorm').EntityManager, playlistId: string): Promise<void> {
    const items = manager.getRepository(KaraokePlaylistItem);
    const rows = await items.find({ where: { playlistId }, order: { position: 'ASC', createdAt: 'ASC' } });
    await items.update({ playlistId }, { position: 1000000 });
    await Promise.all(rows.map((item, position) => items.update({ id: item.id, playlistId }, { position })));
  }

  private toFavoriteResponse(favorite: KaraokeFavorite): FavoriteResponse {
    return {
      id: favorite.id,
      sourceType: favorite.sourceType,
      visibility: normalizeKaraokeLibraryVisibility(favorite.visibility),
      songbookSongId: favorite.songbookSongId,
      youtubeVideoId: favorite.youtubeVideoId,
      title: favorite.title,
      artist: favorite.artist,
      language: favorite.songbookSong?.language ?? null,
      category: favorite.songbookSong?.category ?? null,
      thumbnailUrl: favorite.thumbnailUrl,
      createdAt: favorite.createdAt.toISOString(),
      updatedAt: favorite.updatedAt.toISOString(),
    };
  }

  private toPlaylistResponse(playlist: KaraokePlaylist, items: KaraokePlaylistItem[]): PlaylistResponse {
    const mappedItems = items.map((item) => this.toPlaylistItemResponse(item));
    return {
      id: playlist.id,
      name: playlist.name,
      visibility: normalizeKaraokeLibraryVisibility(playlist.visibility),
      description: playlist.description,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      items: mappedItems,
      itemCount: mappedItems.length,
      thumbnailUrl: mappedItems.find((item) => item.thumbnailUrl)?.thumbnailUrl ?? null,
    };
  }

  private toPlaylistItemResponse(item: KaraokePlaylistItem): PlaylistItemResponse {
    const song = item.songbookSong;
    const youtubeVideoId = item.sourceType === KaraokeFavoriteSourceType.SONGBOOK ? song?.youtubeVideoId ?? item.youtubeVideoId : item.youtubeVideoId;
    return {
      id: item.id,
      sourceType: item.sourceType,
      songbookSongId: item.songbookSongId,
      youtubeVideoId,
      title: item.sourceType === KaraokeFavoriteSourceType.SONGBOOK && song ? song.title : item.title,
      artist: item.sourceType === KaraokeFavoriteSourceType.SONGBOOK && song ? song.artist : item.artist,
      language: item.sourceType === KaraokeFavoriteSourceType.SONGBOOK && song ? song.language : null,
      category: item.sourceType === KaraokeFavoriteSourceType.SONGBOOK && song ? song.category : null,
      description: item.description,
      thumbnailUrl: item.thumbnailUrl ?? (youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg` : null),
      position: item.position,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toPagination(page: number, limit: number, total: number): PaginationResponse {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
  }
}
