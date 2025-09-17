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

  private getVisitorID(client: Socket): string {
    return (client.handshake.query.visitorID as string) || client.id;
  }

  private handleEvent(client: Socket, payload: EventPayload, eventName: string, shouldLog = false): void {
    const visitorID = this.getVisitorID(client);
    if (shouldLog) {
      this.logger.log(`🔄 Guest ${visitorID} handled ${eventName}`);
    }
    this.server.emit(eventName, { ...payload, visitorID });
  }

  handleConnection(client: Socket): void {
    const visitorID = this.getVisitorID(client);
    client.join(visitorID);
    // this.logger.log(`✅ Client connected: ${client.id} (Guest ID: ${visitorID})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
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

  @SubscribeMessage('updateKey')
  async updateKey(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'updateKey');
  }

  // Response events (server to client)
  @SubscribeMessage('songReserved')
  async songReserved(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'songReserved', true);
  }

  @SubscribeMessage('performers')
  async performers(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'performers', true);
  }

  @SubscribeMessage('videoStatus')
  async videoStatus(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'videoStatus', true);
  }

  @SubscribeMessage('searchResults')
  async searchResults(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'searchResults', true);
  }

  @SubscribeMessage('response')
  async response(client: Socket, payload: EventPayload) {
    this.handleEvent(client, payload, 'response', true);
  }
}