import {
  ConflictException,
  Injectable,
  Logger,
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
import { AccountRecoveryReference } from './entities/account-recovery-reference.entity';

export interface StartedOAuthLogin {
  authorizationUrl: string;
}

const scrypt = promisify(scryptCallback);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly recoveryRequestsByIp = new Map<string, number[]>();

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
    @Optional()
    @InjectRepository(AccountRecoveryReference)
    private readonly recoveryReferences: Repository<AccountRecoveryReference> = undefined as unknown as Repository<AccountRecoveryReference>,
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
    if (
      existing?.status === UserStatus.DELETED ||
      existing?.deletedAt ||
      existing?.emailVerified
    )
      throw this.emailAlreadyRegisteredConflict();

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
    try {
      await this.users.save(user);
    } catch (error) {
      if (this.isDuplicateEntryError(error))
        throw this.emailAlreadyRegisteredConflict();
      throw error;
    }
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
      withDeleted: true,
    });
    if (
      !user?.passwordHash ||
      !(await this.verifyPassword(password || '', user.passwordHash))
    )
      throw new UnauthorizedException('Invalid email or password.');
    if (user.status === UserStatus.DELETED || user.deletedAt)
      await this.throwDeletedAccountState(user);
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
    const scheduledDeletionAt = new Date(
      deletedAt.getTime() + this.recoveryPeriodDays * 24 * 60 * 60 * 1000,
    );
    await this.users.manager.transaction(async (manager) => {
      await this.revokeUserSessions(manager.getRepository(AuthSession), userId, deletedAt);
      await manager.getRepository(PasswordOtp).delete({ userId });
      await manager.getRepository(User).update(userId, {
        status: UserStatus.DELETED,
        scheduledDeletionAt,
      });
      await manager.getRepository(User).softDelete(userId);
      await manager.getRepository(User).update(userId, { deletedAt });
    });
    if (user.email) {
      try {
        await this.emailService.sendAccountDeletionConfirmation(
          user.email,
          deletedAt,
          scheduledDeletionAt,
        );
      } catch (error) {
        this.logger.error(
          'Account deletion confirmation email could not be sent.',
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return { success: true };
  }

  async requestAccountRecovery(
    input: { email?: string; recoveryReference?: string },
    ipAddress?: string,
  ): Promise<{ sent: true }> {
    const email = input.email ? this.normalizeEmail(input.email) : undefined;
    if (!email && !input.recoveryReference?.trim()) {
      throw new ConflictException('A valid email or recovery reference is required.');
    }
    if (!this.allowRecoveryRequestFromIp(ipAddress)) {
      this.auditRecovery('recovery_limited', undefined, 'ip_hourly_limit');
      return { sent: true };
    }

    const user = email
      ? await this.users.findOne({ where: { email }, withDeleted: true })
      : await this.userForRecoveryReference(input.recoveryReference!);
    if (!user || !this.isAccountRecoverable(user)) return { sent: true };

    try {
      await this.issueAccountRecoveryOtp(user);
      this.auditRecovery('recovery_requested', user.id);
    } catch (error) {
      this.auditRecovery(
        'recovery_not_sent',
        user.id,
        error instanceof Error ? error.name : 'unknown_error',
      );
    }
    return { sent: true };
  }

  async verifyAccountRecoveryOtp(
    email: string | undefined,
    recoveryReference: string | undefined,
    code?: string,
  ): Promise<{ recoveryToken: string }> {
    const normalizedEmail = email ? this.normalizeEmail(email) : undefined;
    const user = normalizedEmail
      ? await this.users.findOne({ where: { email: normalizedEmail }, withDeleted: true })
      : recoveryReference
        ? await this.userForRecoveryReference(recoveryReference)
        : null;
    if (!user || !this.isAccountRecoverable(user) || !/^\d{6}$/.test(code || '')) {
      this.auditRecovery('recovery_verification_failed', user?.id, 'invalid_or_expired');
      throw new UnauthorizedException('The recovery code is invalid or expired.');
    }
    const recoveryToken = await this.users.manager.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const lockedUser = await userRepository.findOne({
        where: { id: user.id },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser || !this.isAccountRecoverable(lockedUser)) {
        this.auditRecovery('recovery_verification_failed', lockedUser?.id, 'window_expired');
        throw new UnauthorizedException('The recovery code is invalid or expired.');
      }

      const otpRepository = manager.getRepository(PasswordOtp);
      const record = await otpRepository.findOne({
        where: {
          userId: lockedUser.id,
          purpose: PasswordOtpPurpose.ACCOUNT_RECOVERY,
          usedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record || record.expiresAt <= new Date()) {
        this.auditRecovery('recovery_verification_failed', lockedUser.id, 'otp_expired');
        throw new UnauthorizedException('The recovery code is invalid or expired.');
      }
      if (record.attempts >= this.recoveryOtpMaxAttempts) {
        this.auditRecovery('recovery_limited', lockedUser.id, 'otp_attempt_limit');
        throw new UnauthorizedException('Too many verification attempts. Please request a new code.');
      }

      record.attempts += 1;
      const valid = timingSafeEqual(
        Buffer.from(record.codeHash),
        Buffer.from(this.hash(code!)),
      );
      if (!valid) {
        await otpRepository.save(record);
        return null;
      }
      const token = this.randomToken(32);
      record.usedAt = new Date();
      record.verificationTokenHash = this.hash(token);
      record.verificationTokenExpiresAt = new Date(
        Date.now() + this.recoveryTokenLifetimeMinutes * 60_000,
      );
      await otpRepository.save(record);
      return token;
    });
    if (!recoveryToken)
      this.auditRecovery('recovery_verification_failed', user.id, 'incorrect_code');
    if (!recoveryToken)
      throw new UnauthorizedException('The recovery code is invalid or expired.');
    return { recoveryToken };
  }

  async completeAccountRecovery(
    recoveryToken?: string,
    userAgent?: string,
  ): Promise<{ token: string; userId: string }> {
    if (!recoveryToken)
      throw new UnauthorizedException('Account recovery verification is required.');
    const tokenHash = this.hash(recoveryToken);
    return this.users.manager.transaction(async (manager) => {
      const otpRepository = manager.getRepository(PasswordOtp);
      const record = await otpRepository.findOne({
        where: {
          purpose: PasswordOtpPurpose.ACCOUNT_RECOVERY,
          verificationTokenHash: tokenHash,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !record?.usedAt ||
        !record.userId ||
        !record.verificationTokenExpiresAt ||
        record.verificationTokenExpiresAt <= new Date()
      ) {
        this.auditRecovery('recovery_completion_failed', record?.userId || undefined, 'token_expired');
        throw new UnauthorizedException('Account recovery verification has expired.');
      }

      const userRepository = manager.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: record.userId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || !this.isAccountRecoverable(user)) {
        this.auditRecovery('recovery_completion_failed', user?.id, 'account_not_recoverable');
        throw new UnauthorizedException('This account can no longer be recovered.');
      }

      await userRepository.restore(user.id);
      await userRepository.update(user.id, {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        scheduledDeletionAt: null,
        lastLoginAt: new Date(),
      });
      await otpRepository.delete({
        userId: user.id,
        purpose: PasswordOtpPurpose.ACCOUNT_RECOVERY,
      });
      if (this.recoveryReferences) {
        await manager.getRepository(AccountRecoveryReference).delete({
          userId: user.id,
        });
      }
      const token = await this.createSessionWithRepository(
        manager.getRepository(AuthSession),
        user.id,
        userAgent,
      );
      this.auditRecovery('recovery_completed', user.id);
      return { token, userId: user.id };
    });
  }

  isAccountRecoverable(user: User): boolean {
    return (
      user.status === UserStatus.DELETED &&
      !!user.deletedAt &&
      !!user.scheduledDeletionAt &&
      user.scheduledDeletionAt > new Date() &&
      !!user.email &&
      user.emailVerified
    );
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

  private async issueAccountRecoveryOtp(user: User): Promise<void> {
    const purpose = PasswordOtpPurpose.ACCOUNT_RECOVERY;
    const now = new Date();
    const code = randomInt(100000, 1000000).toString();
    const record = await this.users.manager.transaction(async (manager) => {
      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: user.id },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser || !this.isAccountRecoverable(lockedUser))
        throw new UnauthorizedException('This account can no longer be recovered.');
      const otpRepository = manager.getRepository(PasswordOtp);
      const recent = await otpRepository.findOne({
        where: { userId: user.id, purpose },
        order: { createdAt: 'DESC' },
      });
      if (
        recent &&
        now.getTime() - recent.createdAt.getTime() < this.recoveryResendCooldownSeconds * 1000
      ) {
        throw new ConflictException('Please wait before requesting another code.');
      }
      const sentToday = await otpRepository.count({
        where: {
          userId: user.id,
          purpose,
          createdAt: MoreThan(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        },
      });
      if (sentToday >= this.recoveryEmailsPerDay)
        throw new ConflictException('Recovery email limit reached.');
      return otpRepository.save(otpRepository.create({
        userId: user.id,
        email: user.email!,
        purpose,
        codeHash: this.hash(code),
        expiresAt: new Date(now.getTime() + this.recoveryOtpLifetimeMinutes * 60_000),
        usedAt: null,
        attempts: 0,
        verificationTokenHash: null,
        verificationTokenExpiresAt: null,
      }));
    });
    try {
      await this.emailService.sendAccountRecoveryCode(user.email!, code);
    } catch (error) {
      await this.passwordOtps.delete(record.id);
      throw error;
    }
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

  private emailAlreadyRegisteredConflict(): ConflictException {
    return new ConflictException({
      code: 'email_already_registered',
      message: 'An account with this email already exists.',
    });
  }

  private isDuplicateEntryError(error: unknown): boolean {
    const details = error as { code?: string; errno?: number } | undefined;
    return details?.code === 'ER_DUP_ENTRY' || details?.errno === 1062;
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
      if (!accountUser)
        throw new UnauthorizedException('This account has been deleted.');
      if (accountUser.status === UserStatus.DELETED || accountUser.deletedAt)
        await this.throwDeletedAccountState(accountUser, true);
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
          await this.throwDeletedAccountState(matchingUser, true);
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
        if (!existingUser)
          throw new UnauthorizedException('This account has been deleted.');
        if (existingUser.status === UserStatus.DELETED || existingUser.deletedAt)
          await this.throwDeletedAccountState(existingUser, true);
        return existingUser;
      }
      throw new ConflictException('This provider account is already in use.');
    }
  }

  private async createSession(
    userId: string,
    userAgent?: string,
  ): Promise<string> {
    return this.createSessionWithRepository(this.sessions, userId, userAgent);
  }

  private async createSessionWithRepository(
    repository: Repository<AuthSession>,
    userId: string,
    userAgent?: string,
  ): Promise<string> {
    await repository.delete({ expiresAt: LessThan(new Date()) });
    const token = this.randomToken(48);
    const now = new Date();
    await repository.save(
      repository.create({
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

  private async throwDeletedAccountState(
    user: User,
    includeRecoveryReference = false,
  ): Promise<never> {
    if (!this.isAccountRecoverable(user)) {
      throw new UnauthorizedException({
        code: 'account_deleted_expired',
        message: 'This account was deleted and can no longer be recovered.',
      });
    }
    const recoveryReference = includeRecoveryReference
      ? await this.createRecoveryReference(user.id)
      : undefined;
    throw new UnauthorizedException({
      code: 'account_recoverable',
      message: 'This account was deleted but can still be recovered.',
      recoverableUntil: user.scheduledDeletionAt!.toISOString(),
      ...(recoveryReference ? { recoveryReference } : {}),
    });
  }

  private async createRecoveryReference(userId: string): Promise<string | undefined> {
    if (!this.recoveryReferences) return undefined;
    await this.recoveryReferences.delete({ expiresAt: LessThan(new Date()) });
    const reference = this.randomToken(32);
    await this.recoveryReferences.save(
      this.recoveryReferences.create({
        referenceHash: this.hash(reference),
        userId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        usedAt: null,
      }),
    );
    return reference;
  }

  private async userForRecoveryReference(reference: string): Promise<User | null> {
    if (!this.recoveryReferences || !reference?.trim()) return null;
    const record = await this.recoveryReferences.findOne({
      where: {
        referenceHash: this.hash(reference),
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!record) return null;
    return this.users.findOne({ where: { id: record.userId }, withDeleted: true });
  }

  private allowRecoveryRequestFromIp(ipAddress?: string): boolean {
    const key = ipAddress?.trim() || 'unknown';
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const recent = (this.recoveryRequestsByIp.get(key) || []).filter(
      (timestamp) => timestamp > windowStart,
    );
    if (recent.length >= this.recoveryRequestsPerIpHour) {
      this.recoveryRequestsByIp.set(key, recent);
      return false;
    }
    recent.push(now);
    this.recoveryRequestsByIp.set(key, recent);
    return true;
  }

  private configuredPositiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private auditRecovery(event: string, userId?: string, reason?: string): void {
    const entry = JSON.stringify({ event, ...(userId ? { userId } : {}), ...(reason ? { reason } : {}) });
    if (event === 'recovery_requested' || event === 'recovery_completed')
      this.logger.log(entry);
    else this.logger.warn(entry);
  }

  private get recoveryPeriodDays(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_PERIOD_DAYS', 30);
  }

  private get recoveryOtpLifetimeMinutes(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_OTP_TTL_MINUTES', 10);
  }

  private get recoveryResendCooldownSeconds(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_RESEND_COOLDOWN_SECONDS', 60);
  }

  private get recoveryOtpMaxAttempts(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_OTP_MAX_ATTEMPTS', 5);
  }

  private get recoveryTokenLifetimeMinutes(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_TOKEN_TTL_MINUTES', 10);
  }

  private get recoveryEmailsPerDay(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_EMAILS_PER_DAY', 5);
  }

  private get recoveryRequestsPerIpHour(): number {
    return this.configuredPositiveInteger('ACCOUNT_RECOVERY_REQUESTS_PER_IP_HOUR', 10);
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
