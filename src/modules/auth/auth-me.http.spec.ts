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
    updateAppearanceMode: jest.fn(),
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

  it('updates appearance through the authenticated preferences route', async () => {
    auth.authenticate.mockResolvedValue(user);
    auth.updateAppearanceMode.mockResolvedValue({ ...user, appearanceMode: 'DARK' });

    await request(app.getHttpServer())
      .patch('/api/auth/preferences')
      .set('Cookie', 'kantatube_session=test-session')
      .send({ appearanceMode: 'DARK' })
      .expect(200, { ...user, appearanceMode: 'DARK' });

    expect(auth.updateAppearanceMode).toHaveBeenCalledWith('user-1', 'DARK');
  });

  it('rejects an unauthenticated appearance update', async () => {
    auth.authenticate.mockResolvedValue(null);

    await request(app.getHttpServer())
      .patch('/api/auth/preferences')
      .send({ appearanceMode: 'DARK' })
      .expect(401);

    expect(auth.updateAppearanceMode).not.toHaveBeenCalled();
  });
});
