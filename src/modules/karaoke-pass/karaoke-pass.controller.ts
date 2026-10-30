import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KaraokePassService } from './karaoke-pass.service';

@Controller('karaoke-passes')
export class KaraokePassController {
  constructor(private readonly passes: KaraokePassService) {}

  @Get('plans')
  plans() {
    return this.passes.listPlans();
  }

  @Get('access')
  @UseGuards(SessionAuthGuard)
  access(@CurrentUser() user: User) {
    return this.passes.accessSummary(user.id);
  }

  @Get('purchases/current')
  @UseGuards(SessionAuthGuard)
  current(@CurrentUser() user: User) {
    return this.passes.currentPurchase(user.id);
  }

  @Get('purchases/history')
  @UseGuards(SessionAuthGuard)
  history(
    @CurrentUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.passes.history(user.id, page, limit);
  }

  @Post('purchases')
  @UseGuards(SessionAuthGuard, OriginGuard)
  create(@CurrentUser() user: User, @Body() body: { planCode?: unknown }) {
    return this.passes.createPurchase(user.id, body?.planCode);
  }

  @Get('purchases/:reference')
  @UseGuards(SessionAuthGuard)
  get(@CurrentUser() user: User, @Param('reference') reference: string) {
    return this.passes.getPurchase(user.id, reference);
  }

  @Post('purchases/:purchaseId/check-payment-status')
  @UseGuards(SessionAuthGuard, OriginGuard)
  checkPaymentStatus(
    @CurrentUser() user: User,
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.passes.checkPaymentStatus(user.id, purchaseId);
  }

  @Post('purchases/:reference/regenerate-qr')
  @UseGuards(SessionAuthGuard, OriginGuard)
  regenerate(@CurrentUser() user: User, @Param('reference') reference: string) {
    return this.passes.regenerateQr(user.id, reference);
  }

  @Post('purchases/:reference/change-plan')
  @UseGuards(SessionAuthGuard, OriginGuard)
  changePlan(
    @CurrentUser() user: User,
    @Param('reference') reference: string,
    @Body() body: { planCode?: unknown },
  ) {
    return this.passes.changePlan(user.id, reference, body?.planCode);
  }
}
