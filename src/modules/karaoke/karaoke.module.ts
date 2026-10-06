import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { KaraokeSession } from './entities/karaoke-session.entity';
import { KaraokeQueueItem } from './entities/karaoke-queue-item.entity';
import { KaraokePairingSession } from './entities/karaoke-pairing-session.entity';
import { KaraokeRemoteGrant } from './entities/karaoke-remote-grant.entity';
import { KaraokeSessionController } from './karaoke-session.controller';
import { KaraokeRemoteHostController } from './karaoke-remote-host.controller';
import { KaraokeSessionService } from './karaoke-session.service';
import { RemoteAuthorizationService } from './remote-authorization.service';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KaraokeSession,
      KaraokeQueueItem,
      KaraokePairingSession,
      KaraokeRemoteGrant,
      KaraokeRemoteHostSession,
      User,
    ]),
    AuthModule,
  ],
  controllers: [KaraokeSessionController, KaraokeRemoteHostController],
  providers: [
    KaraokeSessionService,
    RemoteAuthorizationService,
  ],
  exports: [
    KaraokeSessionService,
    RemoteAuthorizationService,
  ],
})
export class KaraokeModule {}
