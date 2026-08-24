import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

type EventPayload = {
  event: string;
  [key: string]: unknown;
};

@Injectable()
// @WebSocketGateway(4202,{ // remove for production 4202
@WebSocketGateway({
  cors: {
    origin: (
      process.env.APP_FRONTEND_URLS ||
      process.env.APP_FRONTEND_URL ||
      'http://localhost:4200'
    )
      .split(',')
      .map((origin) => origin.trim()),
    methods: ['GET', 'POST'],
  },
})
export class SearchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SearchGateway.name);

  private readonly shouldLogEvents = process.env.NODE_ENV !== 'production';
  private readonly mainSocketByVisitor = new Map<string, string>();
  private readonly pendingRemoteBySocket = new Map<string, string>();
  private readonly remoteDeviceBySocket = new Map<string, string>();
  private readonly approvedRemoteSockets = new Set<string>();

  private getVisitorID(client: Socket): string {
    const authVisitorId = client.handshake.auth?.visitorID;
    const queryVisitorId = client.handshake.query.visitorID;
    const visitorId =
      typeof authVisitorId === 'string'
        ? authVisitorId
        : typeof queryVisitorId === 'string'
          ? queryVisitorId
          : '';
    return this.isValidVisitorID(visitorId) ? visitorId : '';
  }

  private handleEvent(
    client: Socket,
    payload: EventPayload,
    eventName: string,
  ): void {
    const visitorID = this.getVisitorID(client);
    if (!visitorID) {
      client.disconnect(true);
      return;
    }

    if (
      this.getClientRole(client) === 'remote' &&
      !this.approvedRemoteSockets.has(client.id)
    ) {
      this.logger.warn(`Rejected ${eventName} from an unapproved remote.`);
      client.emit('remoteConnectionPending', {
        event: 'remoteConnectionPending',
        visitorID,
      });
      return;
    }

    const payloadVisitorID = payload?.visitorID;
    if (
      typeof payloadVisitorID === 'string' &&
      payloadVisitorID !== visitorID
    ) {
      this.logger.warn(`Rejected ${eventName} with a mismatched visitor ID.`);
      return;
    }
    if (this.shouldLogEvents) {
      this.logger.log(`🔄 Guest ${visitorID} handled ${eventName}`);
    }
    this.server.to(visitorID).emit(eventName, { ...payload, visitorID });
  }

  handleConnection(client: Socket): void {
    const visitorID = this.getVisitorID(client);
    if (!visitorID) {
      this.logger.warn(
        'Rejected a WebSocket connection without a valid visitor ID.',
      );
      client.disconnect(true);
      return;
    }
    if (this.getClientRole(client) === 'remote') {
      const deviceId = this.getRemoteDeviceId(client);
      if (!deviceId) {
        this.logger.warn(
          'Rejected a remote connection without a valid device ID.',
        );
        client.disconnect(true);
        return;
      }
      this.pendingRemoteBySocket.set(client.id, visitorID);
      this.remoteDeviceBySocket.set(client.id, deviceId);
      client.emit('remoteConnectionPending', {
        event: 'remoteConnectionPending',
        visitorID,
      });
      this.notifyMainOfPendingRemote(visitorID, client);
      return;
    }

    const existingMain = this.mainSocketByVisitor.get(visitorID);
    if (existingMain && existingMain !== client.id) {
      this.logger.warn(
        `Rejected a duplicate main socket for visitor ${visitorID}.`,
      );
      client.disconnect(true);
      return;
    }
    this.mainSocketByVisitor.set(visitorID, client.id);
    client.join(visitorID);
    this.notifyMainOfAllPendingRemotes(visitorID);
    // this.logger.log(`✅ Client connected: ${client.id} (Guest ID: ${visitorID})`);
  }

  handleDisconnect(client: Socket): void {
    const visitorID = this.getVisitorID(client);
    if (visitorID && this.mainSocketByVisitor.get(visitorID) === client.id) {
      this.mainSocketByVisitor.delete(visitorID);
    }
    this.pendingRemoteBySocket.delete(client.id);
    this.remoteDeviceBySocket.delete(client.id);
    this.approvedRemoteSockets.delete(client.id);
    this.logger.log(`❌ Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('approveRemoteConnection')
  approveRemoteConnection(
    client: Socket,
    payload: { requestId?: string },
  ): void {
    const visitorID = this.getVisitorID(client);
    const requestId = payload?.requestId;
    if (
      !visitorID ||
      !requestId ||
      this.mainSocketByVisitor.get(visitorID) !== client.id ||
      this.pendingRemoteBySocket.get(requestId) !== visitorID
    ) {
      this.logger.warn('Rejected an invalid remote approval request.');
      return;
    }

    const remote = this.server.sockets.sockets.get(requestId);
    if (!remote) {
      this.pendingRemoteBySocket.delete(requestId);
      return;
    }
    this.pendingRemoteBySocket.delete(requestId);
    this.approvedRemoteSockets.add(requestId);
    remote.join(visitorID);
    remote.emit('remoteConnectionApproved', {
      event: 'remoteConnectionApproved',
      visitorID,
    });
  }

  @SubscribeMessage('rejectRemoteConnection')
  rejectRemoteConnection(
    client: Socket,
    payload: { requestId?: string },
  ): void {
    const visitorID = this.getVisitorID(client);
    const requestId = payload?.requestId;
    if (
      !visitorID ||
      !requestId ||
      this.mainSocketByVisitor.get(visitorID) !== client.id ||
      this.pendingRemoteBySocket.get(requestId) !== visitorID
    ) {
      return;
    }
    const remote = this.server.sockets.sockets.get(requestId);
    this.pendingRemoteBySocket.delete(requestId);
    remote?.emit('remoteConnectionRejected', {
      event: 'remoteConnectionRejected',
      visitorID,
    });
    remote?.disconnect(true);
  }

  @SubscribeMessage('revokeAllRemoteConnections')
  revokeAllRemoteConnections(client: Socket): void {
    const visitorID = this.getVisitorID(client);
    if (!visitorID || this.mainSocketByVisitor.get(visitorID) !== client.id) {
      return;
    }

    for (const socketId of [...this.approvedRemoteSockets]) {
      const remote = this.server.sockets.sockets.get(socketId);
      if (!remote || this.getVisitorID(remote) !== visitorID) continue;
      this.approvedRemoteSockets.delete(socketId);
      remote.emit('remoteConnectionRejected', {
        event: 'remoteConnectionRejected',
        visitorID,
      });
      remote.disconnect(true);
    }
  }

  private getClientRole(client: Socket): 'main' | 'remote' {
    return client.handshake.auth?.role === 'remote' ? 'remote' : 'main';
  }

  private notifyMainOfPendingRemote(visitorID: string, remote: Socket): void {
    const mainSocketId = this.mainSocketByVisitor.get(visitorID);
    if (!mainSocketId) return;
    this.server.to(mainSocketId).emit('remoteConnectionRequest', {
      event: 'remoteConnectionRequest',
      visitorID,
      requestId: remote.id,
      deviceId: this.remoteDeviceBySocket.get(remote.id),
      device: this.getRemoteDeviceLabel(remote),
    });
  }

  private notifyMainOfAllPendingRemotes(visitorID: string): void {
    for (const [socketId, pendingVisitorID] of this.pendingRemoteBySocket) {
      if (pendingVisitorID !== visitorID) continue;
      const remote = this.server.sockets.sockets.get(socketId);
      if (remote) this.notifyMainOfPendingRemote(visitorID, remote);
    }
  }

  private getRemoteDeviceLabel(client: Socket): string {
    const userAgent = client.handshake.headers['user-agent'];
    if (typeof userAgent !== 'string') return 'Remote device';
    if (/mobile|android|iphone|ipad/i.test(userAgent)) return 'Mobile remote';
    return 'Browser remote';
  }

  private getRemoteDeviceId(client: Socket): string {
    const deviceId = client.handshake.auth?.deviceId;
    return typeof deviceId === 'string' && this.isValidVisitorID(deviceId)
      ? deviceId.trim()
      : '';
  }

  private isValidVisitorID(visitorID: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      visitorID.trim(),
    );
  }

  // Request events (client to server)
  @SubscribeMessage('getSongReserved')
  async getSongReserved(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'getSongReserved');
  }

  @SubscribeMessage('getPerformers')
  async getPerformers(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'getPerformers');
  }

  @SubscribeMessage('addPerformer')
  async addPerformer(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'addPerformer');
  }

  @SubscribeMessage('removePerformer')
  async removePerformer(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'removePerformer');
  }

  @SubscribeMessage('clearAllPerformers')
  async clearAllPerformers(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'clearAllPerformers');
  }

  @SubscribeMessage('playVideo')
  async playVideo(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'playVideo');
  }

  @SubscribeMessage('pauseVideo')
  async pauseVideo(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'pauseVideo');
  }

  @SubscribeMessage('reserveSong')
  async reserveSong(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'reserveSong');
  }

  @SubscribeMessage('nextSong')
  async nextSong(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'nextSong');
  }

  @SubscribeMessage('stopAllSong')
  async stopAllSong(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'stopAllSong');
  }

  @SubscribeMessage('onSearch')
  async onSearch(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'onSearch');
  }

  @SubscribeMessage('toggleScore')
  async toggleScore(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'toggleScore');
  }

  @SubscribeMessage('toggleThemeMode')
  async toggleThemeMode(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'toggleThemeMode');
  }

  @SubscribeMessage('updatePrimaryColor')
  async updatePrimaryColor(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updatePrimaryColor');
  }

  @SubscribeMessage('updatePresets')
  async updatePresets(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updatePresets');
  }

  @SubscribeMessage('updateMenuMode')
  async updateMenuMode(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updateMenuMode');
  }

  @SubscribeMessage('updateKey')
  async updateKey(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updateKey');
  }

  // Response events (server to client)
  @SubscribeMessage('songReserved')
  async songReserved(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'songReserved');
  }

  @SubscribeMessage('performers')
  async performers(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'performers');
  }

  @SubscribeMessage('videoStatus')
  async videoStatus(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'videoStatus');
  }

  @SubscribeMessage('searchResults')
  async searchResults(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'searchResults');
  }

  @SubscribeMessage('toggleScoreFromMain')
  async toggleScoreFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'toggleScoreFromMain');
  }

  @SubscribeMessage('toggleThemeModeFromMain')
  async toggleThemeModeFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'toggleThemeModeFromMain');
  }

  @SubscribeMessage('updatePrimaryColorFromMain')
  async updatePrimaryColorFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updatePrimaryColorFromMain');
  }

  @SubscribeMessage('updateKeyFromMain')
  async updateKeyFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updateKeyFromMain');
  }

  @SubscribeMessage('updatePresetsFromMain')
  async updatePresetsFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updatePresetsFromMain');
  }

  @SubscribeMessage('updateMenuModeFromMain')
  async updateMenuModeFromMain(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updateMenuModeFromMain');
  }

  @SubscribeMessage('response')
  async response(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'response');
  }
}
