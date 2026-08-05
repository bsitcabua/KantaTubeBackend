import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeRateLimiterService } from './youtube-rate-limiter.service';
import { YoutubeService } from './youtube.service';
import {
  YoutubeKeyAliasesResponse,
  YoutubePersonalKeyDeleteResponse,
  YoutubePersonalKeyRequest,
  YoutubePersonalKeyStatusResponse,
  YoutubeSearchResponse,
} from './youtube.types';

@Controller('youtube')
export class YoutubeController {
  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly personalKeyService: YoutubePersonalKeyService,
    private readonly rateLimiterService: YoutubeRateLimiterService,
  ) {}

  @Get('key-aliases')
  getKeyAliases(
    @Headers('x-kantatube-visitor-id') visitorId?: string,
  ): YoutubeKeyAliasesResponse {
    return this.youtubeService.getKeyAliases(visitorId);
  }

  @Post('personal-keys')
  registerPersonalKey(
    @Headers('x-kantatube-visitor-id') visitorId: string,
    @Body() request: YoutubePersonalKeyRequest,
    @Req() httpRequest: Request,
  ): YoutubePersonalKeyStatusResponse {
    this.rateLimiterService.checkRegistration(
      this.getClientId(httpRequest, visitorId),
    );
    return this.personalKeyService.register(visitorId, request?.apiKey);
  }

  @Get('personal-keys/status')
  getPersonalKeyStatus(
    @Headers('x-kantatube-visitor-id') visitorId: string,
  ): YoutubePersonalKeyStatusResponse {
    return this.personalKeyService.getStatus(visitorId);
  }

  @Delete('personal-keys')
  removePersonalKey(
    @Headers('x-kantatube-visitor-id') visitorId: string,
  ): YoutubePersonalKeyDeleteResponse {
    return this.personalKeyService.remove(visitorId);
  }

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('keyAlias') keyAlias?: string,
    @Headers('x-kantatube-visitor-id') visitorId?: string,
    @Req() httpRequest?: Request,
  ): Promise<YoutubeSearchResponse> {
    this.rateLimiterService.checkSearch(
      this.getClientId(httpRequest, visitorId),
    );
    return this.youtubeService.search(query, keyAlias, visitorId);
  }

  private getClientId(request?: Request, visitorId?: string): string {
    return `${request?.ip || 'unknown'}:${
      visitorId?.trim() || 'no-visitor'
    }`;
  }
}
