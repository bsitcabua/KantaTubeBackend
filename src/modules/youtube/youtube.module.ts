import { Module } from '@nestjs/common';
import { YoutubeController } from './youtube.controller';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeSearchCacheService } from './youtube-search-cache.service';
import { YoutubeService } from './youtube.service';
import { AuthModule } from '../auth/auth.module';
import { RateLimiterModule } from '../../common/rate-limit/rate-limiter.module';

@Module({
  controllers: [YoutubeController],
  imports: [AuthModule, RateLimiterModule],
  providers: [
    YoutubeService,
    YoutubePersonalKeyService,
    YoutubeSearchCacheService,
  ],
})
export class YoutubeModule {}
