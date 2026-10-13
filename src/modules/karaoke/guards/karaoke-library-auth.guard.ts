import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { User } from '../../users/entities/user.entity';
import { AuthService } from '../../auth/auth.service';
import { RemoteAuthorizationService } from '../remote-authorization.service';

export type KaraokeLibraryRequest = Request & { authUser: User };

/**
 * Account-library reads may come from either the signed-in Main browser or an
 * approved Remote capability. Mutations still require the Main session and
 * are rejected by the controller's owner-mutation check.
 */
@Injectable()
export class KaraokeLibraryAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly remoteAuthorization: RemoteAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<KaraokeLibraryRequest>();

    const sessionId = this.headerValue(
      request.headers['x-kantatube-remote-session'],
    );
    const deviceId = this.headerValue(
      request.headers['x-kantatube-remote-device'],
    );
    const grantToken = this.headerValue(
      request.headers['x-kantatube-remote-grant'],
    );
    const hasRemoteHeaders = !!(sessionId || deviceId || grantToken);

    // A Remote may have a different or stale login cookie on the phone. For
    // library reads, the approved Remote grant is the account binding; using
    // the cookie first would incorrectly reject valid PUBLIC content.
    if (request.method === 'GET' && hasRemoteHeaders) {
      if (!sessionId || !deviceId || !grantToken) {
        throw new UnauthorizedException();
      }
      request.authUser = await this.remoteAuthorization.resolveLibraryOwner(
        sessionId,
        deviceId,
        grantToken,
      );
      return true;
    }

    const cookieUser = await this.auth.authenticate(
      this.readCookie(request, this.auth.cookieName),
    );
    if (cookieUser) {
      request.authUser = cookieUser;
      return true;
    }

    if (request.method !== 'GET') throw new UnauthorizedException();

    if (!sessionId || !deviceId || !grantToken) {
      throw new UnauthorizedException();
    }

    request.authUser = await this.remoteAuthorization.resolveLibraryOwner(
      sessionId,
      deviceId,
      grantToken,
    );
    return true;
  }

  private readCookie(request: Request, name: string): string | undefined {
    const raw = request.headers.cookie;
    if (!raw) return undefined;
    for (const item of raw.split(';')) {
      const separator = item.indexOf('=');
      if (separator >= 0 && item.slice(0, separator).trim() === name) {
        return decodeURIComponent(item.slice(separator + 1).trim());
      }
    }
    return undefined;
  }

  private headerValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }
}
