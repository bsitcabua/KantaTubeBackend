import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
  Optional,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KaraokeSessionService } from './karaoke-session.service';
import { RemoteAuthorizationService } from './remote-authorization.service';

@Controller('karaoke-sessions')
@UseGuards(SessionAuthGuard)
export class KaraokeSessionController {
  private readonly logger = new Logger(KaraokeSessionController.name);

  constructor(
    private readonly sessions: KaraokeSessionService,
    private readonly auth: AuthService,
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

  /**
   * A browser on Vercel cannot rely on the Render session cookie during a
   * Socket.IO handshake. Issue a short-lived ticket only after the final,
   * active karaoke session has been verified for the authenticated owner.
   */
  @Get(':sessionId/socket-ticket')
  async socketTicket(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ) {
    const session = await this.remoteAuthorization?.findActiveSession(
      user.id,
      sessionId,
    );
    if (!session) {
      throw new ServiceUnavailableException(
        'Remote authorization is not configured.',
      );
    }
    const ticket = await this.auth.issueSocketTicket(
      this.readCookie(request, this.auth.cookieName),
      session.id,
    );
    this.logger.log(
      `Socket ticket issued for karaoke session ${this.redactSessionId(session.id)}; expires ${ticket.expiresAt.toISOString()}`,
    );
    return ticket;
  }

  @Get(':sessionId/queue')
  queue(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.getQueue(user.id, sessionId);
  }

  @Get(':sessionId')
  get(@CurrentUser() user: User, @Param('sessionId') sessionId: string) {
    return this.sessions.get(user.id, sessionId);
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
  async heartbeat(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
  ) {
    const result = await this.sessions.heartbeat(user.id, sessionId);
    try {
      await this.remoteAuthorization?.renewActiveGrantsForSession(sessionId);
    } catch (error) {
      this.logger.warn(
        `Unable to renew remote grants for session ${sessionId.slice(0, 8)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    return result;
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

  private readCookie(request: Request, name: string): string | undefined {
    for (const item of (request.headers.cookie || '').split(';')) {
      const separator = item.indexOf('=');
      if (separator >= 0 && item.slice(0, separator).trim() === name) {
        return decodeURIComponent(item.slice(separator + 1).trim());
      }
    }
    return undefined;
  }

  private redactSessionId(sessionId: string): string {
    return `${sessionId.slice(0, 8)}…`;
  }
}
