import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { SearchGateway } from './search.gateway';
import { SearchLogsModule } from './modules/search-logs/search-logs.module';
import { BugReportModule } from './modules/bug-report/bug-report.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { AuthModule } from './modules/auth/auth.module';
import { getDatabaseOptions } from './database/database.config';
import { KaraokeModule } from './modules/karaoke/karaoke.module';

@Module({
  providers: [SearchGateway],
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    ConfigModule.forRoot({
      isGlobal: true, // Makes the config available globally
    }),
    TypeOrmModule.forRoot(getDatabaseOptions()),
    VisitorsModule,
    SearchLogsModule,
    BugReportModule,
    YoutubeModule,
    AuthModule,
    KaraokeModule,
  ],
})
export class AppModule {}
