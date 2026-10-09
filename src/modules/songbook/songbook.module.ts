import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimiterModule } from '../../common/rate-limit/rate-limiter.module';
import { KaraokeSong } from '../karaoke/entities/karaoke-song.entity';
import { SongbookController } from './songbook.controller';
import { SongbookService } from './songbook.service';
import { SongbookSearchCacheService } from './songbook-search-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([KaraokeSong]), RateLimiterModule],
  controllers: [SongbookController],
  providers: [SongbookService, SongbookSearchCacheService],
  exports: [SongbookService],
})
export class SongbookModule {}
