import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    const allowed = (
      this.config.get<string>('APP_FRONTEND_URLS') ||
      this.config.get<string>('APP_FRONTEND_URL') ||
      'http://localhost:4200'
    )
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''));
    if (origin && !allowed.includes(origin.replace(/\/$/, ''))) {
      throw new ForbiddenException('Request origin is not allowed.');
    }
    return true;
  }
}
