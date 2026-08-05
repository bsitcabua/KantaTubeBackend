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
    origin: process.env.FRONTEND_DOMAIN || '*',
    methods: ['GET', 'POST'],
  },
})
export class SearchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SearchGateway.name);

  private readonly shouldLogEvents = process.env.NODE_ENV !== 'production';

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

  private handleEvent(client: Socket, payload: EventPayload, eventName: string): void {
    const visitorID = this.getVisitorID(client);
    if (!visitorID) {
      client.disconnect(true);
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
      this.logger.warn('Rejected a WebSocket connection without a valid visitor ID.');
      client.disconnect(true);
      return;
    }
    client.join(visitorID);
    // this.logger.log(`✅ Client connected: ${client.id} (Guest ID: ${visitorID})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
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
