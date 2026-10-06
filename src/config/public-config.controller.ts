import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseMaxKaraokeQueueSize } from './karaoke-config';

export interface PublicConfigResponse {
  maxKaraokeQueueSize: number;
}

@Controller('config')
export class PublicConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get('public')
  getPublicConfig(): PublicConfigResponse {
    return {
      maxKaraokeQueueSize: parseMaxKaraokeQueueSize(
        this.config.get<string>('MAX_KARAOKE_QUEUE_SIZE'),
      ),
    };
  }
}
