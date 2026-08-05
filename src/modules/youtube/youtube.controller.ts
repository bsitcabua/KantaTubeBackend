import { Controller, Get, Query } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import {
  YoutubeKeyAliasesResponse,
  YoutubeSearchResponse,
} from './youtube.types';

@Controller('youtube')
export class YoutubeController {
  constructor(private readonly youtubeService: YoutubeService) {}

  @Get('key-aliases')
  getKeyAliases(): YoutubeKeyAliasesResponse {
    return this.youtubeService.getKeyAliases();
  }

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('keyAlias') keyAlias?: string,
  ): Promise<YoutubeSearchResponse> {
    return this.youtubeService.search(query, keyAlias);
  }
}
