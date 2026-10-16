import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { RemoteAuthorizationService } from '../remote-authorization.service';
import { KaraokeLibraryAuthGuard } from './karaoke-library-auth.guard';

describe('KaraokeLibraryAuthGuard', () => {
  function createGuard() {
    const auth = {
      cookieName: 'kantatube_session',
      authenticate: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<AuthService>;
    const remoteAuthorization = {
      resolveLibraryOwner: jest.fn(),
    } as unknown as jest.Mocked<RemoteAuthorizationService>;
    return {
      guard: new KaraokeLibraryAuthGuard(auth, remoteAuthorization),
      auth,
      remoteAuthorization,
    };
  }

  function contextFor(request: { method: string; headers: Record<string, string> }): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('rejects unauthenticated Favorites and Playlists mutations before they reach the controller', async () => {
    const { guard, auth } = createGuard();

    await expect(guard.canActivate(contextFor({ method: 'POST', headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contextFor({ method: 'PATCH', headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);

    expect(auth.authenticate).toHaveBeenCalledTimes(2);
  });

  it('does not allow a Remote library grant to mutate account data without an owner session', async () => {
    const { guard, remoteAuthorization } = createGuard();

    await expect(guard.canActivate(contextFor({
      method: 'DELETE',
      headers: {
        'x-kantatube-remote-session': 'session',
        'x-kantatube-remote-device': 'device',
        'x-kantatube-remote-grant': 'grant',
      },
    }))).rejects.toBeInstanceOf(UnauthorizedException);

    expect(remoteAuthorization.resolveLibraryOwner).not.toHaveBeenCalled();
  });
});
