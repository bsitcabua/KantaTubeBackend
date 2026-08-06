import { Module } from '@nestjs/common';
import { YoutubeController } from './youtube.controller';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeRateLimiterService } from './youtube-rate-limiter.service';
import { YoutubeSearchCacheService } from './youtube-search-cache.service';
import { YoutubeService } from './youtube.service';

@Module({
  controllers: [YoutubeController],
  providers: [
    YoutubeService,
    YoutubePersonalKeyService,
    YoutubeRateLimiterService,
    YoutubeSearchCacheService,
  ],
})
export class YoutubeModule {}
