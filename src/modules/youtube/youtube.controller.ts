import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  OptionalAuthenticatedRequest,
  OptionalSessionAuthGuard,
} from '../auth/guards/optional-session-auth.guard';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeService } from './youtube.service';
import {
  YoutubeKeyAliasesResponse,
  YoutubePersonalKeyDeleteResponse,
  YoutubePersonalKeyStatusResponse,
  YoutubeSearchResponse,
} from './youtube.types';
import {
  parseOptionalVisitorId,
  parseYoutubePersonalKeyRequest,
  parseYoutubeSearchRequest,
} from './youtube.dto';

@Controller('youtube')
export class YoutubeController {
  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly personalKeyService: YoutubePersonalKeyService,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  @Get('key-aliases')
  @UseGuards(OptionalSessionAuthGuard)
  getKeyAliases(
    @Headers('x-kantatube-visitor-id') visitorId?: string,
    @Req() request?: OptionalAuthenticatedRequest,
  ): YoutubeKeyAliasesResponse {
    parseOptionalVisitorId(visitorId);
    return this.youtubeService.getKeyAliases(request?.authUser?.id);
  }

  @Post('personal-keys')
  @UseGuards(OriginGuard, SessionAuthGuard)
  registerPersonalKey(
    @Body() request: unknown,
    @Req() httpRequest: Request,
    @CurrentUser() user: User,
  ): YoutubePersonalKeyStatusResponse {
    this.rateLimiterService.checkRegistration(
      this.getClientId(httpRequest, user.id),
    );
    const personalKeyRequest = parseYoutubePersonalKeyRequest(request);
    return this.personalKeyService.register(user.id, personalKeyRequest.apiKey);
  }

  @Get('personal-keys/status')
  @UseGuards(SessionAuthGuard)
  getPersonalKeyStatus(
    @CurrentUser() user: User,
  ): YoutubePersonalKeyStatusResponse {
    return this.personalKeyService.getStatus(user.id);
  }

  @Delete('personal-keys')
  @UseGuards(OriginGuard, SessionAuthGuard)
  removePersonalKey(
    @CurrentUser() user: User,
  ): YoutubePersonalKeyDeleteResponse {
    return this.personalKeyService.remove(user.id);
  }

  @Get('search')
  @UseGuards(OptionalSessionAuthGuard)
  search(
    @Query('q') query: unknown,
    @Query('keyAlias') keyAlias: unknown,
    @Headers('x-kantatube-visitor-id') visitorId?: string,
    @Req() httpRequest?: OptionalAuthenticatedRequest,
  ): Promise<YoutubeSearchResponse> {
    const searchRequest = parseYoutubeSearchRequest(query, keyAlias, visitorId);
    this.rateLimiterService.checkSearch(
      this.getClientId(
        httpRequest,
        searchRequest.visitorId || httpRequest?.authUser?.id,
      ),
    );
    return this.youtubeService.search(
      searchRequest.query,
      searchRequest.keyAlias,
      httpRequest?.authUser?.id,
    );
  }

  private getClientId(request?: Request, identity?: string): string {
    return `${request?.ip || 'unknown'}:${
      identity?.trim() || 'anonymous'
    }`;
  }
}
