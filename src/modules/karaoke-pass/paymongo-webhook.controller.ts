import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PayMongoMode } from './karaoke-pass.config';
import { KaraokePassService } from './karaoke-pass.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/paymongo')
export class PayMongoWebhookController {
  constructor(private readonly passes: KaraokePassService) {}

  @Post('test')
  test(
    @Req() request: RawBodyRequest,
    @Headers('paymongo-signature') signature: string | undefined,
  ) {
    return this.handle(request, signature, 'test');
  }

  @Post('live')
  live(
    @Req() request: RawBodyRequest,
    @Headers('paymongo-signature') signature: string | undefined,
  ) {
    return this.handle(request, signature, 'live');
  }

  private handle(
    request: RawBodyRequest,
    signature: string | undefined,
    mode: PayMongoMode,
  ) {
    if (!request.rawBody)
      throw new BadRequestException(
        'PayMongo webhook raw body is unavailable.',
      );
    return this.passes.handleWebhook(request.rawBody, signature, mode);
  }
}
