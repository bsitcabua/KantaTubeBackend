import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { KaraokeSessionStatus } from './entities/karaoke-session.entity';
import { KaraokePairingSession } from './entities/karaoke-pairing-session.entity';
import {
  KaraokeRemoteGrant,
  KaraokeRemoteGrantStatus,
} from './entities/karaoke-remote-grant.entity';
import { KaraokeRemoteHostSession } from './entities/karaoke-remote-host-session.entity';
import { RemoteAuthorizationService } from './remote-authorization.service';

describe('RemoteAuthorizationService', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const deviceId = '123e4567-e89b-42d3-a456-426614174002';
  const activeSession = {
    id: sessionId,
    ownerId,
    status: KaraokeSessionStatus.ACTIVE,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };

  function createService() {
    const sessions = {
      findOne: jest.fn().mockResolvedValue(activeSession),
    } as unknown as Repository<any>;
    const pairingSessions = {
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'pairing-id', ...value })),
    } as unknown as Repository<KaraokePairingSession>;
    const grants = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'grant-id', ...value })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
    } as unknown as Repository<KaraokeRemoteGrant>;
    const hostSessions = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'host-id', ...value })),
    } as unknown as Repository<KaraokeRemoteHostSession>;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    return {
      service: new RemoteAuthorizationService(
        sessions,
        pairingSessions,
        grants,
        hostSessions,
        config,
      ),
      sessions,
      pairingSessions,
      grants,
      hostSessions,
    };
  }

  it('creates a short-lived hashed invitation and invalidates the previous invitation', async () => {
    const { service, pairingSessions } = createService();

    const invitation = await service.createPairingToken(ownerId, sessionId);
    const saved = (pairingSessions.save as jest.Mock).mock
      .calls[0][0] as KaraokePairingSession;

    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(invitation.token).not.toBe(saved.tokenHash);
    expect(saved.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pairingSessions.update).toHaveBeenCalled();
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates an anonymous host capability without requiring a user account', async () => {
    const { service, hostSessions, pairingSessions } = createService();

    const invitation = await service.createGuestHost();

    expect(invitation.hostToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hostSessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        revokedAt: null,
      }),
    );
    expect(pairingSessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        karaokeSessionId: null,
        remoteHostSessionId: 'host-id',
      }),
    );
  });

  it('binds an anonymous pairing request to the host capability', async () => {
    const { service, hostSessions, pairingSessions } = createService();
    hostSessions.findOne = jest.fn().mockResolvedValue({
      id: 'host-id',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    pairingSessions.findOne = jest.fn().mockResolvedValue({
      karaokeSessionId: null,
      remoteHostSessionId: 'host-id',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const pending = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceId,
      'Phone',
    );

    expect(pending.sessionKind).toBe('guest');
    expect(pending.sessionId).toBe('host-id');
    expect(pending.grant.remoteHostSessionId).toBe('host-id');
  });

  it('rejects invalid, expired, consumed, and visitor-UUID pairing values', async () => {
    const { service, pairingSessions } = createService();
    pairingSessions.findOne = jest.fn().mockResolvedValue(null);

    await expect(
      service.createPendingRemote('not-a-token', deviceId, 'Phone'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAIR_TOKEN_INVALID' }),
    });
    await expect(
      service.createPendingRemote(
        '123e4567-e89b-42d3-a456-426614174000',
        deviceId,
        'Phone',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAIR_TOKEN_INVALID' }),
    });
    pairingSessions.findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1) });
    await expect(
      service.createPendingRemote(
        'another-token-value-123456789012345678901234567890',
        deviceId,
        'Phone',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAIR_TOKEN_EXPIRED' }),
    });
  });

  it('creates a pending grant, approves it with a one-time grant token, and consumes invitations', async () => {
    const { service, pairingSessions, grants } = createService();
    const pairing = {
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    pairingSessions.findOne = jest.fn().mockResolvedValue(pairing);
    const pending = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceId,
      'Phone',
    );
    expect(pending.grant.status).toBe(KaraokeRemoteGrantStatus.PENDING);
    grants.findOne = jest.fn().mockResolvedValue(pending.grant);
    const approved = await service.approveRemote(sessionId, pending.grant.id);

    expect(approved.grant.status).toBe(KaraokeRemoteGrantStatus.APPROVED);
    expect(approved.grant.grantTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(approved.grantToken).not.toBe(approved.grant.grantTokenHash);
    expect(pairingSessions.update).toHaveBeenCalledTimes(1);
  });

  it('does not authorize a grant for another device and revocation is immediate', async () => {
    const { service, grants } = createService();
    grants.findOne = jest.fn().mockResolvedValue(null);

    await expect(
      service.authorizeGrant(
        sessionId,
        deviceId,
        'grant-token-value-123456789012345678901234567890',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await service.revokeAll(sessionId);
    expect(grants.find).toHaveBeenCalled();
  });
});
