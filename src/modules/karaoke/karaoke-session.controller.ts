import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Optional,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KaraokeSessionService } from './karaoke-session.service';
import { RemoteAuthorizationService } from './remote-authorization.service';

@Controller('karaoke-sessions')
@UseGuards(SessionAuthGuard)
export class KaraokeSessionController {
  constructor(
    private readonly sessions: KaraokeSessionService,
    @Optional()
    private readonly remoteAuthorization?: RemoteAuthorizationService,
  ) {}

  @Post()
  @UseGuards(OriginGuard)
  create(@CurrentUser() user: User, @Body() body: { alias?: unknown }) {
    return this.sessions.create(user.id, body?.alias);
  }

  @Get('active')
  listActive(@CurrentUser() user: User) {
    return this.sessions.listActive(user.id);
  }

  @Get(':sessionId')
  get(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.get(user.id, sessionId);
  }

  @Get(':sessionId/queue')
  queue(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.getQueue(user.id, sessionId);
  }

  @Put(':sessionId/queue')
  @UseGuards(OriginGuard)
  replaceQueue(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
    @Body() body: { items?: unknown },
  ) {
    return this.sessions.replaceQueue(user.id, sessionId, body?.items);
  }

  @Post(':sessionId/transfer')
  @UseGuards(OriginGuard)
  transfer(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.transfer(user.id, sessionId).then(async (result) => {
      await this.remoteAuthorization?.invalidateSession(sessionId);
      return result;
    });
  }

  @Post(':sessionId/heartbeat')
  @UseGuards(OriginGuard)
  heartbeat(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.heartbeat(user.id, sessionId);
  }

  @Post(':sessionId/end')
  @UseGuards(OriginGuard)
  async end(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    const result = await this.sessions.end(user.id, sessionId);
    await this.remoteAuthorization?.invalidateSession(sessionId);
    return result;
  }

  @Post(':sessionId/remote-pairing')
  @UseGuards(OriginGuard)
  createRemotePairing(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
  ) {
    return this.remoteAuthorization.createPairingToken(user.id, sessionId);
  }
}
