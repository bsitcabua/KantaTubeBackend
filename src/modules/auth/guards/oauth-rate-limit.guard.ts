import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class OAuthRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const cutoff = Date.now() - 10 * 60 * 1000;
    const recent = (this.attempts.get(key) || []).filter(
      (time) => time > cutoff,
    );
    if (recent.length >= 20) {
      throw new HttpException(
        'Too many sign-in attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(Date.now());
    this.attempts.set(key, recent);
    return true;
  }
}
