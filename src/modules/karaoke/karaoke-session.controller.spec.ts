import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KaraokeSessionController } from './karaoke-session.controller';
import { KaraokeSessionService } from './karaoke-session.service';

describe('KaraokeSessionController', () => {
  const user = { id: '123e4567-e89b-42d3-a456-426614174000' } as User;
  const sessionId = '123e4567-e89b-42d3-a456-426614174001';

  function createController(remoteAuthorization?: {
    renewActiveGrantsForSession?: jest.Mock;
    findActiveSession?: jest.Mock;
  }) {
    const service = {
      create: jest.fn(),
      listActive: jest.fn(),
      get: jest.fn(),
      heartbeat: jest.fn(),
      end: jest.fn(),
    } as unknown as KaraokeSessionService;
    const auth = {
      cookieName: 'kantatube_session',
      issueSocketTicket: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    return {
      controller: new KaraokeSessionController(
        service,
        auth,
        remoteAuthorization as never,
      ),
      service: service as jest.Mocked<KaraokeSessionService>,
      auth,
    };
  }

  it('requires authentication for every endpoint', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, KaraokeSessionController),
    ).toContain(SessionAuthGuard);
  });

  it('requires origin checks for every mutation', () => {
    for (const method of ['create', 'heartbeat', 'end'] as const) {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          KaraokeSessionController.prototype[method],
        ),
      ).toContain(OriginGuard);
    }
  });

  it('derives ownership from the authenticated user for all operations', () => {
    const { controller, service } = createController();

    controller.create(user, { alias: 'Living Room' });
    controller.listActive(user);
    controller.get(user, sessionId);
    controller.heartbeat(user, sessionId);
    controller.end(user, sessionId);

    expect(service.create).toHaveBeenCalledWith(user.id, 'Living Room');
    expect(service.listActive).toHaveBeenCalledWith(user.id);
    expect(service.get).toHaveBeenCalledWith(user.id, sessionId);
    expect(service.heartbeat).toHaveBeenCalledWith(user.id, sessionId);
    expect(service.end).toHaveBeenCalledWith(user.id, sessionId);
  });

  it('renews remote grants only after a successful owned heartbeat', async () => {
    const remoteAuthorization = {
      renewActiveGrantsForSession: jest.fn().mockResolvedValue(1),
    };
    const { controller, service } = createController(remoteAuthorization);
    service.heartbeat.mockResolvedValue({} as never);

    await controller.heartbeat(user, sessionId);

    expect(service.heartbeat).toHaveBeenCalledWith(user.id, sessionId);
    expect(
      remoteAuthorization.renewActiveGrantsForSession,
    ).toHaveBeenCalledWith(sessionId);
  });

  it('issues a ticket only after it verifies the owned active karaoke session', async () => {
    const remoteAuthorization = {
      findActiveSession: jest.fn().mockResolvedValue({ id: sessionId }),
    };
    const { controller, auth } = createController(remoteAuthorization);
    const expiresAt = new Date(Date.now() + 60_000);
    auth.issueSocketTicket.mockResolvedValue({
      ticket: 'session-bound-ticket',
      expiresAt,
    });

    const result = await controller.socketTicket(user, sessionId, {
      headers: { cookie: 'other=value; kantatube_session=raw%20session%20token' },
    } as never);

    expect(remoteAuthorization.findActiveSession).toHaveBeenCalledWith(
      user.id,
      sessionId,
    );
    expect(auth.issueSocketTicket).toHaveBeenCalledWith(
      'raw session token',
      sessionId,
    );
    expect(result).toEqual({ ticket: 'session-bound-ticket', expiresAt });
  });

  it('does not renew grants when the heartbeat fails', async () => {
    const remoteAuthorization = {
      renewActiveGrantsForSession: jest.fn(),
    };
    const { controller, service } = createController(remoteAuthorization);
    service.heartbeat.mockRejectedValue(new Error('heartbeat failed'));

    await expect(controller.heartbeat(user, sessionId)).rejects.toThrow(
      'heartbeat failed',
    );
    expect(
      remoteAuthorization.renewActiveGrantsForSession,
    ).not.toHaveBeenCalled();
  });
});
