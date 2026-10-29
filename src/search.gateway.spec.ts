import { Server, Socket } from 'socket.io';
import { SearchGateway } from './search.gateway';

describe('SearchGateway', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  const deviceId = '123e4567-e89b-42d3-a456-426614174001';
  const grantId = '123e4567-e89b-42d3-a456-426614174002';
  let gateway: SearchGateway;
  let sockets: Map<string, Socket>;
  let roomEmit: jest.Mock;
  let auth: {
    authenticate: jest.Mock;
    authenticateSocketTicket: jest.Mock;
    cookieName: string;
  };
  let authorization: {
    findActiveSession: jest.Mock;
    isClaimedGuestSession: jest.Mock;
    authorizeGuestHost: jest.Mock;
    validatePairingToken: jest.Mock;
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
      authenticateSocketTicket: jest.fn().mockResolvedValue({ id: 'owner-id' }),
      cookieName: 'kantatube_session',
    };
    authorization = {
      findActiveSession: jest.fn().mockResolvedValue({ id: sessionId }),
      isClaimedGuestSession: jest.fn().mockResolvedValue(false),
      authorizeGuestHost: jest.fn().mockResolvedValue({ id: sessionId }),
      validatePairingToken: jest.fn().mockResolvedValue({ sessionId, sessionKind: 'karaoke' }),
      createPendingRemote: jest.fn().mockImplementation(async (_pairingToken: string, requestedDeviceId: string, _deviceLabel: string, requestedDisplayName: string) => ({
        sessionId,
        sessionKind: 'karaoke',
        grant: { id: grantId, deviceId: requestedDeviceId, displayName: requestedDisplayName || 'Test Remote', expiresAt: new Date(Date.now() + 60_000) },
      })),
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
    const handshakeAuth = { ...authFields };
    if (handshakeAuth.pairingToken && handshakeAuth.requestRemoteAccess === undefined) {
      handshakeAuth.requestRemoteAccess = 'true';
      handshakeAuth.remoteDisplayName = 'Test Remote';
    }
    const client = {
      id,
      data: {},
      handshake: {
        auth: handshakeAuth,
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
      '',
    );
    expect(main.join).toHaveBeenCalledWith(`karaoke:karaoke:${sessionId}`);
    expect(main.emit).toHaveBeenCalledWith('mainRegistered', {
      sessionId,
      sessionKind: 'karaoke',
    });
    expect(main.emit).toHaveBeenCalledWith('activeRemoteCount', { count: 0 });
    expect(main.handshake.auth).not.toHaveProperty('role');
  });

  it('rejects a simultaneous second main tab without disconnecting the current Host', async () => {
    const sessions = {
      claimHost: jest.fn().mockResolvedValue({ id: sessionId }),
    };
    const gatedGateway = new SearchGateway(
      auth as never,
      authorization as never,
      rateLimiter as never,
      undefined,
      undefined,
      sessions as never,
    );
    gatedGateway.server = {
      to: jest.fn(() => ({ emit: roomEmit })),
      sockets: { sockets },
    } as unknown as Server;
    const first = createClient(
      { sessionId, clientId: '123e4567-e89b-42d3-a456-426614174003' },
      'first-main-socket',
    );
    const second = createClient(
      { sessionId, clientId: '123e4567-e89b-42d3-a456-426614174004' },
      'second-main-socket',
    );

    await Promise.all([
      gatedGateway.handleConnection(first),
      gatedGateway.handleConnection(second),
    ]);

    expect(sessions.claimHost).toHaveBeenCalledTimes(2);
    expect(first.emit).toHaveBeenCalledWith('mainRegistered', expect.anything());
    expect(first.disconnect).not.toHaveBeenCalled();
    expect(second.emit).toHaveBeenCalledWith(
      'socketError',
      expect.objectContaining({ code: 'DUPLICATE_MAIN_CLIENT' }),
    );
    expect(second.disconnect).toHaveBeenCalledWith(true);

    (gatedGateway as unknown as {
      handleSessionInvalidated: (id: string, kind: 'karaoke') => void;
    }).handleSessionInvalidated(sessionId, 'karaoke');
    await expect(
      gatedGateway.videoStatus(first, {
        event: 'videoStatus',
        data: { videoStatus: 'playing' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'REMOTE_NOT_AUTHORIZED' },
    });
  });

  it('authenticates a cross-origin main client with a short-lived socket ticket', async () => {
    const main = createClient({ sessionId, socketTicket: 'v1.ticket.signature' }, 'ticket-main-socket');
    (main.handshake.headers as { cookie?: string }).cookie = undefined;

    await gateway.handleConnection(main);

    expect(auth.authenticateSocketTicket).toHaveBeenCalledWith('v1.ticket.signature', sessionId);
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(authorization.findActiveSession).toHaveBeenCalledWith('owner-id', sessionId, '');
    expect(main.join).toHaveBeenCalledWith(`karaoke:karaoke:${sessionId}`);
  });

  it('keeps a claimed guest session on the guest remote route after login', async () => {
    authorization.isClaimedGuestSession.mockResolvedValue(true);
    const main = createClient({ sessionId }, 'claimed-guest-main-socket');

    await gateway.handleConnection(main);

    expect(main.join).toHaveBeenCalledWith(`karaoke:guest:${sessionId}`);
    expect(main.emit).toHaveBeenCalledWith('mainRegistered', {
      sessionId,
      sessionKind: 'guest',
    });
  });

  it('reports a rejected session-bound ticket without querying the karaoke session', async () => {
    auth.authenticateSocketTicket.mockResolvedValue(null);
    const main = createClient({ sessionId, socketTicket: 'expired-or-mismatched-ticket' }, 'ticket-main-socket');
    (main.handshake.headers as { cookie?: string }).cookie = undefined;

    await gateway.handleConnection(main);

    expect(main.emit).toHaveBeenCalledWith(
      'socketError',
      expect.objectContaining({ code: 'SOCKET_TICKET_REJECTED' }),
    );
    expect(authorization.findActiveSession).not.toHaveBeenCalled();
    expect(main.disconnect).toHaveBeenCalledWith(true);
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
    expect(main.emit).toHaveBeenCalledWith('mainRegistered', {
      sessionId: guestSessionId,
      sessionKind: 'guest',
    });
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
    expect(remote.emit).toHaveBeenCalledWith(
      'remoteConnectionPending',
      expect.objectContaining({ expiresAt: expect.any(String) }),
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

  it('validates a pairing link without notifying the host until the remote requests access', async () => {
    const main = createClient({ sessionId }, 'main-socket');
    const remote = createClient(
      {
        pairingToken: 'pairing-token-value-123456789012345678901234567890',
        deviceId,
        requestRemoteAccess: 'false',
      },
      'remote-socket',
    );

    await gateway.handleConnection(main);
    await gateway.handleConnection(remote);

    expect(authorization.validatePairingToken).toHaveBeenCalled();
    expect(main.emit).not.toHaveBeenCalledWith('remoteConnectionRequest', expect.anything());

    const result = await gateway.requestRemoteAccess(remote, { displayName: 'Elvin' });

    expect(result).toEqual({ ok: true });
    expect(main.emit).toHaveBeenCalledWith(
      'remoteConnectionRequest',
      expect.objectContaining({ displayName: 'Elvin', expiresAt: expect.any(String) }),
    );
    expect(remote.emit).toHaveBeenCalledWith(
      'remoteConnectionPending',
      expect.objectContaining({ displayName: 'Elvin', expiresAt: expect.any(String) }),
    );
  });

  it('reports only approved connected remotes in the active count', async () => {
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
    expect(main.emit).toHaveBeenCalledWith('activeRemoteCount', { count: 0 });

    await gateway.approveRemoteConnection(main, { requestId: grantId });
    expect(main.emit).toHaveBeenCalledWith('activeRemoteCount', { count: 1 });

    (remote as unknown as { connected: boolean }).connected = false;
    gateway.handleDisconnect(remote);
    expect(main.emit).toHaveBeenCalledWith('activeRemoteCount', { count: 0 });
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
          expiresAt: new Date(Date.now() + 60_000),
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
    expect(main.emit).toHaveBeenCalledWith('onSearch', expect.objectContaining({
      event: 'onSearch',
      data: expect.objectContaining({ search: 'test', remoteSearchRoute: expect.any(String) }),
    }));
    expect(authorization.assertGrantActive).toHaveBeenCalledWith(
      sessionId,
      deviceId,
      grantId,
      'karaoke',
    );
  });

  it('routes search results only to the requesting remote and drops unscoped search broadcasts', async () => {
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
    roomEmit.mockClear();

    await gateway.onSearch(remote, {
      event: 'onSearch',
      data: { search: 'Adele', requestId: 'remote-a-1' },
    });
    const forwardedSearch = (main.emit as jest.Mock).mock.calls.find(([event]) => event === 'onSearch');
    const route = forwardedSearch?.[1]?.data?.remoteSearchRoute;
    expect(route).toEqual(expect.any(String));

    const response = await gateway.searchResults(main, {
      event: 'searchResults',
      data: {
        remoteSearchRoute: route,
        requestId: 'remote-a-1',
        searchResults: [],
      },
    });

    expect(response).toEqual({ ok: true });
    expect(remote.emit).toHaveBeenCalledWith('searchResults', {
      event: 'searchResults',
      data: { requestId: 'remote-a-1', searchResults: [] },
    });
    expect(roomEmit).not.toHaveBeenCalledWith('searchResults', expect.anything());

    await gateway.searchResults(main, {
      event: 'searchResults',
      data: { searchResults: [] },
    });
    expect(roomEmit).not.toHaveBeenCalledWith('searchResults', expect.anything());
  });

  it('routes duplicate reservation warnings only to the requesting remote', async () => {
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
    roomEmit.mockClear();

    const song = {
      videoId: 'abc123',
      title: 'A Little Respect',
      description: 'Karaoke song',
      thumbnails: 'https://example.com/thumb.jpg',
      performer: 'ELVIN',
    };
    await gateway.reserveSong(remote, { event: 'reserveSong', data: song });
    const forwardedReserve = (main.emit as jest.Mock).mock.calls.find(([event]) => event === 'reserveSong');
    const route = forwardedReserve?.[1]?.data?.remoteCommandRoute;
    expect(route).toEqual(expect.any(String));

    const response = await gateway.queueDuplicateWarning(main, {
      event: 'queueDuplicateWarning',
      data: {
        code: 'QUEUE_DUPLICATE',
        remoteCommandRoute: route,
        performer: 'ELVIN',
        song,
        searchSong: {
          source: 'songbook',
          artist: 'Erasure',
          id: { videoId: 'abc123' },
          snippet: {
            title: 'A Little Respect',
            description: 'Karaoke song',
            thumbnails: { medium: { url: 'https://example.com/thumb.jpg' } },
          },
        },
      },
    });

    expect(response).toEqual({ ok: true });
    expect(remote.emit).toHaveBeenCalledWith('queueDuplicateWarning', {
      event: 'queueDuplicateWarning',
      data: expect.objectContaining({ code: 'QUEUE_DUPLICATE', performer: 'ELVIN' }),
    });
    expect(roomEmit).not.toHaveBeenCalledWith('queueDuplicateWarning', expect.anything());
  });

  it('routes a queue-full response only to the reserving remote when a reserve command is scoped', async () => {
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
    roomEmit.mockClear();

    await gateway.reserveSong(remote, {
      event: 'reserveSong',
      data: {
        videoId: 'abc123',
        title: 'A Little Respect',
        description: 'Karaoke song',
        thumbnails: 'https://example.com/thumb.jpg',
        performer: 'ELVIN',
      },
    });
    const forwardedReserve = (main.emit as jest.Mock).mock.calls.find(([event]) => event === 'reserveSong');
    const route = forwardedReserve?.[1]?.data?.remoteCommandRoute;
    expect(route).toEqual(expect.any(String));

    await gateway.queueError(main, {
      event: 'queueError',
      data: {
        code: 'QUEUE_FULL',
        message: 'Song reserve list is full (15/15).',
        queueCount: 15,
        maxQueueSize: 15,
        remoteCommandRoute: route,
      },
    });

    expect(remote.emit).toHaveBeenCalledWith('queueError', {
      event: 'queueError',
      data: expect.objectContaining({ code: 'QUEUE_FULL', queueCount: 15 }),
    });
    expect(roomEmit).not.toHaveBeenCalledWith('queueError', expect.anything());
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
