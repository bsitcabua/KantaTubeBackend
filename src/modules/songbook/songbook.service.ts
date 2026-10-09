import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { KaraokeSong } from '../karaoke/entities/karaoke-song.entity';
import { SongbookSearchRequest } from './songbook.dto';
import { SongbookSearchCacheService } from './songbook-search-cache.service';
import {
  SongbookFiltersResponse,
  SongbookArtistBrowseResponse,
  SongbookPaginationResponse,
  SongbookSearchResponse,
  SongbookSongResponse,
} from './songbook.types';

@Injectable()
export class SongbookService {
  constructor(
    @InjectRepository(KaraokeSong)
    private readonly songs: Repository<KaraokeSong>,
    private readonly searchCache: SongbookSearchCacheService,
  ) {}

  async search(request: SongbookSearchRequest): Promise<SongbookSearchResponse> {
    return this.searchCache.getOrCreateSearch(request, () => this.searchUncached(request)) as Promise<SongbookSearchResponse>;
  }

  private async searchUncached(request: SongbookSearchRequest): Promise<SongbookSearchResponse> {
    const queryBuilder = this.createSongQuery();
    this.applyFilters(queryBuilder, request);

    if (request.query) {
      const escapedQuery = this.escapeLikePattern(request.query);
      queryBuilder
        .andWhere(
          `(LOWER(song.title) LIKE LOWER(:contains) OR LOWER(song.artist) LIKE LOWER(:contains))`,
          { contains: `%${escapedQuery}%` },
        )
        .orderBy(
          `CASE
            WHEN LOWER(song.title) = LOWER(:exact) THEN 1
            WHEN LOWER(song.title) LIKE LOWER(:prefix) THEN 2
            WHEN LOWER(song.artist) = LOWER(:exact) THEN 3
            WHEN LOWER(song.artist) LIKE LOWER(:prefix) THEN 4
            WHEN LOWER(song.title) LIKE LOWER(:contains) THEN 5
            WHEN LOWER(song.artist) LIKE LOWER(:contains) THEN 6
            ELSE 7
          END`,
          'ASC',
        )
        .setParameters({
          exact: request.query,
          prefix: `${escapedQuery}%`,
          contains: `%${escapedQuery}%`,
        });
    } else {
      this.applyBrowseLetter(queryBuilder, 'song.title', request.letter);
      queryBuilder.orderBy('song.title', 'ASC');
    }

    queryBuilder
      .addOrderBy('song.artist', 'ASC')
      .addOrderBy('song.id', 'ASC')
      .skip((request.page - 1) * request.limit)
      .take(request.limit);

    const [songs, total] = await queryBuilder.getManyAndCount();
    const pagination: SongbookPaginationResponse = this.toPagination(
      request.page,
      request.limit,
      total,
    );
    if (!request.query && !request.artist) {
      const catalogQuery = this.songs.createQueryBuilder('song');
      this.applyFilters(catalogQuery, { ...request, letter: undefined });
      pagination.catalogTotal = await catalogQuery.getCount();
    }

    return {
      data: songs.map((song) => this.toPublicSong(song)),
      pagination,
    };
  }

  async browseArtists(request: SongbookSearchRequest): Promise<SongbookArtistBrowseResponse> {
    return this.searchCache.getOrCreateSearch(request, () => this.browseArtistsUncached(request)) as Promise<SongbookArtistBrowseResponse>;
  }

  private async browseArtistsUncached(request: SongbookSearchRequest): Promise<SongbookArtistBrowseResponse> {
    const queryBuilder = this.songs
      .createQueryBuilder('song')
      .select('song.artist', 'artist')
      .addSelect('COUNT(song.id)', 'songCount')
      .where("song.artist IS NOT NULL AND song.artist <> ''");
    this.applyFilters(queryBuilder, request);
    this.applyBrowseLetter(queryBuilder, 'song.artist', request.letter);
    queryBuilder
      .groupBy('song.artist')
      .orderBy('song.artist', 'ASC')
      .skip((request.page - 1) * request.limit)
      .take(request.limit);

    const [artists, total, catalogTotal] = await Promise.all([
      queryBuilder.getRawMany<{ artist: string; songCount: string }>(),
      this.countArtists(request, true),
      this.countArtists(request, false),
    ]);

    return {
      data: artists.map((artist) => ({
        artist: artist.artist,
        songCount: Number(artist.songCount),
      })),
      pagination: {
        ...this.toPagination(request.page, request.limit, total),
        catalogTotal,
      },
    };
  }

  async findById(id: number): Promise<SongbookSongResponse> {
    const song = await this.songs
      .createQueryBuilder('song')
      .select([
        'song.id',
        'song.title',
        'song.artist',
        'song.language',
        'song.category',
        'song.youtubeVideoId',
        'song.source',
        'song.isVerifiedKaraoke',
      ])
      .where('song.id = :id', { id })
      .getOne();

    if (!song) {
      throw new NotFoundException({
        code: 'songbook_song_not_found',
        message: 'Song not found.',
      });
    }

    return this.toPublicSong(song);
  }

  async filters(): Promise<SongbookFiltersResponse> {
    return this.searchCache.getOrCreateFilters(async () => {
      const [languages, categories] = await Promise.all([
        this.getDistinctValues('language'),
        this.getDistinctValues('category'),
      ]);

      return { languages, categories };
    });
  }

  private async getDistinctValues(
    column: 'language' | 'category',
  ): Promise<string[]> {
    const values = await this.songs
      .createQueryBuilder('song')
      .select(`song.${column}`, 'value')
      .where(`song.${column} IS NOT NULL`)
      .andWhere(`song.${column} <> ''`)
      .distinct(true)
      .orderBy(`song.${column}`, 'ASC')
      .getRawMany<{ value: string }>();

    return values
      .map((row) => row.value)
      .filter((value): value is string => typeof value === 'string');
  }

  private toPublicSong(song: KaraokeSong): SongbookSongResponse {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      language: song.language,
      category: song.category,
      youtubeVideoId: song.youtubeVideoId ?? null,
      source: song.source,
      isVerifiedKaraoke: Boolean(song.isVerifiedKaraoke),
    };
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
  }

  private createSongQuery(): SelectQueryBuilder<KaraokeSong> {
    return this.songs.createQueryBuilder('song').select([
      'song.id',
      'song.title',
      'song.artist',
      'song.language',
      'song.category',
      'song.youtubeVideoId',
      'song.source',
      'song.isVerifiedKaraoke',
    ]);
  }

  private applyFilters(
    queryBuilder: SelectQueryBuilder<KaraokeSong>,
    request: SongbookSearchRequest,
  ): void {
    if (request.language) {
      queryBuilder.andWhere('song.language = :language', { language: request.language });
    }
    if (request.category) {
      queryBuilder.andWhere('song.category = :category', { category: request.category });
    }
    if (request.artist) {
      queryBuilder.andWhere('song.artist = :artist', { artist: request.artist });
    }
  }

  private applyBrowseLetter(
    queryBuilder: SelectQueryBuilder<KaraokeSong>,
    column: 'song.title' | 'song.artist',
    letter?: string,
  ): void {
    if (!letter) return;
    if (letter === '#') {
      queryBuilder.andWhere(`LOWER(LEFT(${column}, 1)) NOT REGEXP '^[a-z]'`);
      return;
    }
    queryBuilder.andWhere(`UPPER(LEFT(${column}, 1)) = :browseLetter`, {
      browseLetter: letter,
    });
  }

  private async countArtists(
    request: SongbookSearchRequest,
    includeLetter: boolean,
  ): Promise<number> {
    const queryBuilder = this.songs
      .createQueryBuilder('song')
      .select('COUNT(DISTINCT song.artist)', 'total')
      .where("song.artist IS NOT NULL AND song.artist <> ''");
    this.applyFilters(queryBuilder, request);
    if (includeLetter) this.applyBrowseLetter(queryBuilder, 'song.artist', request.letter);
    const result = await queryBuilder.getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  private toPagination(page: number, limit: number, total: number) {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && total > 0,
    };
  }
}
