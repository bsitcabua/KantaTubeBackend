import { Injectable } from '@nestjs/common';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';

/** Compatibility name for existing tests/imports. */
@Injectable()
export class YoutubeRateLimiterService extends RateLimiterService {}
