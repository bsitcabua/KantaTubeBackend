import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/guards/origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KaraokeSessionController } from './karaoke-session.controller';
import { KaraokeSessionService } from './karaoke-session.service';

describe('KaraokeSessionController', () => {
  const user = { id: '123e4567-e89b-42d3-a456-426614174000' } as User;
  const sessionId = '123e4567-e89b-42d3-a456-426614174001';

  function createController() {
    const service = {
      create: jest.fn(),
      listActive: jest.fn(),
      get: jest.fn(),
      heartbeat: jest.fn(),
      end: jest.fn(),
    } as unknown as KaraokeSessionService;
    return {
      controller: new KaraokeSessionController(service),
      service: service as jest.Mocked<KaraokeSessionService>,
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
});
