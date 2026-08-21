import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { KaraokeSession } from './entities/karaoke-session.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionController } from './karaoke-session.controller';
import { KaraokeSessionService } from './karaoke-session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KaraokeSession, KaraokeQueueItem, User]),
    AuthModule,
  ],
  controllers: [KaraokeSessionController],
  providers: [KaraokeSessionService],
  exports: [KaraokeSessionService],
})
export class KaraokeModule {}
