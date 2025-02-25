import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VisitorsModule } from './modules/visitors/visitors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the config available globally
    }),
    TypeOrmModule.forRoot({
      type: 'mysql', // Change to 'mysql' if using MySQL
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'kantatube_karaoke',
      autoLoadEntities: true,
      synchronize: false, // Set to false in production
    }),
    VisitorsModule,
  ],
})
export class AppModule {}
