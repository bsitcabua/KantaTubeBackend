import { NotFoundException } from '@nestjs/common';
import { KaraokeSong } from '../karaoke/entities/karaoke-song.entity';
import { SongbookService } from './songbook.service';

describe('SongbookService', () => {
  function createQueryBuilder(result: unknown) {
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue(result),
      getCount: jest.fn().mockResolvedValue(result),
      getOne: jest.fn().mockResolvedValue(result),
      getRawOne: jest.fn().mockResolvedValue(result),
      getRawMany: jest.fn().mockResolvedValue(result),
    };
    return builder;
  }

  it('returns a public paginated response without entity internals', async () => {
    const song = Object.assign(new KaraokeSong(), {
      id: 1002,
      title: '214',
      artist: 'Rivermaya',
      language: 'English',
      category: 'OPM',
      youtubeVideoId: 'hNmgGtSTqb8',
      source: 'uploaded_catalog',
      isVerifiedKaraoke: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const builder = createQueryBuilder([[song], 1]);
    const repository = { createQueryBuilder: jest.fn().mockReturnValue(builder) } as never;
    const service = new SongbookService(repository);

    await expect(service.search({ query: '214', page: 1, limit: 20 })).resolves.toEqual({
      data: [{
        id: 1002,
        title: '214',
        artist: 'Rivermaya',
        language: 'English',
        category: 'OPM',
        youtubeVideoId: 'hNmgGtSTqb8',
        source: 'uploaded_catalog',
        isVerifiedKaraoke: false,
      }],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    expect(builder.skip).toHaveBeenCalledWith(0);
    expect(builder.take).toHaveBeenCalledWith(20);
  });

  it('returns letter-filtered artists and the unfiltered artist count from the same Songbook API', async () => {
    const artistBuilder = createQueryBuilder([{ artist: 'Ben&Ben', songCount: '12' }]);
    const filteredCountBuilder = createQueryBuilder({ total: '1' });
    const catalogCountBuilder = createQueryBuilder({ total: '342' });
    const repository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(artistBuilder)
        .mockReturnValueOnce(filteredCountBuilder)
        .mockReturnValueOnce(catalogCountBuilder),
    } as never;
    const service = new SongbookService(repository);

    await expect(
      service.browseArtists({ browse: 'artists', letter: 'B', page: 1, limit: 20 }),
    ).resolves.toEqual({
      data: [{ artist: 'Ben&Ben', songCount: 12 }],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        catalogTotal: 342,
      },
    });
    expect(artistBuilder.groupBy).toHaveBeenCalledWith('song.artist');
    expect(artistBuilder.andWhere).toHaveBeenCalledWith(
      'UPPER(LEFT(song.artist, 1)) = :browseLetter',
      { browseLetter: 'B' },
    );
  });

  it('returns distinct filter values from the database', async () => {
    const languageBuilder = createQueryBuilder([{ value: 'English' }, { value: 'Tagalog' }]);
    const categoryBuilder = createQueryBuilder([{ value: 'International' }, { value: 'OPM' }]);
    const repository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(languageBuilder)
        .mockReturnValueOnce(categoryBuilder),
    } as never;
    const service = new SongbookService(repository);

    await expect(service.filters()).resolves.toEqual({
      languages: ['English', 'Tagalog'],
      categories: ['International', 'OPM'],
    });
  });

  it('returns 404 semantics for an unknown song', async () => {
    const builder = createQueryBuilder(null);
    const repository = { createQueryBuilder: jest.fn().mockReturnValue(builder) } as never;
    const service = new SongbookService(repository);

    await expect(service.findById(9999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
