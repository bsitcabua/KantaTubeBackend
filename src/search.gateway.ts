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
@WebSocketGateway(4202, {
  cors: {
    origin: '*', // Change this to match your frontend domain
    methods: ['GET', 'POST'],
  },
})
export class SearchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SearchGateway.name);

  /**
   * Retrieves the visitor ID from the client's handshake query or defaults to the socket ID.
   * @param client The connected socket client
   * @returns The visitor ID
   */
  private getVisitorID(client: Socket): string {
    return (client.handshake.query.visitorID as string) || client.id;
  }

  /**
   * Handles new client connections.
   * @param client The connected socket client
   */
  handleConnection(client: Socket) {
    const visitorID = this.getVisitorID(client);
    client.join(visitorID); // Join the room named after visitorID
    this.logger.log(`✅ Client connected: ${client.id} (Guest ID: ${visitorID})`);
  }

  /**
   * Handles client disconnections.
   * @param client The disconnected socket client
   */
  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
  }

  /**
   * Handles requests to get reserved songs.
   * @param client The socket client
   * @param payload Contains request details
   */
  @SubscribeMessage('getSongReserved')
  async getSongReserved(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} requested getSongReserved`);
    // Include visitorID in the payload before emitting
    this.server.to(visitorID).emit('getSongReserved', { ...payload, visitorID });
  }


  /**
   * Handles requests to get reserved songs.
   * @param client The socket client
   * @param payload Contains request details
   */
  @SubscribeMessage('reserveSong')
  async reserveSong(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} requested reserveSong`);
    // Include visitorID in the payload before emitting
    this.server.to(visitorID).emit('reserveSong', { ...payload, visitorID });
  }


  /**
 * Handles requests to get reserved songs.
 * @param client The socket client
 * @param payload Contains request details
 */
  @SubscribeMessage('nextSong')
  async nextSong(client: Socket, payload: { event: string }) {
    const visitorID = this.getVisitorID(client);
    this.logger.log(`🔄 Guest ${visitorID} requested nextSong`);
    // Include visitorID in the payload before emitting
    this.server.to(visitorID).emit('nextSong', { ...payload, visitorID });
  }

    /**
 * Handles requests to get reserved songs.
 * @param client The socket client
 * @param payload Contains request details
 */
    @SubscribeMessage('stopAllSong')
    async stopAllSong(client: Socket, payload: { event: string }) {
      const visitorID = this.getVisitorID(client);
      this.logger.log(`🔄 Guest ${visitorID} requested stopAllSong`);
      // Include visitorID in the payload before emitting
      this.server.to(visitorID).emit('stopAllSong', { ...payload, visitorID });
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
    this.server.to(visitorID).emit('songReserved', { ...payload, visitorID });
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
    this.server.to(visitorID).emit('videoStatus', { ...payload, visitorID });
  }
}
