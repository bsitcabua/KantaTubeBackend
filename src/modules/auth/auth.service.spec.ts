import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthProvider } from './entities/auth-account.entity';
import { UserStatus } from '../users/entities/user.entity';
import { PasswordOtpPurpose } from './entities/password-otp.entity';

describe('AuthService', () => {
  const profile = {
    provider: AuthProvider.GOOGLE,
    providerUserId: 'google-123',
    email: 'singer@example.com',
    emailVerified: true,
    displayName: 'Kanta Singer',
    avatarUrl: null,
  };

  function setup(
    options: { existingAccount?: any; attempt?: any; session?: any } = {},
  ) {
    const users = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id || 'user-1', ...value })),
      delete: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findOne: jest.fn(),
      manager: undefined as any,
    };
    const accounts = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'account-1', ...value })),
      findOne: jest.fn(async () => options.existingAccount || null),
    };
    const sessions = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'session-1', ...value })),
      findOne: jest.fn(async () => options.session || null),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const attempts = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'attempt-1', ...value })),
      findOne: jest.fn(async () => options.attempt || null),
      delete: jest.fn(),
    };
    const passwordOtps = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity.name === 'AuthSession') return sessions;
        if (entity.name === 'PasswordOtp') return passwordOtps;
        return users;
      }),
      transaction: jest.fn(async (work: (transactionManager: any) => Promise<void>) => work(manager)),
    };
    users.manager = manager;
    const google = {
      getAuthorizationUrl: jest.fn(() => 'https://accounts.google.test/auth'),
      exchangeCode: jest.fn(async () => profile),
    };
    const facebook = {
      getAuthorizationUrl: jest.fn(() => 'https://facebook.test/auth'),
      exchangeCode: jest.fn(),
    };
    const config = new ConfigService({
      APP_FRONTEND_URL: 'http://localhost:4200',
      SESSION_TTL_SECONDS: '3600',
    });
    const service = new AuthService(
      users as any,
      accounts as any,
      sessions as any,
      attempts as any,
      passwordOtps as any,
      google as any,
      facebook as any,
      config,
    );
    return { service, users, accounts, sessions, attempts, passwordOtps, google, facebook };
  }

  it('creates a local user and hashed session for a new Google identity', async () => {
    const attempt = {
      codeVerifier: 'verifier',
      returnPath: '/?remote=123e4567-e89b-42d3-a456-426614174000',
      usedAt: null,
    };
    const context = setup({ attempt });
    const result = await context.service.completeLogin(
      AuthProvider.GOOGLE,
      'state',
      'code',
      'test browser',
    );

    expect(result.returnPath).toBe(attempt.returnPath);
    expect(context.users.save).toHaveBeenCalled();
    expect(context.accounts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUserId: 'google-123',
        userId: 'user-1',
      }),
    );
    expect(context.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result.token).not.toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it('reuses the user attached to a returning provider account', async () => {
    const user = {
      id: 'existing-user',
      status: UserStatus.ACTIVE,
      displayName: 'Old Name',
      email: null,
      emailVerified: false,
      avatarUrl: null,
      lastLoginAt: null,
    };
    const context = setup({
      attempt: { codeVerifier: 'verifier', returnPath: '/', usedAt: null },
      existingAccount: { user, provider: AuthProvider.GOOGLE },
    });
    await context.service.completeLogin(AuthProvider.GOOGLE, 'state', 'code');
    expect(context.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'existing-user' }),
    );
    expect(context.accounts.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid, expired, or already-used OAuth state', async () => {
    const context = setup();
    await expect(
      context.service.completeLogin(AuthProvider.GOOGLE, 'bad-state', 'code'),
    ).rejects.toThrow('invalid or expired');
  });

  it('normalizes unsafe return URLs to the application root', async () => {
    const context = setup();
    await context.service.startLogin(
      AuthProvider.GOOGLE,
      '//evil.example/path',
    );
    expect(context.attempts.save).toHaveBeenCalledWith(
      expect.objectContaining({ returnPath: '/' }),
    );
  });

  it('returns no user for expired or revoked sessions', async () => {
    const context = setup({ session: null });
    await expect(
      context.service.authenticate('expired-token'),
    ).resolves.toBeNull();
  });

  it('rejects reusing the current password during a password reset', async () => {
    const context = setup();
    const currentPassword = 'StrongPassword123!';
    const passwordHash = await (context.service as any).hashPassword(currentPassword);
    context.passwordOtps.findOne.mockResolvedValue({
      id: 'otp-1',
      userId: 'user-1',
      verificationTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    context.users.findOne.mockResolvedValue({ id: 'user-1', passwordHash });

    await expect(context.service.resetPassword('valid-token', currentPassword))
      .rejects.toThrow('Your new password cannot be the same as your current password.');
    expect(context.users.save).not.toHaveBeenCalled();
  });

  it('keeps account-deletion OTPs isolated from other OTP purposes', async () => {
    const context = setup();
    context.users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'singer@example.com',
      status: UserStatus.ACTIVE,
    });
    context.passwordOtps.findOne.mockResolvedValue(null);

    await expect(context.service.verifyAccountDeletionOtp('user-1', '123456'))
      .rejects.toThrow('verification code');
    expect(context.passwordOtps.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purpose: PasswordOtpPurpose.ACCOUNT_DELETION }),
    }));
  });

  it('soft deletes an OTP-authorized account and revokes every session', async () => {
    const context = setup();
    context.passwordOtps.findOne.mockResolvedValue({
      id: 'otp-1',
      userId: 'user-1',
      usedAt: new Date(),
      verificationTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    context.users.findOne.mockResolvedValue({ id: 'user-1', status: UserStatus.ACTIVE });

    await expect(context.service.deleteAccount('user-1', 'deletion-token'))
      .resolves.toEqual({ success: true });
    expect(context.sessions.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
    expect(context.users.update).toHaveBeenCalledWith('user-1', { status: UserStatus.DELETED });
    expect(context.users.softDelete).toHaveBeenCalledWith('user-1');
    expect(context.passwordOtps.delete).toHaveBeenCalledWith({ userId: 'user-1' });
  });
});
