import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { SearchGateway } from './search.gateway';
import { SearchLogsModule } from './modules/search-logs/search-logs.module';
import { BugReportModule } from './modules/bug-report/bug-report.module';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { AuthModule } from './modules/auth/auth.module';
import { getDatabaseOptions } from './database/database.config';
import { KaraokeModule } from './modules/karaoke/karaoke.module';
import { RateLimiterModule } from './common/rate-limit/rate-limiter.module';
import { PublicConfigController } from './config/public-config.controller';
import { SongbookModule } from './modules/songbook/songbook.module';
import { KaraokePassModule } from './modules/karaoke-pass/karaoke-pass.module';
import { validateEnvironment } from './config/environment.validation';

@Module({
  controllers: [PublicConfigController],
  providers: [SearchGateway],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the config available globally
      validate: validateEnvironment,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads', 'profile-avatars'),
      serveRoot: '/uploads/profile-avatars',
      serveStaticOptions: { index: false },
    }),
    TypeOrmModule.forRoot(getDatabaseOptions()),
    VisitorsModule,
    SearchLogsModule,
    BugReportModule,
    YoutubeModule,
    AuthModule,
    KaraokeModule,
    KaraokePassModule,
    SongbookModule,
    RateLimiterModule,
  ],
})
export class AppModule {}
