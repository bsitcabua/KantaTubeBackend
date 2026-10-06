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

  function createService(
    configValues: Record<string, string> = {},
    session = activeSession,
  ) {
    const sessions = {
      findOne: jest.fn().mockResolvedValue(session),
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
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      })),
    } as unknown as Repository<KaraokeRemoteGrant>;
    const hostSessions = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'host-id', ...value })),
    } as unknown as Repository<KaraokeRemoteHostSession>;
    const config = {
      get: jest.fn((name: string) => configValues[name]),
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

  it('uses the configured pairing TTL and creates a fixed grant TTL at approval', async () => {
    const { service, pairingSessions, grants } = createService({
      REMOTE_PAIRING_TOKEN_SECONDS: '60',
      REMOTE_GRANT_LIFETIME_HOURS: '1',
    });
    const pairingStartedAt = Date.now();
    const invitation = await service.createPairingToken(ownerId, sessionId);
    const savedPairing = (pairingSessions.save as jest.Mock).mock
      .calls[0][0] as KaraokePairingSession;

    expect(savedPairing.expiresAt.getTime()).toBeGreaterThanOrEqual(
      pairingStartedAt + 60_000,
    );
    expect(savedPairing.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 60_000,
    );

    pairingSessions.findOne = jest.fn().mockResolvedValue({
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const pending = await service.createPendingRemote(
      invitation.token,
      deviceId,
      'Phone',
    );
    grants.findOne = jest.fn().mockResolvedValue(pending.grant);
    const approved = await service.approveRemote(sessionId, pending.grant.id);

    expect(approved.grant.approvedAt).toBeInstanceOf(Date);
    expect(approved.grant.expiresAt.getTime()).toBe(
      approved.grant.approvedAt!.getTime() + 60 * 60 * 1000,
    );
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

  it('creates a pending grant and approves it without consuming the shared invitation', async () => {
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
    expect(pairingSessions.update).not.toHaveBeenCalled();
  });

  it('allows multiple pending devices to use the same pairing invitation', async () => {
    const { service, pairingSessions, grants } = createService();
    const pairing = {
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    pairingSessions.findOne = jest.fn().mockResolvedValue(pairing);
    grants.findOne = jest.fn().mockResolvedValue(undefined);

    await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceId,
      'Phone',
    );
    await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      '123e4567-e89b-42d3-a456-426614174003',
      'Tablet',
    );

    expect(pairingSessions.findOne).toHaveBeenCalledTimes(2);
    expect(pairingSessions.update).not.toHaveBeenCalled();
  });

  it('allows another device to use the same invitation after one device is approved', async () => {
    const { service, pairingSessions, grants } = createService();
    const pairing = {
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    pairingSessions.findOne = jest.fn().mockResolvedValueOnce(pairing);
    const pendingGrant = {
      id: 'grant-id',
      deviceId,
      status: KaraokeRemoteGrantStatus.PENDING,
    } as KaraokeRemoteGrant;
    grants.findOne = jest
      .fn()
      .mockResolvedValueOnce(pendingGrant)
      .mockResolvedValueOnce(undefined);
    await service.approveRemote(sessionId, pendingGrant.id);

    pairingSessions.findOne = jest.fn().mockResolvedValue(pairing);
    const secondPending = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      '123e4567-e89b-42d3-a456-426614174003',
      'Tablet',
    );

    expect(secondPending.grant.status).toBe(KaraokeRemoteGrantStatus.PENDING);
    expect(pairingSessions.update).not.toHaveBeenCalled();
  });

  it('approves multiple distinct remotes from one QR with independent grants', async () => {
    const { service, pairingSessions, grants } = createService();
    const pairing = {
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const deviceA = deviceId;
    const deviceB = '123e4567-e89b-42d3-a456-426614174003';
    const grantsById = new Map<string, KaraokeRemoteGrant>();
    const grantsByDevice = new Map<string, KaraokeRemoteGrant>();
    let nextGrant = 0;

    pairingSessions.findOne = jest.fn().mockResolvedValue(pairing);
    grants.create = jest.fn((value) => {
      const grant = {
        ...value,
        id: `grant-${++nextGrant}`,
      } as KaraokeRemoteGrant;
      grantsByDevice.set(grant.deviceId, grant);
      return grant;
    }) as never;
    grants.save = jest.fn(async (value) => {
      const grant = value as KaraokeRemoteGrant;
      grantsById.set(grant.id, grant);
      grantsByDevice.set(grant.deviceId, grant);
      return grant;
    }) as never;
    grants.findOne = jest.fn(
      async ({
        where,
      }: {
        where: Record<string, unknown> | Record<string, unknown>[];
      }) => {
        const scopes = Array.isArray(where) ? where : [where];
        for (const scope of scopes) {
          if (typeof scope.id === 'string') {
            const byId = grantsById.get(scope.id);
            if (byId) return byId;
          }
          if (typeof scope.deviceId === 'string') {
            const byDevice = grantsByDevice.get(scope.deviceId);
            if (byDevice && byDevice.status === scope.status) return byDevice;
          }
        }
        return undefined;
      },
    ) as never;

    const pendingA = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceA,
      'Phone A',
    );
    const approvedA = await service.approveRemote(sessionId, pendingA.grant.id);
    const pendingB = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceB,
      'Phone B',
    );
    const approvedB = await service.approveRemote(sessionId, pendingB.grant.id);

    expect(approvedA.grant.status).toBe(KaraokeRemoteGrantStatus.APPROVED);
    expect(approvedB.grant.status).toBe(KaraokeRemoteGrantStatus.APPROVED);
    expect(approvedA.grant.id).not.toBe(approvedB.grant.id);
    expect(approvedA.grant.deviceId).toBe(deviceA);
    expect(approvedB.grant.deviceId).toBe(deviceB);
    expect(pairingSessions.update).not.toHaveBeenCalled();
    await expect(
      service.authorizeGrant(sessionId, deviceA, approvedA.grantToken),
    ).resolves.toBe(approvedA.grant);
    await expect(
      service.authorizeGrant(sessionId, deviceB, approvedB.grantToken),
    ).resolves.toBe(approvedB.grant);
  });

  it('keeps the invitation available after rejecting one pending remote', async () => {
    const { service, pairingSessions, grants } = createService();
    const pairing = {
      karaokeSessionId: sessionId,
      remoteHostSessionId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    pairingSessions.findOne = jest.fn().mockResolvedValue(pairing);
    grants.findOne = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'grant-id',
        deviceId,
        status: KaraokeRemoteGrantStatus.PENDING,
      })
      .mockResolvedValueOnce(undefined);

    await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      deviceId,
      'Phone A',
    );
    await service.rejectRemote(sessionId, 'grant-id');
    const nextPending = await service.createPendingRemote(
      'pairing-token-value-123456789012345678901234567890',
      '123e4567-e89b-42d3-a456-426614174003',
      'Phone B',
    );

    expect(nextPending.grant.status).toBe(KaraokeRemoteGrantStatus.PENDING);
    expect(pairingSessions.update).not.toHaveBeenCalled();
  });

  it('rejects an expired grant during authorization and marks it expired', async () => {
    const { service, grants } = createService();
    const expired = {
      id: 'grant-id',
      status: KaraokeRemoteGrantStatus.APPROVED,
      expiresAt: new Date(Date.now() - 1),
    } as KaraokeRemoteGrant;
    grants.findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(expired);

    await expect(
      service.authorizeGrant(
        sessionId,
        deviceId,
        'grant-token-value-123456789012345678901234567890',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMOTE_NOT_AUTHORIZED' }),
    });
    expect(expired.status).toBe(KaraokeRemoteGrantStatus.EXPIRED);
    expect(grants.save).toHaveBeenCalledWith(expired);
  });

  it('rejects an expired grant during per-command revalidation', async () => {
    const { service, grants } = createService();
    grants.findOne = jest.fn().mockResolvedValue(null);

    await expect(
      service.assertGrantActive(sessionId, deviceId, 'grant-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMOTE_NOT_AUTHORIZED' }),
    });
  });

  it('does not renew grants when they are outside the renewal window', async () => {
    const { service, grants } = createService({
      REMOTE_GRANT_LIFETIME_HOURS: '1',
    });

    const renewed = await service.renewActiveGrantsForSession(sessionId);

    expect(renewed).toBe(0);
    expect(grants.createQueryBuilder).toHaveBeenCalled();
    const queryBuilder = (grants.createQueryBuilder as jest.Mock).mock
      .results[0].value;
    expect(queryBuilder.set).toHaveBeenCalledWith({
      expiresAt: expect.any(Date),
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'expiresAt > :now',
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'expiresAt <= :renewalThreshold',
      expect.objectContaining({ renewalThreshold: expect.any(Date) }),
    );
  });

  it('renews only approved, unexpired grants inside the rolling window', async () => {
    const { service, grants } = createService({
      REMOTE_GRANT_LIFETIME_HOURS: '1',
    });
    const execute = jest.fn().mockResolvedValue({ affected: 2 });
    grants.createQueryBuilder = jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    })) as never;

    const renewed = await service.renewActiveGrantsForSession(sessionId);

    expect(renewed).toBe(2);
    const queryBuilder = (grants.createQueryBuilder as jest.Mock).mock
      .results[0].value;
    expect(queryBuilder.update).toHaveBeenCalledWith(KaraokeRemoteGrant);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'karaokeSessionId = :sessionId',
      { sessionId },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :status', {
      status: KaraokeRemoteGrantStatus.APPROVED,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('continues rolling an approved grant beyond its original expiry horizon', async () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    jest.setSystemTime(startedAt);
    const sessionLease = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
    const { service, grants } = createService(
      { REMOTE_GRANT_LIFETIME_HOURS: '1' },
      { ...activeSession, leaseExpiresAt: sessionLease },
    );
    let currentExpiry = new Date(startedAt.getTime() + 29 * 60 * 1000);
    let candidateExpiry = currentExpiry;
    let now: Date | undefined;
    let renewalThreshold: Date | undefined;
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn((values: { expiresAt: Date }) => {
        candidateExpiry = values.expiresAt;
        return queryBuilder;
      }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn(
        (query: string, params: { now?: Date; renewalThreshold?: Date }) => {
          if (query === 'expiresAt > :now') now = params.now;
          if (query === 'expiresAt <= :renewalThreshold') {
            renewalThreshold = params.renewalThreshold;
          }
          return queryBuilder;
        },
      ),
      execute: jest.fn(async () => {
        if (
          now &&
          renewalThreshold &&
          currentExpiry > now &&
          currentExpiry <= renewalThreshold
        ) {
          currentExpiry = candidateExpiry;
          return { affected: 1 };
        }
        return { affected: 0 };
      }),
    };
    grants.createQueryBuilder = jest.fn(() => queryBuilder) as never;

    try {
      await expect(
        service.renewActiveGrantsForSession(sessionId),
      ).resolves.toBe(1);
      expect(currentExpiry).toEqual(new Date('2026-01-01T01:00:00.000Z'));

      jest.advanceTimersByTime(31 * 60 * 1000);
      await expect(
        service.renewActiveGrantsForSession(sessionId),
      ).resolves.toBe(1);
      expect(currentExpiry).toEqual(new Date('2026-01-01T01:31:00.000Z'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not renew grants after session validation fails', async () => {
    const { service, sessions, grants } = createService();
    sessions.findOne = jest.fn().mockResolvedValue({
      ...activeSession,
      status: KaraokeSessionStatus.ENDED,
    });

    await expect(
      service.renewActiveGrantsForSession(sessionId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SESSION_EXPIRED' }),
    });
    expect(grants.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects commands through grant revalidation after revoke', async () => {
    const { service, grants } = createService();
    const activeGrant = {
      id: 'grant-id',
      deviceId,
      status: KaraokeRemoteGrantStatus.APPROVED,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as KaraokeRemoteGrant;
    grants.find = jest.fn().mockResolvedValue([activeGrant]);
    grants.findOne = jest
      .fn()
      .mockImplementation(async () =>
        activeGrant.status === KaraokeRemoteGrantStatus.APPROVED
          ? activeGrant
          : null,
      );

    await service.revokeAll(sessionId);

    expect(activeGrant.status).toBe(KaraokeRemoteGrantStatus.REVOKED);
    await expect(
      service.assertGrantActive(sessionId, deviceId, activeGrant.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMOTE_NOT_AUTHORIZED' }),
    });
  });

  it('invalidates the active QR when revoking all access even without grants', async () => {
    const { service, pairingSessions, grants } = createService();

    await service.revokeAll(sessionId);

    expect(grants.find).toHaveBeenCalled();
    expect(pairingSessions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        karaokeSessionId: sessionId,
        consumedAt: expect.anything(),
      }),
      { consumedAt: expect.any(Date) },
    );
  });

  it('invalidates session grants and notifies the gateway listener', async () => {
    const { service, grants, pairingSessions } = createService();
    const activeGrant = {
      id: 'grant-id',
      deviceId,
      status: KaraokeRemoteGrantStatus.APPROVED,
      expiresAt: new Date(Date.now() + 60_000),
    } as KaraokeRemoteGrant;
    grants.findOne = jest
      .fn()
      .mockImplementation(async () =>
        activeGrant.status === KaraokeRemoteGrantStatus.APPROVED
          ? activeGrant
          : null,
      );
    grants.createQueryBuilder = jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockImplementation(async () => {
        activeGrant.status = KaraokeRemoteGrantStatus.REVOKED;
      }),
    })) as never;
    const listener = jest.fn();
    service.onSessionInvalidated(listener);

    await expect(
      service.assertGrantActive(sessionId, deviceId, activeGrant.id),
    ).resolves.toBe(activeGrant);
    await service.invalidateSession(sessionId);

    expect(grants.createQueryBuilder).toHaveBeenCalled();
    expect(pairingSessions.update).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(sessionId, 'karaoke');
    await expect(
      service.assertGrantActive(sessionId, deviceId, activeGrant.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMOTE_NOT_AUTHORIZED' }),
    });
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
