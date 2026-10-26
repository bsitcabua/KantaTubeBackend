import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('GET /api/auth/me', () => {
  let app: INestApplication;
  const user = { id: 'user-1', displayName: 'Singer', email: null, providers: [] };
  const auth = {
    cookieName: 'kantatube_session',
    authenticate: jest.fn(),
    getCurrentUserFromAuthenticatedUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('returns 200 through the real guard and controller without a second user lookup', async () => {
    auth.authenticate.mockResolvedValue(user);
    auth.getCurrentUserFromAuthenticatedUser.mockReturnValue(user);
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', 'kantatube_session=test-session').expect(200, user);
    expect(auth.authenticate).toHaveBeenCalledWith('test-session', true);
    expect(auth.getCurrentUserFromAuthenticatedUser).toHaveBeenCalledWith(user);
  });

  it('returns 401 for an unauthenticated request', async () => {
    auth.authenticate.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(auth.getCurrentUserFromAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('returns an explicit server error when the authentication query rejects', async () => {
    auth.authenticate.mockRejectedValue(new Error('Database unavailable'));
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Cookie', 'kantatube_session=test-session').expect(500);
    expect(auth.getCurrentUserFromAuthenticatedUser).not.toHaveBeenCalled();
  });
});
