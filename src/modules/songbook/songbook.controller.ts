import { Controller, Get, Headers, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import {
  parseSongbookId,
  parseSongbookSearchRequest,
} from './songbook.dto';
import { SongbookService } from './songbook.service';

@Controller('songbook')
export class SongbookController {
  constructor(
    private readonly songbook: SongbookService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get()
  search(
    @Query('q') query: unknown,
    @Query('language') language: unknown,
    @Query('category') category: unknown,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
    @Query('browse') browse: unknown,
    @Query('letter') letter: unknown,
    @Query('artist') artist: unknown,
    @Headers('x-kantatube-visitor-id') visitorId: unknown,
    @Req() request: Request,
  ) {
    this.rateLimiter.checkSongbookSearch(
      this.getClientId(request, visitorId),
    );
    const searchRequest = parseSongbookSearchRequest(
      query,
      language,
      category,
      page,
      limit,
      browse,
      letter,
      artist,
    );
    return searchRequest.browse === 'artists'
      ? this.songbook.browseArtists(searchRequest)
      : this.songbook.search(searchRequest);
  }

  @Get('filters')
  filters() {
    return this.songbook.filters();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.songbook.findById(parseSongbookId(id));
  }

  private getClientId(request: Request, visitorId: unknown): string {
    const identity =
      typeof visitorId === 'string' && visitorId.trim().length <= 100
        ? visitorId.trim()
        : 'anonymous';
    return `${request.ip || 'unknown'}:${identity || 'anonymous'}`;
  }
}
