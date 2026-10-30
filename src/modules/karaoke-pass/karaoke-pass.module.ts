import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { KaraokePassAccessService } from './karaoke-pass-access.service';
import { KaraokePassController } from './karaoke-pass.controller';
import { KaraokePassService } from './karaoke-pass.service';
import { PaymentEventsService } from './payment-events.service';
import { PayMongoClient } from './paymongo.client';
import { KaraokePassEntitlement } from './entities/karaoke-pass-entitlement.entity';
import { KaraokePassPurchase } from './entities/karaoke-pass-purchase.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { PayMongoWebhookController } from './paymongo-webhook.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      User,
      KaraokePassPurchase,
      KaraokePassEntitlement,
      PaymentWebhookEvent,
    ]),
  ],
  controllers: [KaraokePassController, PayMongoWebhookController],
  providers: [
    KaraokePassAccessService,
    KaraokePassService,
    PayMongoClient,
    PaymentEventsService,
  ],
  exports: [KaraokePassAccessService, PaymentEventsService],
})
export class KaraokePassModule {}
