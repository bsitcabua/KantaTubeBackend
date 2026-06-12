import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { SearchGateway } from './search.gateway';
import { SearchLogsModule } from './modules/search-logs/search-logs.module';
import { BugReportModule } from './modules/bug-report/bug-report.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

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
    TypeOrmModule.forRoot({
      type: 'mysql', // Change to 'mysql' if using MySQL
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 4000,
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'kantatube',
      extra: {
        ssl: {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: false,
        },
      },
      autoLoadEntities: true,
      synchronize: false, // Set to false in production
    }),
    VisitorsModule,
    SearchLogsModule,
    BugReportModule,
  ],
})
export class AppModule {}
