import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { KaraokeSession } from './entities/karaoke-session.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokeSessionPerformer } from './entities/karaoke-session-performer.entity';
import { KaraokePairingSession } from './entities/karaoke-pairing-session.entity';
import { KaraokeRemoteGrant } from './entities/karaoke-remote-grant.entity';
import { KaraokeSessionController } from './karaoke-session.controller';
import { KaraokeRemoteHostController } from './karaoke-remote-host.controller';
import { KaraokeSessionService } from './karaoke-session.service';
import { RemoteAuthorizationService } from './remote-authorization.service';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';
import { KaraokeSong } from './entities/karaoke-song.entity';
import { KaraokeFavorite } from './entities/karaoke-favorite.entity';
import { KaraokePlaylist } from './entities/karaoke-playlist.entity';
import { KaraokePlaylistItem } from './entities/karaoke-playlist-item.entity';
import { KaraokeScoreHistory } from './entities/karaoke-score-history.entity';
import { DailyKaraokeUsage } from './entities/daily-karaoke-usage.entity';
import { KaraokeLibraryController } from './karaoke-library.controller';
import { KaraokeLibraryService } from './karaoke-library.service';
import { KaraokeLibraryCacheService } from './karaoke-library-cache.service';
import { KaraokeLibraryEventsService } from './karaoke-library-events.service';
import { KaraokeLibraryAuthGuard } from './guards/karaoke-library-auth.guard';
import { KaraokeScoreHistoryService } from './karaoke-score-history.service';
import { KaraokeUsageService } from './karaoke-usage.service';
import { KaraokePassModule } from '../karaoke-pass/karaoke-pass.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KaraokeSession,
      KaraokeQueueItem,
      KaraokeSessionPerformer,
      KaraokePairingSession,
      KaraokeRemoteGrant,
      KaraokeRemoteHostSession,
      User,
      KaraokeSong,
      KaraokeFavorite,
      KaraokePlaylist,
      KaraokePlaylistItem,
      KaraokeScoreHistory,
      DailyKaraokeUsage,
    ]),
    AuthModule,
    KaraokePassModule,
  ],
  controllers: [
    KaraokeSessionController,
    KaraokeRemoteHostController,
    KaraokeLibraryController,
  ],
  providers: [
    KaraokeSessionService,
    RemoteAuthorizationService,
    KaraokeLibraryService,
    KaraokeLibraryCacheService,
    KaraokeLibraryEventsService,
    KaraokeLibraryAuthGuard,
    KaraokeScoreHistoryService,
    KaraokeUsageService,
  ],
  exports: [
    KaraokeSessionService,
    RemoteAuthorizationService,
    KaraokeLibraryEventsService,
    KaraokeUsageService,
  ],
})
export class KaraokeModule {}
