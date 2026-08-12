import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import { CurrentUserResponse, ProviderProfile } from './auth.types';
import { AuthAccount, AuthProvider } from './entities/auth-account.entity';
import { AuthSession } from './entities/auth-session.entity';
import { OAuthLoginAttempt } from './entities/oauth-login-attempt.entity';
import { FacebookAuthProvider } from './providers/facebook-auth.provider';
import { GoogleAuthProvider } from './providers/google-auth.provider';

export interface StartedOAuthLogin {
  authorizationUrl: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthAccount)
    private readonly accounts: Repository<AuthAccount>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    @InjectRepository(OAuthLoginAttempt)
    private readonly attempts: Repository<OAuthLoginAttempt>,
    private readonly google: GoogleAuthProvider,
    private readonly facebook: FacebookAuthProvider,
    private readonly config: ConfigService,
  ) {}

  async startLogin(
    provider: AuthProvider,
    requestedReturnPath?: string,
  ): Promise<StartedOAuthLogin> {
    await this.attempts.delete({ expiresAt: LessThan(new Date()) });
    const state = this.randomToken(32);
    const codeVerifier = this.randomToken(64);
    const challenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const attempt = this.attempts.create({
      stateHash: this.hash(state),
      provider,
      codeVerifier,
      returnPath: this.safeReturnPath(requestedReturnPath),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
    });
    await this.attempts.save(attempt);

    return {
      authorizationUrl:
        provider === AuthProvider.GOOGLE
          ? this.google.getAuthorizationUrl(state, challenge)
          : this.facebook.getAuthorizationUrl(state, challenge),
    };
  }

  async completeLogin(
    provider: AuthProvider,
    state: string,
    code: string,
    userAgent?: string,
  ): Promise<{ token: string; returnPath: string }> {
    if (!state || !code) {
      throw new UnauthorizedException(
        'The authorization response is incomplete.',
      );
    }
    const attempt = await this.attempts.findOne({
      where: {
        stateHash: this.hash(state),
        provider,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!attempt) {
      throw new UnauthorizedException(
        'The sign-in request is invalid or expired.',
      );
    }

    attempt.usedAt = new Date();
    await this.attempts.save(attempt);
    const profile =
      provider === AuthProvider.GOOGLE
        ? await this.google.exchangeCode(code, attempt.codeVerifier)
        : await this.facebook.exchangeCode(code, attempt.codeVerifier);
    const user = await this.findOrCreateUser(profile);
    const token = await this.createSession(user.id, userAgent);
    return { token, returnPath: attempt.returnPath };
  }

  async authenticate(rawToken?: string): Promise<User | null> {
    if (!rawToken) return null;
    const session = await this.sessions.findOne({
      where: {
        tokenHash: this.hash(rawToken),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      relations: { user: true },
    });
    if (!session || session.user.status !== UserStatus.ACTIVE) return null;

    if (Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
      session.lastUsedAt = new Date();
      await this.sessions.save(session);
    }
    return session.user;
  }

  async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { authAccounts: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
      providers: user.authAccounts.map((account) => account.provider),
    };
  }

  async revokeSession(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.sessions.update(
      { tokenHash: this.hash(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  get cookieName(): string {
    return (
      this.config.get<string>('SESSION_COOKIE_NAME')?.trim() ||
      (this.isProduction ? '__Host-kantatube_session' : 'kantatube_session')
    );
  }

  get cookieMaxAgeMs(): number {
    const seconds = Number(this.config.get<string>('SESSION_TTL_SECONDS'));
    return (
      (Number.isFinite(seconds) && seconds > 0 ? seconds : 30 * 24 * 60 * 60) *
      1000
    );
  }

  get cookieSecure(): boolean {
    const configured = this.config.get<string>('SESSION_COOKIE_SECURE');
    return (
      this.cookieSameSite === 'none' ||
      (configured == null ? this.isProduction : configured === 'true')
    );
  }

  get cookieSameSite(): 'lax' | 'strict' | 'none' {
    const value = this.config
      .get<string>('SESSION_COOKIE_SAME_SITE')
      ?.toLowerCase();
    return value === 'strict' || value === 'none' ? value : 'lax';
  }

  get frontendUrl(): string {
    return (
      this.config.get<string>('APP_FRONTEND_URL') || 'http://localhost:4200'
    ).replace(/\/$/, '');
  }

  private async findOrCreateUser(profile: ProviderProfile): Promise<User> {
    let account = await this.accounts.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
      relations: { user: true },
    });
    if (account) {
      if (account.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('This account is disabled.');
      }
      account.providerEmail = profile.email;
      account.providerDisplayName = profile.displayName;
      account.providerAvatarUrl = profile.avatarUrl;
      account.user.displayName = profile.displayName;
      account.user.avatarUrl = profile.avatarUrl;
      account.user.lastLoginAt = new Date();
      if (profile.emailVerified) {
        account.user.email = profile.email;
        account.user.emailVerified = true;
      }
      await this.users.save(account.user);
      await this.accounts.save(account);
      return account.user;
    }

    const user = await this.users.save(
      this.users.create({
        displayName: profile.displayName,
        email: profile.email,
        emailVerified: profile.emailVerified,
        avatarUrl: profile.avatarUrl,
        status: UserStatus.ACTIVE,
        lastLoginAt: new Date(),
      }),
    );
    try {
      account = await this.accounts.save(
        this.accounts.create({
          userId: user.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerDisplayName: profile.displayName,
          providerAvatarUrl: profile.avatarUrl,
        }),
      );
      return user;
    } catch {
      await this.users.delete(user.id);
      const existing = await this.accounts.findOne({
        where: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
        relations: { user: true },
      });
      if (existing) return existing.user;
      throw new ConflictException('This provider account is already in use.');
    }
  }

  private async createSession(
    userId: string,
    userAgent?: string,
  ): Promise<string> {
    await this.sessions.delete({ expiresAt: LessThan(new Date()) });
    const token = this.randomToken(48);
    const now = new Date();
    await this.sessions.save(
      this.sessions.create({
        tokenHash: this.hash(token),
        userId,
        expiresAt: new Date(now.getTime() + this.cookieMaxAgeMs),
        lastUsedAt: now,
        revokedAt: null,
        userAgent: userAgent?.slice(0, 500) || null,
      }),
    );
    return token;
  }

  private safeReturnPath(value?: string): string {
    if (!value) return '/';
    try {
      const decoded = decodeURIComponent(value);
      if (
        !decoded.startsWith('/') ||
        decoded.startsWith('//') ||
        decoded.includes('\\')
      )
        return '/';
      const parsed = new URL(decoded, 'https://kantatube.invalid');
      return parsed.origin === 'https://kantatube.invalid'
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 2048)
        : '/';
    } catch {
      return '/';
    }
  }

  private randomToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }
}
