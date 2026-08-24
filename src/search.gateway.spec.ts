import { Server, Socket } from 'socket.io';
import { SearchGateway } from './search.gateway';

describe('SearchGateway', () => {
  const visitorId = '123e4567-e89b-42d3-a456-426614174000';
  let gateway: SearchGateway;
  let roomEmit: jest.Mock;
  let toRoom: jest.Mock;
  let sockets: Map<string, Socket>;

  beforeEach(() => {
    gateway = new SearchGateway();
    roomEmit = jest.fn();
    toRoom = jest.fn(() => ({ emit: roomEmit }));
    sockets = new Map<string, Socket>();
    gateway.server = { to: toRoom, sockets: { sockets } } as unknown as Server;
  });

  function createClient(
    authVisitorId = visitorId,
    role: 'main' | 'remote' = 'main',
    id = 'socket-id',
  ): Socket {
    const client = {
      id,
      handshake: {
        auth: {
          visitorID: authVisitorId,
          role,
          ...(role === 'remote' ? { deviceId: visitorId } : {}),
        },
        query: {},
        headers: {},
      },
      join: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
    } as unknown as Socket;
    sockets.set(id, client);
    return client;
  }

  it('joins a valid visitor room and emits only to that room', async () => {
    const client = createClient();

    gateway.handleConnection(client);
    await gateway.onSearch(client, {
      event: 'onSearch',
      visitorID: visitorId,
      data: { search: 'test' },
    });

    expect(client.join).toHaveBeenCalledWith(visitorId);
    expect(toRoom).toHaveBeenCalledWith(visitorId);
    expect(roomEmit).toHaveBeenCalledWith(
      'onSearch',
      expect.objectContaining({ visitorID: visitorId }),
    );
  });

  it('rejects an event whose payload visitor ID does not match the socket', async () => {
    const client = createClient();

    await gateway.onSearch(client, {
      event: 'onSearch',
      visitorID: '123e4567-e89b-42d3-a456-426614174001',
    });

    expect(toRoom).not.toHaveBeenCalled();
  });

  it('disconnects sockets without a valid UUID visitor ID', () => {
    const client = createClient('legacy123');

    gateway.handleConnection(client);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('keeps a remote pending and blocks its events until the main approves it', async () => {
    const main = createClient(visitorId, 'main', 'main-socket');
    const remote = createClient(visitorId, 'remote', 'remote-socket');

    gateway.handleConnection(main);
    gateway.handleConnection(remote);
    await gateway.onSearch(remote, {
      event: 'onSearch',
      visitorID: visitorId,
    });

    expect(remote.join).not.toHaveBeenCalled();
    expect(toRoom).toHaveBeenCalledWith('main-socket');
    expect(roomEmit).toHaveBeenCalledWith(
      'remoteConnectionRequest',
      expect.objectContaining({
        requestId: 'remote-socket',
        deviceId: visitorId,
      }),
    );
    expect(roomEmit).not.toHaveBeenCalledWith('onSearch', expect.anything());

    gateway.approveRemoteConnection(main, { requestId: 'remote-socket' });
    await gateway.onSearch(remote, {
      event: 'onSearch',
      visitorID: visitorId,
    });

    expect(remote.join).toHaveBeenCalledWith(visitorId);
    expect(remote.emit).toHaveBeenCalledWith(
      'remoteConnectionApproved',
      expect.objectContaining({ visitorID: visitorId }),
    );
    expect(roomEmit).toHaveBeenCalledWith(
      'onSearch',
      expect.objectContaining({ visitorID: visitorId }),
    );

    roomEmit.mockClear();
    gateway.revokeAllRemoteConnections(main);
    await gateway.onSearch(remote, {
      event: 'onSearch',
      visitorID: visitorId,
    });

    expect(remote.emit).toHaveBeenCalledWith(
      'remoteConnectionRejected',
      expect.objectContaining({ visitorID: visitorId }),
    );
    expect(remote.disconnect).toHaveBeenCalledWith(true);
    expect(roomEmit).not.toHaveBeenCalledWith('onSearch', expect.anything());
  });
});
