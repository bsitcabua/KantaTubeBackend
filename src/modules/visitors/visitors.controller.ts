import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { VisitorsService } from './visitors.service';
import { parseVisitorCreateDto } from './visitors.dto';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';

@Controller('visitors')
export class VisitorsController {

  constructor(
    private readonly visitorsService: VisitorsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get('connecting')
  async connecting(): Promise<{ success: boolean; status: number }> {
    return {
      success: true,
      status: 200,
    };
  }

  @Post('create')
  create(@Body() visitor: unknown, @Req() request: Request) {
    this.rateLimiter.checkVisitorCreation(request.ip || 'unknown');
    return this.visitorsService.create(parseVisitorCreateDto(visitor));
  }
}
