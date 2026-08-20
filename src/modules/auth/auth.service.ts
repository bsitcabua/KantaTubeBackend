import {
  ConflictException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { randomInt, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { promisify } from 'util';
import { User, UserStatus } from '../users/entities/user.entity';
import { CurrentUserResponse, ProviderProfile } from './auth.types';
import { AuthAccount, AuthProvider } from './entities/auth-account.entity';
import { AuthSession } from './entities/auth-session.entity';
import { OAuthLoginAttempt } from './entities/oauth-login-attempt.entity';
import { FacebookAuthProvider } from './providers/facebook-auth.provider';
import { GoogleAuthProvider } from './providers/google-auth.provider';
import { EmailVerificationCode } from './entities/email-verification-code.entity';
import { EmailService } from './email.service';
import { PasswordOtp, PasswordOtpPurpose } from './entities/password-otp.entity';

export interface StartedOAuthLogin {
  authorizationUrl: string;
}

const scrypt = promisify(scryptCallback);

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
    @InjectRepository(PasswordOtp)
    private readonly passwordOtps: Repository<PasswordOtp>,
    private readonly google: GoogleAuthProvider,
    private readonly facebook: FacebookAuthProvider,
    private readonly config: ConfigService,
    @Optional()
    @InjectRepository(EmailVerificationCode)
    private readonly verificationCodes: Repository<EmailVerificationCode> = undefined as unknown as Repository<EmailVerificationCode>,
    @Optional()
    private readonly emailService: EmailService = undefined as unknown as EmailService,
  ) {}

  async register(
    name?: string,
    email?: string,
    password?: string,
  ): Promise<{ email: string; verificationRequired: true }> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!name?.trim() || name.trim().length > 150)
      throw new ConflictException('A valid name is required.');
    this.validatePassword(password);
    const existing = await this.users.findOne({
      where: { email: normalizedEmail },
      withDeleted: true,
    });
    if (existing?.status === UserStatus.DELETED || existing?.deletedAt)
      throw new ConflictException('This account has been deleted.');
    if (existing?.emailVerified)
      throw new ConflictException('An account with this email already exists.');

    const passwordHash = await this.hashPassword(password!);
    const user =
      existing ||
      this.users.create({
        displayName: name.trim(),
        email: normalizedEmail,
        emailVerified: false,
        passwordHash,
        status: UserStatus.ACTIVE,
        avatarUrl: null,
        lastLoginAt: null,
      });
    user.displayName = name.trim();
    user.passwordHash = passwordHash;
    user.emailVerified = false;
    await this.users.save(user);
    await this.issueVerificationCode(normalizedEmail);
    return { email: normalizedEmail, verificationRequired: true };
  }

  async resendVerification(email?: string): Promise<{ sent: true }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.users.findOne({
      where: { email: normalizedEmail },
      withDeleted: true,
    });
    if (user?.status === UserStatus.DELETED || user?.deletedAt)
      throw new UnauthorizedException('This account has been deleted.');
    if (user && !user.emailVerified)
      await this.issueVerificationCode(normalizedEmail);
    return { sent: true };
  }

  async verifyEmail(
    email?: string,
    code?: string,
    userAgent?: string,
  ): Promise<{ token: string; userId: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!/^\d{6}$/.test(code || ''))
      throw new UnauthorizedException('Invalid verification code.');
    const record = await this.verificationCodes.findOne({
      where: {
        email: normalizedEmail,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
    if (!record || record.attempts >= 5)
      throw new UnauthorizedException('Invalid or expired verification code.');
    record.attempts += 1;
    const valid = timingSafeEqual(
      Buffer.from(record.codeHash),
      Buffer.from(this.hash(code!)),
    );
    if (!valid) {
      await this.verificationCodes.save(record);
      throw new UnauthorizedException('Invalid or expired verification code.');
    }
    record.usedAt = new Date();
    await this.verificationCodes.save(record);
    const user = await this.users.findOne({
      where: { email: normalizedEmail },
    });
    if (!user) throw new UnauthorizedException('Invalid verification code.');
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return {
      token: await this.createSession(user.id, userAgent),
      userId: user.id,
    };
  }

  async emailLogin(
    email?: string,
    password?: string,
    userAgent?: string,
  ): Promise<{ token: string; userId: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.users.findOne({
      where: { email: normalizedEmail },
    });
    if (
      !user?.passwordHash ||
      !(await this.verifyPassword(password || '', user.passwordHash))
    )
      throw new UnauthorizedException('Invalid email or password.');
    if (!user.emailVerified)
      throw new UnauthorizedException(
        'Please verify your email before signing in.',
      );
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('This account is disabled.');
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return {
      token: await this.createSession(user.id, userAgent),
      userId: user.id,
    };
  }

  async requestPasswordReset(email?: string): Promise<{ sent: true }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.users.findOne({ where: { email: normalizedEmail } });
    if (user?.passwordHash && user.emailVerified && user.status === UserStatus.ACTIVE) {
      try { await this.issuePasswordOtp(user, PasswordOtpPurpose.RESET); } catch { /* Keep reset requests neutral. */ }
    }
    return { sent: true };
  }

  async requestPasswordChange(userId: string): Promise<{ sent: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.email || !user.passwordHash || !user.emailVerified)
      throw new ConflictException('Password changes are not available for this account.');
    await this.issuePasswordOtp(user, PasswordOtpPurpose.CHANGE);
    return { sent: true };
  }

  async verifyPasswordResetOtp(email?: string, code?: string): Promise<{ resetToken: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.verifyPasswordOtp(normalizedEmail, code, PasswordOtpPurpose.RESET);
  }

  async verifyPasswordChangeOtp(userId: string, code?: string): Promise<{ resetToken: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.email) throw new UnauthorizedException('Password changes are not available for this account.');
    return this.verifyPasswordOtp(user.email, code, PasswordOtpPurpose.CHANGE, userId);
  }

  async resetPassword(resetToken: string | undefined, password?: string): Promise<{ success: true }> {
    return this.completePasswordChange(resetToken, password, PasswordOtpPurpose.RESET);
  }

  async changePassword(userId: string, resetToken: string | undefined, password?: string): Promise<{ success: true }> {
    return this.completePasswordChange(resetToken, password, PasswordOtpPurpose.CHANGE, userId);
  }

  async requestAccountDeletion(userId: string): Promise<{ sent: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.email || !user.emailVerified || user.status !== UserStatus.ACTIVE)
      throw new ConflictException('Account deletion is not available for this account.');
    await this.issuePasswordOtp(user, PasswordOtpPurpose.ACCOUNT_DELETION);
    return { sent: true };
  }

  async verifyAccountDeletionOtp(userId: string, code?: string): Promise<{ deletionToken: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.email || user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Account deletion is not available for this account.');
    const result = await this.verifyPasswordOtp(user.email, code, PasswordOtpPurpose.ACCOUNT_DELETION, userId);
    return { deletionToken: result.resetToken };
  }

  async deleteAccount(userId: string, deletionToken?: string): Promise<{ success: true }> {
    if (!deletionToken) throw new UnauthorizedException('Account deletion verification is required.');
    const record = await this.passwordOtps.findOne({
      where: {
        userId,
        purpose: PasswordOtpPurpose.ACCOUNT_DELETION,
        verificationTokenHash: this.hash(deletionToken),
      },
    });
    if (!record?.usedAt || !record.verificationTokenExpiresAt || record.verificationTokenExpiresAt <= new Date())
      throw new UnauthorizedException('Account deletion verification has expired.');

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('This account is no longer active.');

    const deletedAt = new Date();
    await this.users.manager.transaction(async (manager) => {
      await this.revokeUserSessions(manager.getRepository(AuthSession), userId, deletedAt);
      await manager.getRepository(PasswordOtp).delete({ userId });
      await manager.getRepository(User).update(userId, { status: UserStatus.DELETED });
      await manager.getRepository(User).softDelete(userId);
    });
    return { success: true };
  }

  private async issuePasswordOtp(user: User, purpose: PasswordOtpPurpose): Promise<void> {
    const recent = await this.passwordOtps.findOne({
      where: { userId: user.id, purpose },
      order: { createdAt: 'DESC' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < 45_000)
      throw new ConflictException('Please wait before requesting another code.');
    await this.passwordOtps.delete({ userId: user.id, purpose });
    const code = randomInt(100000, 1000000).toString();
    await this.passwordOtps.save(this.passwordOtps.create({
      userId: user.id,
      email: user.email!,
      purpose,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
      attempts: 0,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
    }));
    const subject = purpose === PasswordOtpPurpose.RESET
      ? 'Reset your KantaTube password'
      : purpose === PasswordOtpPurpose.CHANGE
        ? 'Verify your KantaTube password change'
        : 'Verify your KantaTube account deletion';
    await this.emailService.sendVerificationCode(user.email!, code, subject);
  }

  private async verifyPasswordOtp(email: string, code: string | undefined, purpose: PasswordOtpPurpose, userId?: string): Promise<{ resetToken: string }> {
    if (!/^\d{6}$/.test(code || '')) throw new UnauthorizedException('The verification code is incorrect.');
    const record = await this.passwordOtps.findOne({
      where: userId ? { userId, purpose, usedAt: IsNull() } : { email, purpose, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!record || record.expiresAt <= new Date()) throw new UnauthorizedException('This verification code has expired. Please request a new code.');
    if (record.attempts >= 5) throw new UnauthorizedException('Too many verification attempts. Please request a new code.');
    record.attempts += 1;
    const valid = timingSafeEqual(Buffer.from(record.codeHash), Buffer.from(this.hash(code!)));
    if (!valid) { await this.passwordOtps.save(record); throw new UnauthorizedException('The verification code is incorrect.'); }
    const token = this.randomToken(32);
    record.usedAt = new Date();
    record.verificationTokenHash = this.hash(token);
    record.verificationTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.passwordOtps.save(record);
    return { resetToken: token };
  }

  private async completePasswordChange(token: string | undefined, password: string | undefined, purpose: PasswordOtpPurpose, userId?: string): Promise<{ success: true }> {
    this.validatePassword(password);
    if (!token) throw new UnauthorizedException('Password verification is required.');
    const record = await this.passwordOtps.findOne({ where: { verificationTokenHash: this.hash(token), purpose } });
    if (!record || !record.verificationTokenExpiresAt || record.verificationTokenExpiresAt <= new Date() || (userId && record.userId !== userId))
      throw new UnauthorizedException('Password verification has expired.');
    const user = await this.users.findOne({ where: { id: record.userId! } });
    if (!user) throw new UnauthorizedException();
    if (user.passwordHash && await this.verifyPassword(password!, user.passwordHash))
      throw new ConflictException('Your new password cannot be the same as your current password.');
    user.passwordHash = await this.hashPassword(password!);
    await this.users.save(user);
    await this.passwordOtps.delete(record.id);
    return { success: true };
  }

  private async issueVerificationCode(email: string): Promise<void> {
    await this.verificationCodes.delete({ email });
    const code = randomInt(100000, 1000000).toString();
    await this.verificationCodes.save(
      this.verificationCodes.create({
        email,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        attempts: 0,
      }),
    );
    await this.emailService.sendVerificationCode(email, code);
  }

  private normalizeEmail(email?: string): string {
    const normalized = email?.trim().toLowerCase() || '';
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
      normalized.length > 254
    )
      throw new ConflictException('A valid email is required.');
    return normalized;
  }

  private validatePassword(password?: string): void {
    if (!password || password.length < 8 || password.length > 128)
      throw new ConflictException('Password must be 8 to 128 characters.');
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  private async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    const [salt, expected] = stored.split(':');
    if (!salt || !expected) return false;
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      expectedBuffer.length === derived.length &&
      timingSafeEqual(expectedBuffer, derived)
    );
  }

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
    if (!session?.user || session.user.status !== UserStatus.ACTIVE || session.user.deletedAt) return null;

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
      avatarUrl: user.avatarUrl?.trim() || null,
      providers: user.authAccounts.map((account) => account.provider),
      phoneNumber: user.phoneNumber,
      addressLine: user.addressLine,
      city: user.city,
      province: user.province,
      postalCode: user.postalCode,
      country: user.country,
    };
  }

  async updateProfile(userId: string, input: { fullName?: string; phoneNumber?: string; addressLine?: string; city?: string; province?: string; postalCode?: string; country?: string }): Promise<CurrentUserResponse> {
    const user = await this.users.findOne({ where: { id: userId }, relations: { authAccounts: true } });
    if (!user) throw new UnauthorizedException();
    const fullName = input.fullName?.trim() || '';
    if (!fullName || fullName.length > 150) throw new ConflictException('Full name is required and must be 150 characters or fewer.');
    const phone = input.phoneNumber?.trim() || '';
    if (phone && !/^\+?[0-9][0-9 .()-]{6,28}$/.test(phone)) throw new ConflictException('Enter a valid phone number.');
    user.displayName = fullName;
    user.phoneNumber = phone || null;
    user.addressLine = input.addressLine?.trim().slice(0, 255) || null;
    user.city = input.city?.trim().slice(0, 150) || null;
    user.province = input.province?.trim().slice(0, 150) || null;
    user.postalCode = input.postalCode?.trim().slice(0, 30) || null;
    user.country = input.country?.trim().slice(0, 100) || null;
    await this.users.save(user);
    return this.getCurrentUser(user.id);
  }

  async revokeSession(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.sessions.update(
      { tokenHash: this.hash(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.revokeUserSessions(this.sessions, userId, new Date());
  }

  private async revokeUserSessions(
    repository: Pick<Repository<AuthSession>, 'update'>,
    userId: string,
    revokedAt: Date,
  ): Promise<void> {
    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt },
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
      const accountUser = account.user || await this.users.findOne({ where: { id: account.userId }, withDeleted: true });
      if (!accountUser || accountUser.status === UserStatus.DELETED || accountUser.deletedAt) {
        throw new UnauthorizedException('This account has been deleted.');
      }
      account.user = accountUser;
      if (account.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('This account is disabled.');
      }
      account.providerEmail = profile.email;
      account.providerDisplayName = profile.displayName;
      const previousProviderAvatar = account.providerAvatarUrl;
      account.providerAvatarUrl = profile.avatarUrl || previousProviderAvatar;
      account.user.displayName = profile.displayName;
      if (profile.avatarUrl) account.user.avatarUrl = profile.avatarUrl;
      else if (!account.user.avatarUrl && previousProviderAvatar)
        account.user.avatarUrl = previousProviderAvatar;
      account.user.lastLoginAt = new Date();
      if (profile.emailVerified) {
        account.user.email = profile.email;
        account.user.emailVerified = true;
      }
      await this.users.save(account.user);
      await this.accounts.save(account);
      return account.user;
    }

    if (profile.email && profile.emailVerified) {
      const matchingUser = await this.users.findOne({
        where: { email: profile.email.toLowerCase() },
        relations: { authAccounts: true },
        withDeleted: true,
      });
      if (matchingUser) {
        if (matchingUser.status === UserStatus.DELETED || matchingUser.deletedAt) {
          throw new UnauthorizedException('This account has been deleted.');
        }
        if (matchingUser.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('This account is disabled.');
        }
        const linkedAccount = this.accounts.create({
          userId: matchingUser.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerDisplayName: profile.displayName,
          providerAvatarUrl: profile.avatarUrl,
        });
        await this.accounts.save(linkedAccount);
        matchingUser.lastLoginAt = new Date();
        if (!matchingUser.avatarUrl) {
          matchingUser.avatarUrl =
            profile.avatarUrl ||
            matchingUser.authAccounts?.find(
              (linked) => linked.providerAvatarUrl,
            )?.providerAvatarUrl ||
            null;
        }
        await this.users.save(matchingUser);
        return matchingUser;
      }
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
      if (existing) {
        const existingUser = existing.user || await this.users.findOne({ where: { id: existing.userId }, withDeleted: true });
        if (!existingUser || existingUser.status === UserStatus.DELETED || existingUser.deletedAt)
          throw new UnauthorizedException('This account has been deleted.');
        return existingUser;
      }
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
