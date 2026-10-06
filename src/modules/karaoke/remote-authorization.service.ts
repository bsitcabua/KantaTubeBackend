import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import {
  KaraokeSession,
  KaraokeSessionStatus,
} from './entities/karaoke-session.entity';
import { KaraokePairingSession } from './entities/karaoke-pairing-session.entity';
import {
  KaraokeRemoteGrant,
  KaraokeRemoteGrantStatus,
} from './entities/karaoke-remote-grant.entity';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';

export type RemoteSessionKind = 'karaoke' | 'guest';

export interface PairingInvitation {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface GuestHostInvitation extends PairingInvitation {
  hostToken: string;
  hostExpiresAt: Date;
}

export interface PendingRemote {
  grant: KaraokeRemoteGrant;
  sessionId: string;
  sessionKind: RemoteSessionKind;
}

export interface ApprovedRemote {
  grant: KaraokeRemoteGrant;
  grantToken: string;
}

@Injectable()
export class RemoteAuthorizationService {
  static readonly defaultPairingTokenSeconds = 10 * 60;
  static readonly defaultGrantHours = 12;

  private readonly logger = new Logger(RemoteAuthorizationService.name);
  private readonly pairingTokenMs: number;
  private readonly grantLifetimeMs: number;
  private readonly sessionInvalidationListeners = new Set<
    (sessionId: string, sessionKind: RemoteSessionKind) => void
  >();

  constructor(
    @InjectRepository(KaraokeSession)
    private readonly sessions: Repository<KaraokeSession>,
    @InjectRepository(KaraokePairingSession)
    private readonly pairingSessions: Repository<KaraokePairingSession>,
    @InjectRepository(KaraokeRemoteGrant)
    private readonly grants: Repository<KaraokeRemoteGrant>,
    @InjectRepository(KaraokeRemoteHostSession)
    private readonly hostSessions: Repository<KaraokeRemoteHostSession>,
    private readonly config: ConfigService,
  ) {
    const pairingSeconds = this.readNumber(
      'REMOTE_PAIRING_TOKEN_SECONDS',
      RemoteAuthorizationService.defaultPairingTokenSeconds,
      60,
      15 * 60,
    );
    const grantHours = this.readNumber(
      'REMOTE_GRANT_LIFETIME_HOURS',
      RemoteAuthorizationService.defaultGrantHours,
      1,
      24 * 7,
    );
    this.pairingTokenMs = pairingSeconds * 1000;
    this.grantLifetimeMs = grantHours * 60 * 60 * 1000;
  }

  async createPairingToken(
    ownerId: string,
    sessionId: string,
  ): Promise<PairingInvitation> {
    const session = await this.findActiveSession(ownerId, sessionId);
    return this.issuePairingToken('karaoke', session.id);
  }

  async createGuestHost(): Promise<GuestHostInvitation> {
    const now = new Date();
    const hostToken = randomBytes(32).toString('base64url');
    const host = await this.hostSessions.save(
      this.hostSessions.create({
        tokenHash: this.hash(hostToken),
        expiresAt: new Date(now.getTime() + this.grantLifetimeMs),
        revokedAt: null,
      }),
    );
    const pairing = await this.issuePairingToken('guest', host.id, now);
    this.logger.log(
      `Anonymous remote host created for session ${this.safeId(host.id)}`,
    );
    return {
      ...pairing,
      hostToken,
      hostExpiresAt: host.expiresAt,
    };
  }

  async createGuestPairingToken(
    sessionId: string,
    hostToken: unknown,
  ): Promise<PairingInvitation> {
    await this.authorizeGuestHost(sessionId, hostToken);
    return this.issuePairingToken('guest', sessionId);
  }

  async authorizeGuestHost(
    sessionId: string,
    hostToken: unknown,
  ): Promise<KaraokeRemoteHostSession> {
    if (typeof hostToken !== 'string' || hostToken.length < 32) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Anonymous karaoke host authorization is invalid.',
      );
    }
    const host = await this.hostSessions.findOne({
      where: { id: sessionId, tokenHash: this.hash(hostToken) },
    });
    if (!host || host.revokedAt || host.expiresAt.getTime() <= Date.now()) {
      throw this.remoteError(
        'SESSION_EXPIRED',
        'This anonymous karaoke session is no longer active.',
      );
    }
    return host;
  }

  async createPendingRemote(
    pairingToken: unknown,
    deviceId: string,
    deviceLabel: string,
  ): Promise<PendingRemote> {
    if (!this.isDeviceId(deviceId)) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device identity is invalid.',
      );
    }
    if (typeof pairingToken !== 'string' || pairingToken.length < 32) {
      throw this.pairingError(
        'PAIR_TOKEN_INVALID',
        'The pairing invitation is invalid.',
      );
    }
    const now = new Date();
    const pairing = await this.pairingSessions.findOne({
      where: {
        tokenHash: this.hash(pairingToken),
        consumedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
    if (!pairing) {
      const expired = await this.pairingSessions.findOne({
        where: { tokenHash: this.hash(pairingToken) },
      });
      throw this.pairingError(
        expired ? 'PAIR_TOKEN_EXPIRED' : 'PAIR_TOKEN_INVALID',
        expired
          ? 'This pairing invitation has expired.'
          : 'The pairing invitation is invalid.',
      );
    }

    const sessionKind: RemoteSessionKind = pairing.remoteHostSessionId
      ? 'guest'
      : 'karaoke';
    const sessionId =
      sessionKind === 'guest'
        ? pairing.remoteHostSessionId
        : pairing.karaokeSessionId;
    if (!sessionId) {
      throw this.pairingError(
        'PAIR_TOKEN_INVALID',
        'The pairing invitation is invalid.',
      );
    }
    await this.assertActiveRemoteSession(sessionId, sessionKind);

    let grant = await this.grants.findOne({
      where: {
        ...this.sessionScope(sessionId, sessionKind),
        deviceId,
        status: KaraokeRemoteGrantStatus.PENDING,
      },
    });
    if (!grant) {
      grant = this.grants.create({
        karaokeSessionId: sessionKind === 'karaoke' ? sessionId : null,
        remoteHostSessionId: sessionKind === 'guest' ? sessionId : null,
        deviceId,
        deviceLabel: deviceLabel.slice(0, 100),
        status: KaraokeRemoteGrantStatus.PENDING,
        grantTokenHash: null,
        expiresAt: new Date(now.getTime() + this.grantLifetimeMs),
        approvedAt: null,
        revokedAt: null,
      });
      grant = await this.grants.save(grant);
    }
    this.logger.log(
      `Remote pairing request ${this.safeId(grant.id)} received for session ${this.safeId(sessionId)}`,
    );
    return { grant, sessionId, sessionKind };
  }

  async approveRemote(
    sessionId: string,
    requestId: string,
    sessionKind: RemoteSessionKind = 'karaoke',
  ): Promise<ApprovedRemote> {
    const grant = await this.grants.findOne({
      where: {
        ...this.sessionScope(sessionId, sessionKind),
        id: requestId,
        status: KaraokeRemoteGrantStatus.PENDING,
      },
    });
    if (!grant)
      throw new NotFoundException('Remote pairing request not found.');
    await this.assertActiveRemoteSession(sessionId, sessionKind);
    const now = new Date();
    const grantToken = randomBytes(32).toString('base64url');
    grant.status = KaraokeRemoteGrantStatus.APPROVED;
    grant.grantTokenHash = this.hash(grantToken);
    grant.approvedAt = now;
    grant.expiresAt = new Date(now.getTime() + this.grantLifetimeMs);
    await this.grants.save(grant);
    this.logger.log(
      `Remote ${this.safeId(grant.id)} approved for session ${this.safeId(sessionId)}`,
    );
    return { grant, grantToken };
  }

  async rejectRemote(
    sessionId: string,
    requestId: string,
    sessionKind: RemoteSessionKind = 'karaoke',
  ): Promise<void> {
    const grant = await this.grants.findOne({
      where: {
        ...this.sessionScope(sessionId, sessionKind),
        id: requestId,
        status: KaraokeRemoteGrantStatus.PENDING,
      },
    });
    if (!grant)
      throw new NotFoundException('Remote pairing request not found.');
    grant.status = KaraokeRemoteGrantStatus.REJECTED;
    await this.grants.save(grant);
    this.logger.log(
      `Remote ${this.safeId(grant.id)} rejected for session ${this.safeId(sessionId)}`,
    );
  }

  async authorizeGrant(
    sessionId: string,
    deviceId: string,
    grantToken: unknown,
  ): Promise<KaraokeRemoteGrant> {
    if (!this.isDeviceId(deviceId)) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device identity is invalid.',
      );
    }
    if (typeof grantToken !== 'string' || grantToken.length < 32) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device is not approved.',
      );
    }
    const now = new Date();
    const tokenHash = this.hash(grantToken);
    const grant = await this.grants.findOne({
      where: [
        {
          karaokeSessionId: sessionId,
          deviceId,
          grantTokenHash: tokenHash,
          status: KaraokeRemoteGrantStatus.APPROVED,
          expiresAt: MoreThan(now),
        },
        {
          remoteHostSessionId: sessionId,
          deviceId,
          grantTokenHash: tokenHash,
          status: KaraokeRemoteGrantStatus.APPROVED,
          expiresAt: MoreThan(now),
        },
      ],
    });
    if (!grant) {
      const expired = await this.grants.findOne({
        where: [
          { karaokeSessionId: sessionId, deviceId, grantTokenHash: tokenHash },
          {
            remoteHostSessionId: sessionId,
            deviceId,
            grantTokenHash: tokenHash,
          },
        ],
      });
      if (expired && expired.status === KaraokeRemoteGrantStatus.APPROVED) {
        expired.status = KaraokeRemoteGrantStatus.EXPIRED;
        await this.grants.save(expired);
      }
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device is not approved.',
      );
    }
    await this.assertActiveRemoteSession(
      sessionId,
      grant.remoteHostSessionId ? 'guest' : 'karaoke',
    );
    return grant;
  }

  async assertGrantActive(
    sessionId: string,
    deviceId: string,
    grantId: string,
    sessionKind: RemoteSessionKind = 'karaoke',
  ): Promise<KaraokeRemoteGrant> {
    if (!this.isDeviceId(deviceId)) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device identity is invalid.',
      );
    }
    const grant = await this.grants.findOne({
      where: {
        ...this.sessionScope(sessionId, sessionKind),
        id: grantId,
        deviceId,
        status: KaraokeRemoteGrantStatus.APPROVED,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!grant) {
      throw this.remoteError(
        'REMOTE_NOT_AUTHORIZED',
        'Remote device is not approved.',
      );
    }
    await this.assertActiveRemoteSession(sessionId, sessionKind);
    return grant;
  }

  async renewActiveGrantsForSession(sessionId: string): Promise<number> {
    await this.findActiveSessionById(sessionId);
    const now = new Date();
    const renewalThreshold = new Date(
      now.getTime() + this.grantLifetimeMs / 2,
    );
    const candidateExpiry = new Date(now.getTime() + this.grantLifetimeMs);
    const result = await this.grants
      .createQueryBuilder()
      .update(KaraokeRemoteGrant)
      .set({ expiresAt: candidateExpiry })
      .where('karaokeSessionId = :sessionId', { sessionId })
      .andWhere('status = :status', {
        status: KaraokeRemoteGrantStatus.APPROVED,
      })
      .andWhere('expiresAt > :now', { now })
      .andWhere('expiresAt <= :renewalThreshold', { renewalThreshold })
      .execute();
    const renewed = result.affected ?? 0;
    if (renewed > 0) {
      this.logger.log(
        `Renewed ${renewed} active remote grant(s) for session ${this.safeId(sessionId)}`,
      );
    }
    return renewed;
  }

  async revokeAll(
    sessionId: string,
    sessionKind: RemoteSessionKind = 'karaoke',
  ): Promise<KaraokeRemoteGrant[]> {
    const scope = this.sessionScope(sessionId, sessionKind);
    const active = await this.grants.find({
      where: [
        { ...scope, status: KaraokeRemoteGrantStatus.PENDING },
        { ...scope, status: KaraokeRemoteGrantStatus.APPROVED },
      ],
    });
    const now = new Date();
    if (active.length > 0) {
      for (const grant of active) {
        grant.status = KaraokeRemoteGrantStatus.REVOKED;
        grant.revokedAt = now;
      }
      await this.grants.save(active);
    }
    await this.invalidatePairingInvitations(sessionId, sessionKind, now);
    this.logger.log(
      `Remote access revoked for session ${this.safeId(sessionId)}`,
    );
    return active;
  }

  async invalidateSession(
    sessionId: string,
    status: KaraokeRemoteGrantStatus = KaraokeRemoteGrantStatus.REVOKED,
    sessionKind: RemoteSessionKind = 'karaoke',
  ): Promise<void> {
    const now = new Date();
    const column = this.sessionColumn(sessionKind);
    await this.grants
      .createQueryBuilder()
      .update(KaraokeRemoteGrant)
      .set({ status, revokedAt: now })
      .where(`${column} = :sessionId`, { sessionId })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          KaraokeRemoteGrantStatus.PENDING,
          KaraokeRemoteGrantStatus.APPROVED,
        ],
      })
      .execute();
    await this.invalidatePairingInvitations(sessionId, sessionKind, now);
    for (const listener of this.sessionInvalidationListeners)
      listener(sessionId, sessionKind);
  }

  onSessionInvalidated(
    listener: (sessionId: string, sessionKind: RemoteSessionKind) => void,
  ): () => void {
    this.sessionInvalidationListeners.add(listener);
    return () => this.sessionInvalidationListeners.delete(listener);
  }

  async findActiveSession(
    ownerId: string,
    sessionId: string,
  ): Promise<KaraokeSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId, ownerId },
    });
    if (!session) throw new NotFoundException('Karaoke session not found.');
    return this.assertActiveSession(session);
  }

  async findActiveSessionById(sessionId: string): Promise<KaraokeSession> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session)
      throw this.remoteError('SESSION_NOT_FOUND', 'Karaoke session not found.');
    return this.assertActiveSession(session);
  }

  private async issuePairingToken(
    sessionKind: RemoteSessionKind,
    sessionId: string,
    now = new Date(),
  ): Promise<PairingInvitation> {
    // Explicit QR rotation invalidates the previous invitation, while approval
    // of one device deliberately leaves the current invitation usable by others.
    await this.invalidatePairingInvitations(sessionId, sessionKind, now);
    const token = randomBytes(32).toString('base64url');
    const record = this.pairingSessions.create({
      karaokeSessionId: sessionKind === 'karaoke' ? sessionId : null,
      remoteHostSessionId: sessionKind === 'guest' ? sessionId : null,
      tokenHash: this.hash(token),
      expiresAt: new Date(now.getTime() + this.pairingTokenMs),
      consumedAt: null,
    });
    const saved = await this.pairingSessions.save(record);
    return { token, sessionId, expiresAt: saved.expiresAt };
  }

  /**
   * Invalidate the invitation for a session-wide event only. This is not part
   * of approving or rejecting an individual remote request because one QR may
   * authorize multiple devices during its valid window.
   */
  private async invalidatePairingInvitations(
    sessionId: string,
    sessionKind: RemoteSessionKind,
    consumedAt: Date,
  ): Promise<void> {
    await this.pairingSessions.update(
      { ...this.sessionScope(sessionId, sessionKind), consumedAt: IsNull() },
      { consumedAt },
    );
  }

  private async assertActiveRemoteSession(
    sessionId: string,
    sessionKind: RemoteSessionKind,
  ): Promise<void> {
    if (sessionKind === 'karaoke') {
      await this.findActiveSessionById(sessionId);
      return;
    }
    const host = await this.hostSessions.findOne({ where: { id: sessionId } });
    if (!host || host.revokedAt || host.expiresAt.getTime() <= Date.now()) {
      throw this.remoteError(
        'SESSION_EXPIRED',
        'This anonymous karaoke session is no longer active.',
      );
    }
  }

  private assertActiveSession(session: KaraokeSession): KaraokeSession {
    if (
      session.status !== KaraokeSessionStatus.ACTIVE ||
      session.leaseExpiresAt.getTime() <= Date.now()
    ) {
      throw this.remoteError(
        'SESSION_EXPIRED',
        'This karaoke session is no longer active.',
      );
    }
    return session;
  }

  private sessionScope(
    sessionId: string,
    sessionKind: RemoteSessionKind,
  ): Record<string, string> {
    return {
      [this.sessionColumn(sessionKind)]: sessionId,
    };
  }

  private sessionColumn(
    sessionKind: RemoteSessionKind,
  ): 'karaokeSessionId' | 'remoteHostSessionId' {
    return sessionKind === 'guest' ? 'remoteHostSessionId' : 'karaokeSessionId';
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private readNumber(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = Number(this.config.get<string>(name));
    return Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), min), max)
      : fallback;
  }

  private safeId(value: string): string {
    return value.slice(0, 8);
  }

  private isDeviceId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private pairingError(
    code: 'PAIR_TOKEN_INVALID' | 'PAIR_TOKEN_EXPIRED' | 'SESSION_EXPIRED',
    message: string,
  ): ConflictException {
    return new ConflictException({ code, message });
  }

  private remoteError(
    code: 'REMOTE_NOT_AUTHORIZED' | 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED',
    message: string,
  ): UnauthorizedException | ConflictException | NotFoundException {
    if (code === 'SESSION_NOT_FOUND') return new NotFoundException(message);
    if (code === 'SESSION_EXPIRED')
      return new ConflictException({ code, message });
    return new UnauthorizedException({ code, message });
  }
}
