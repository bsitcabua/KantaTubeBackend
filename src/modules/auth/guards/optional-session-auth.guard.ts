import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { User } from '../../users/entities/user.entity';

export type OptionalAuthenticatedRequest = Request & { authUser?: User };

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OptionalAuthenticatedRequest>();
    const user = await this.auth.authenticate(
      this.readCookie(request, this.auth.cookieName),
    );
    if (user) {
      request.authUser = user;
    }
    return true;
  }

  private readCookie(request: Request, name: string): string | undefined {
    const cookie = request.headers.cookie;
    if (!cookie) return undefined;
    for (const item of cookie.split(';')) {
      const separator = item.indexOf('=');
      if (separator < 0) continue;
      if (item.slice(0, separator).trim() === name) {
        return decodeURIComponent(item.slice(separator + 1).trim());
      }
    }
    return undefined;
  }
}
