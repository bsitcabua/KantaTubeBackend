import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@Injectable()
@WebSocketGateway(4202,{ // remove for production 4202
// @WebSocketGateway({
  cors: {
    origin: '*', // Change this to match your frontend domain
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

  handleConnection(client: Socket) {
    const visitorID = this.getVisitorID(client);
    client.join(visitorID); // Join the room named after visitorID
    // this.logger.log(`✅ Client connected: ${client.id} (Guest ID: ${visitorID})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('getSongReserved')
  async getSongReserved(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    // this.logger.log(`🔄 Guest ${visitorID} requested getSongReserved`);
    // Include visitorID in the payload before emitting
    this.server.emit('getSongReserved', { ...payload, visitorID });
  }

  @SubscribeMessage('reserveSong')
  async reserveSong(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    // this.logger.log(`🔄 Guest ${visitorID} requested reserveSong`);
    this.server.emit('reserveSong', { ...payload, visitorID });
  }

  @SubscribeMessage('nextSong')
  async nextSong(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    // this.logger.log(`🔄 Guest ${visitorID} requested nextSong`);
    this.server.emit('nextSong', { ...payload, visitorID });
  }

  @SubscribeMessage('stopAllSong')
  async stopAllSong(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    // this.logger.log(`🔄 Guest ${visitorID} requested stopAllSong`);
    this.server.emit('stopAllSong', { ...payload, visitorID });
  }

  @SubscribeMessage('onSearch')
  async onSearch(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    // this.logger.log(`🔄 Guest ${visitorID} requested onSearch`);
    this.server.emit('onSearch', { ...payload, visitorID });
  }

  // =======================================================================================

  /**
   * Handles song reservation events.
   * @param client The socket client
   * @param payload Contains reservation details
   */
  @SubscribeMessage('songReserved')
  async songReserved(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} sent songReserved`);
    this.server.emit('songReserved', { ...payload, visitorID });
  }

  /**
   * Handles song reservation events.
   * @param client The socket client
   * @param payload Contains reservation details
   */
  @SubscribeMessage('videoStatus')
  async videoStatus(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} sent videoStatus`);
    this.server.emit('videoStatus', { ...payload, visitorID });
  }

  @SubscribeMessage('searchResults')
  async searchResults(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} sent searchResults`);
    this.server.emit('searchResults', { ...payload, visitorID });
  }
}
