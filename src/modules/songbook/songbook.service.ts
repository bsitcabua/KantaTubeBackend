import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KaraokeSong } from '../karaoke/entities/karaoke-song.entity';
import { SongbookSearchRequest } from './songbook.dto';
import {
  SongbookFiltersResponse,
  SongbookSearchResponse,
  SongbookSongResponse,
} from './songbook.types';

@Injectable()
export class SongbookService {
  constructor(
    @InjectRepository(KaraokeSong)
    private readonly songs: Repository<KaraokeSong>,
  ) {}

  async search(request: SongbookSearchRequest): Promise<SongbookSearchResponse> {
    const queryBuilder = this.songs
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
      ]);

    if (request.language) {
      queryBuilder.andWhere('song.language = :language', {
        language: request.language,
      });
    }

    if (request.category) {
      queryBuilder.andWhere('song.category = :category', {
        category: request.category,
      });
    }

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
      queryBuilder.orderBy('song.title', 'ASC');
    }

    queryBuilder
      .addOrderBy('song.artist', 'ASC')
      .addOrderBy('song.id', 'ASC')
      .skip((request.page - 1) * request.limit)
      .take(request.limit);

    const [songs, total] = await queryBuilder.getManyAndCount();
    const totalPages = total === 0 ? 0 : Math.ceil(total / request.limit);

    return {
      data: songs.map((song) => this.toPublicSong(song)),
      pagination: {
        page: request.page,
        limit: request.limit,
        total,
        totalPages,
        hasNextPage: request.page < totalPages,
        hasPreviousPage: request.page > 1 && total > 0,
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
    const [languages, categories] = await Promise.all([
      this.getDistinctValues('language'),
      this.getDistinctValues('category'),
    ]);

    return { languages, categories };
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
}
