import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BuyMeACoffeeConfig,
  parseBuyMeACoffeeConfig,
  parseMaxKaraokeQueueSize,
} from './karaoke-config';

export interface PublicConfigResponse {
  maxKaraokeQueueSize: number;
  buyMeACoffee: BuyMeACoffeeConfig;
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
      buyMeACoffee: parseBuyMeACoffeeConfig({
        autoShow: this.config.get<string>('BUY_ME_A_COFFEE_AUTO_SHOW'),
        afterCompletedSongs: this.config.get<string>(
          'BUY_ME_A_COFFEE_AFTER_COMPLETED_SONGS',
        ),
        cooldownDays: this.config.get<string>('BUY_ME_A_COFFEE_COOLDOWN_DAYS'),
        maxAutoShowPerSession: this.config.get<string>(
          'BUY_ME_A_COFFEE_MAX_AUTO_SHOW_PER_SESSION',
        ),
        manualOpenCountsAsShown: this.config.get<string>(
          'BUY_ME_A_COFFEE_MANUAL_OPEN_COUNTS_AS_SHOWN',
        ),
        manualOpenResetsCooldown: this.config.get<string>(
          'BUY_ME_A_COFFEE_MANUAL_OPEN_RESETS_COOLDOWN',
        ),
      }),
    };
  }
}
