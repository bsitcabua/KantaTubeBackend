import { Server, Socket } from 'socket.io';
import { SearchGateway } from './search.gateway';

describe('SearchGateway', () => {
  const visitorId = '123e4567-e89b-42d3-a456-426614174000';
  let gateway: SearchGateway;
  let roomEmit: jest.Mock;
  let toRoom: jest.Mock;

  beforeEach(() => {
    gateway = new SearchGateway();
    roomEmit = jest.fn();
    toRoom = jest.fn(() => ({ emit: roomEmit }));
    gateway.server = { to: toRoom } as unknown as Server;
  });

  function createClient(authVisitorId = visitorId): Socket {
    return {
      id: 'socket-id',
      handshake: {
        auth: { visitorID: authVisitorId },
        query: {},
      },
      join: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
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
});
