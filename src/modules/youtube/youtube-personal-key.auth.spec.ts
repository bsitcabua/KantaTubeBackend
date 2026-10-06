import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { YoutubeController } from './youtube.controller';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';

describe('personal YouTube key authorization', () => {
  const userA = {
    id: '123e4567-e89b-42d3-a456-426614174000',
  } as any;
  const userB = {
    id: '123e4567-e89b-42d3-a456-426614174001',
  } as any;
  const apiKey = `AIza${'a'.repeat(35)}`;

  it('binds registration, status, and removal to the authenticated server user', () => {
    const personalKeys = new YoutubePersonalKeyService({
      get: jest.fn(),
    } as any);
    const controller = new YoutubeController(
      {} as any,
      personalKeys,
      new RateLimiterService(),
    );

    const response = controller.registerPersonalKey(
      { apiKey },
      { ip: '127.0.0.1' } as any,
      userA,
    );

    expect(response).toEqual({ available: true, alias: 'personal_session' });
    expect(JSON.stringify(response)).not.toContain(apiKey);
    expect(controller.getPersonalKeyStatus(userB).available).toBe(false);
    expect(controller.removePersonalKey(userB)).toEqual({ removed: false });
    expect(controller.removePersonalKey(userA)).toEqual({ removed: true });
  });

  it('does not let an anonymous visitor UUID satisfy the authenticated guard', async () => {
    const auth = {
      cookieName: 'kantatube_session',
      authenticate: jest.fn().mockResolvedValue(null),
    };
    const guard = new SessionAuthGuard(auth as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            cookie: 'kantatube_session=123e4567-e89b-42d3-a456-426614174000',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
