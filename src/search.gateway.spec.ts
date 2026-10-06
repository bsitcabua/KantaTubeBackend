import { Server, Socket } from 'socket.io';
import { SearchGateway } from './search.gateway';

describe('SearchGateway', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  const deviceId = '123e4567-e89b-42d3-a456-426614174001';
  const grantId = '123e4567-e89b-42d3-a456-426614174002';
  let gateway: SearchGateway;
  let sockets: Map<string, Socket>;
  let roomEmit: jest.Mock;
  let auth: { authenticate: jest.Mock; cookieName: string };
  let authorization: {
    findActiveSession: jest.Mock;
    authorizeGuestHost: jest.Mock;
    createPendingRemote: jest.Mock;
    approveRemote: jest.Mock;
    rejectRemote: jest.Mock;
    authorizeGrant: jest.Mock;
    assertGrantActive: jest.Mock;
    revokeAll: jest.Mock;
  };
  let rateLimiter: { allowSocketEvent: jest.Mock };

  beforeEach(() => {
    sockets = new Map<string, Socket>();
    roomEmit = jest.fn();
    auth = {
      authenticate: jest.fn().mockResolvedValue({ id: 'owner-id' }),
      cookieName: 'kantatube_session',
    };
    authorization = {
      findActiveSession: jest.fn().mockResolvedValue({ id: sessionId }),
      authorizeGuestHost: jest.fn().mockResolvedValue({ id: sessionId }),
      createPendingRemote: jest.fn().mockResolvedValue({
        sessionId,
        sessionKind: 'karaoke',
        grant: { id: grantId, deviceId },
      }),
      approveRemote: jest.fn().mockResolvedValue({
        grant: { id: grantId, deviceId },
        grantToken: 'grant-token-value',
      }),
      rejectRemote: jest.fn().mockResolvedValue(undefined),
      authorizeGrant: jest.fn().mockResolvedValue({ id: grantId }),
      assertGrantActive: jest.fn().mockResolvedValue({ id: grantId }),
      revokeAll: jest.fn().mockResolvedValue([]),
    };
    rateLimiter = { allowSocketEvent: jest.fn().mockReturnValue(true) };
    gateway = new SearchGateway(
      auth as never,
      authorization as never,
      rateLimiter as never,
    );
    gateway.server = {
      to: jest.fn(() => ({ emit: roomEmit })),
      sockets: { sockets },
    } as unknown as Server;
  });

  function createClient(
    authFields: Record<string, string>,
    id: string,
  ): Socket {
    const client = {
      id,
      data: {},
      handshake: {
        auth: authFields,
        headers: {
          cookie: 'kantatube_session=session-cookie',
          'user-agent': 'test browser',
        },
      },
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      emit: jest.fn(),
    } as unknown as Socket;
    sockets.set(id, client);
    return client;
  }

  it('authenticates the main client from the session cookie and joins a session room', async () => {
    const main = createClient({ sessionId }, 'main-socket');

    await gateway.handleConnection(main);

    expect(auth.authenticate).toHaveBeenCalledWith('session-cookie');
    expect(authorization.findActiveSession).toHaveBeenCalledWith(
      'owner-id',
      sessionId,
    );
    expect(main.join).toHaveBeenCalledWith(`karaoke:karaoke:${sessionId}`);
    expect(main.handshake.auth).not.toHaveProperty('role');
  });

  it('accepts an anonymous main host capability without a login cookie', async () => {
    const guestSessionId = '123e4567-e89b-42d3-a456-426614174009';
    const main = createClient(
      { sessionId: guestSessionId, hostToken: 'guest-host-token-value' },
      'guest-main-socket',
    );
    (main.handshake.headers as { cookie?: string }).cookie = undefined;

    await gateway.handleConnection(main);

    expect(authorization.authorizeGuestHost).toHaveBeenCalledWith(
      guestSessionId,
      'guest-host-token-value',
    );
    expect(main.join).toHaveBeenCalledWith(`karaoke:guest:${guestSessionId}`);
  });

  it('does not allow a visitor UUID or self-declared role to authorize a socket', async () => {
    const client = createClient(
      { visitorID: sessionId, role: 'main' },
      'spoofed-socket',
    );

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'socketError',
      expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
    );
  });

  it('keeps a pairing remote pending and blocks its commands until approval', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-socket',
    );
    await gateway.handleConnection(main);
    await gateway.handleConnection(remote);

    expect(main.emit).toHaveBeenCalledWith(
      'remoteConnectionRequest',
      expect.objectContaining({ requestId: grantId, deviceId }),
    );
    const pendingResult = await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'test' },
    });
    expect(pendingResult).toMatchObject({
      ok: false,
      error: { code: 'REMOTE_PENDING' },
    });
    expect(main.emit).not.toHaveBeenCalledWith('onSearch', expect.anything());
  });

  it('keeps different remote devices connected and replaces only the same device', async () => {
    const deviceB = '123e4567-e89b-42d3-a456-426614174003';
    authorization.createPendingRemote.mockImplementation(
      async (_pairingToken: string, requestedDeviceId: string) => ({
        sessionId,
        sessionKind: 'karaoke',
        grant: {
          id: `grant-${requestedDeviceId.slice(-1)}`,
          deviceId: requestedDeviceId,
        },
      }),
    );
    const remoteA = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-a',
    );
    const remoteB = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId: deviceB,
      },
      'remote-b',
    );

    await gateway.handleConnection(remoteA);
    await gateway.handleConnection(remoteB);

    expect(remoteA.disconnect).not.toHaveBeenCalled();
    expect(remoteB.disconnect).not.toHaveBeenCalled();

    const replacement = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-a-replacement',
    );
    await gateway.handleConnection(replacement);

    expect(remoteA.emit).toHaveBeenCalledWith(
      'remoteConnectionRevoked',
      expect.objectContaining({
        message: expect.stringContaining('another tab'),
      }),
    );
    expect(remoteA.disconnect).toHaveBeenCalledWith(true);
    expect(remoteB.disconnect).not.toHaveBeenCalled();
  });

  it('forwards a validated command only after approval and grant revalidation', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-socket',
    );
    await gateway.handleConnection(main);
    await gateway.handleConnection(remote);
    await gateway.approveRemoteConnection(main, { requestId: grantId });

    const result = await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'test' },
    });

    expect(result).toEqual({ ok: true });
    expect(main.emit).toHaveBeenCalledWith('onSearch', {
      event: 'onSearch',
      data: { search: 'test' },
    });
    expect(authorization.assertGrantActive).toHaveBeenCalledWith(
      sessionId,
      deviceId,
      grantId,
      'karaoke',
    );
  });

  it('forwards a typed queue-full response to remotes without treating it as disconnect', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    await gateway.handleConnection(main);

    const result = await gateway.queueError(main, {
      event: 'queueError',
      data: {
        code: 'QUEUE_FULL',
        message: 'Song reserve list is full (15/15).',
        queueCount: 15,
        maxQueueSize: 15,
        requestId: 'search-1',
      },
    });

    expect(result).toEqual({ ok: true });
    expect(roomEmit).toHaveBeenCalledWith('queueError', {
      event: 'queueError',
      data: expect.objectContaining({ code: 'QUEUE_FULL', queueCount: 15 }),
    });
  });

  it('rejects a remote command when grant revalidation reports an expired grant', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-socket',
    );
    await gateway.handleConnection(main);
    await gateway.handleConnection(remote);
    await gateway.approveRemoteConnection(main, { requestId: grantId });
    authorization.assertGrantActive.mockRejectedValue({
      response: {
        code: 'REMOTE_NOT_AUTHORIZED',
        message: 'Remote device is not approved.',
      },
    });

    const result = await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'test' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'REMOTE_NOT_AUTHORIZED' },
    });
    expect(main.emit).not.toHaveBeenCalledWith('onSearch', expect.anything());
  });

  it('rejects malformed payloads and throttled commands', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-socket',
    );
    await gateway.handleConnection(main);
    await gateway.handleConnection(remote);
    await gateway.approveRemoteConnection(main, { requestId: grantId });

    const malformed = await gateway.playVideo(remote, {
      event: 'playVideo',
      data: { huge: 'unexpected' },
    });
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });

    rateLimiter.allowSocketEvent.mockReturnValue(false);
    const limited = await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'test' },
    });
    expect(limited).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('returns an explicit error when the main socket is offline', async () => {
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
      },
      'remote-socket',
    );
    await gateway.handleConnection(remote);
    (remote.data as { kantaTube: { state: string } }).kantaTube.state =
      'approved';
    const result = await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'test' },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'MAIN_CLIENT_OFFLINE' },
    });
  });
});
