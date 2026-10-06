import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/guards/origin.guard';
import { RemoteAuthorizationService } from './remote-authorization.service';

@Controller('remote-hosts')
@UseGuards(OriginGuard)
export class KaraokeRemoteHostController {
  constructor(
    private readonly remoteAuthorization: RemoteAuthorizationService,
  ) {}

  @Post()
  create() {
    return this.remoteAuthorization.createGuestHost();
  }

  @Post(':sessionId/remote-pairing')
  createPairing(
    @Param('sessionId') sessionId: string,
    @Body() body: { hostToken?: unknown },
  ) {
    return this.remoteAuthorization.createGuestPairingToken(
      sessionId,
      body?.hostToken,
    );
  }
}
