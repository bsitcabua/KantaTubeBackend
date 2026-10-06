import { Optional, Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from './modules/auth/auth.service';
import {
  RemoteAuthorizationService,
  RemoteSessionKind,
} from './modules/karaoke/remote-authorization.service';
import { RateLimiterService } from './common/rate-limit/rate-limiter.service';
import {
  MAIN_RESPONSE_EVENTS,
  REMOTE_COMMAND_EVENTS,
  RemoteCommandEvent,
  SocketEnvelope,
  SocketErrorCode,
} from './realtime/socket-contracts';

interface MainContext {
  kind: 'main';
  sessionId: string;
  sessionKind: RemoteSessionKind;
  ownerId?: string;
}

interface RemoteContext {
  kind: 'remote';
  sessionId: string;
  sessionKind: RemoteSessionKind;
  deviceId: string;
  grantId: string;
  state: 'pending' | 'approved';
}

type SocketContext = MainContext | RemoteContext;
type UnknownRecord = Record<string, unknown>;

interface SocketAck {
  ok: boolean;
  error?: { code: SocketErrorCode; message: string };
}

@Injectable()
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
    credentials: true,
  },
  maxHttpBufferSize: 512 * 1024,
})
export class SearchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SearchGateway.name);
  private readonly mainSocketBySession = new Map<string, string>();
  private readonly roomPrefix = 'karaoke:';
  private readonly removeInvalidationListener?: () => void;

  constructor(
    @Optional() private readonly auth?: AuthService,
    @Optional()
    private readonly remoteAuthorization?: RemoteAuthorizationService,
    @Optional() private readonly rateLimiter?: RateLimiterService,
  ) {
    this.removeInvalidationListener =
      this.remoteAuthorization?.onSessionInvalidated?.(
        (sessionId, sessionKind) =>
          this.handleSessionInvalidated(sessionId, sessionKind),
      );
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = this.handshakeAuth(client);
      const sessionId = this.stringValue(auth.sessionId, 64);
      const deviceId = this.stringValue(auth.deviceId, 36);
      const pairingToken = this.stringValue(auth.pairingToken, 256);
      const grantToken = this.stringValue(auth.grantToken, 256);
      const hostToken = this.stringValue(auth.hostToken, 256);

      if (pairingToken && deviceId) {
        if (!this.isUuid(deviceId))
          throw this.socketException(
            'REMOTE_NOT_AUTHORIZED',
            'Remote device identity is invalid.',
          );
        await this.connectPendingRemote(client, pairingToken, deviceId);
        return;
      }
      if (grantToken && sessionId && deviceId) {
        if (!this.isUuid(deviceId))
          throw this.socketException(
            'REMOTE_NOT_AUTHORIZED',
            'Remote device identity is invalid.',
          );
        await this.connectApprovedRemote(
          client,
          sessionId,
          deviceId,
          grantToken,
        );
        return;
      }
      if (hostToken && sessionId) {
        await this.connectGuestMain(client, sessionId, hostToken);
        return;
      }
      await this.connectMain(client, sessionId);
    } catch (error) {
      const socketError = this.errorPayload(error);
      this.logger.warn(`Rejected socket connection: ${socketError.code}`);
      client.emit('socketError', socketError);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const context = this.context(client);
    if (!context) return;
    if (
      context.kind === 'main' &&
      this.mainSocketBySession.get(this.sessionKey(context)) === client.id
    ) {
      this.mainSocketBySession.delete(this.sessionKey(context));
      this.server
        ?.to(this.room(context.sessionId, context.sessionKind))
        .emit('mainClientStatus', { status: 'offline' });
    }
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  onModuleDestroy(): void {
    this.removeInvalidationListener?.();
  }

  private handleSessionInvalidated(
    sessionId: string,
    sessionKind: RemoteSessionKind,
  ): void {
    const mainId = this.mainSocketBySession.get(
      this.sessionKey(sessionId, sessionKind),
    );
    const main = mainId
      ? this.server?.sockets?.sockets?.get(mainId)
      : undefined;
    for (const remote of this.connectedRemotes(sessionId, sessionKind)) {
      remote.emit('remoteSessionEnded', { sessionId });
      remote.disconnect(true);
    }
    main?.emit('remoteSessionEnded', { sessionId });
    this.mainSocketBySession.delete(this.sessionKey(sessionId, sessionKind));
    this.server
      ?.to(this.room(sessionId, sessionKind))
      .emit('mainClientStatus', { status: 'offline' });
    main?.disconnect(true);
  }

  @SubscribeMessage('approveRemoteConnection')
  async approveRemoteConnection(
    client: Socket,
    payload: UnknownRecord,
  ): Promise<SocketAck> {
    const context = this.requireMain(client);
    if (!context)
      return this.fail(
        client,
        'REMOTE_NOT_AUTHORIZED',
        'Only the main client can approve a remote.',
      );
    const requestId = this.requestId(payload);
    if (!requestId)
      return this.fail(
        client,
        'INVALID_PAYLOAD',
        'A valid pairing request is required.',
      );
    try {
      const approved = await this.authorization().approveRemote(
        context.sessionId,
        requestId,
        context.sessionKind,
      );
      const remote = this.findRemoteByGrant(requestId);
      if (!remote)
        return this.fail(
          client,
          'REMOTE_NOT_AUTHORIZED',
          'The remote is no longer connected.',
        );
      remote.data.kantaTube = {
        kind: 'remote',
        sessionId: context.sessionId,
        sessionKind: context.sessionKind,
        deviceId: approved.grant.deviceId,
        grantId: approved.grant.id,
        state: 'approved',
      } satisfies RemoteContext;
      await remote.join(this.room(context.sessionId, context.sessionKind));
      remote.emit('remoteConnectionApproved', {
        sessionId: context.sessionId,
        grantToken: approved.grantToken,
      });
      remote.emit('mainClientStatus', {
        status: this.mainSocketBySession.has(this.sessionKey(context))
          ? 'online'
          : 'offline',
      });
      this.logger.log(`Remote ${requestId.slice(0, 8)} approved`);
      return { ok: true };
    } catch (error) {
      return this.fail(client, ...this.errorTuple(error));
    }
  }

  @SubscribeMessage('rejectRemoteConnection')
  async rejectRemoteConnection(
    client: Socket,
    payload: UnknownRecord,
  ): Promise<SocketAck> {
    const context = this.requireMain(client);
    if (!context)
      return this.fail(
        client,
        'REMOTE_NOT_AUTHORIZED',
        'Only the main client can reject a remote.',
      );
    const requestId = this.requestId(payload);
    if (!requestId)
      return this.fail(
        client,
        'INVALID_PAYLOAD',
        'A valid pairing request is required.',
      );
    try {
      await this.authorization().rejectRemote(
        context.sessionId,
        requestId,
        context.sessionKind,
      );
      const remote = this.findRemoteByGrant(requestId);
      remote?.emit('remoteConnectionRejected', {
        sessionId: context.sessionId,
      });
      remote?.disconnect(true);
      return { ok: true };
    } catch (error) {
      return this.fail(client, ...this.errorTuple(error));
    }
  }

  @SubscribeMessage('revokeAllRemoteConnections')
  async revokeAllRemoteConnections(client: Socket): Promise<SocketAck> {
    const context = this.requireMain(client);
    if (!context)
      return this.fail(
        client,
        'REMOTE_NOT_AUTHORIZED',
        'Only the main client can revoke remotes.',
      );
    try {
      await this.authorization().revokeAll(
        context.sessionId,
        context.sessionKind,
      );
      for (const remote of this.connectedRemotes(
        context.sessionId,
        context.sessionKind,
      )) {
        remote.emit('remoteConnectionRevoked', {
          sessionId: context.sessionId,
        });
        remote.disconnect(true);
      }
      return { ok: true };
    } catch (error) {
      return this.fail(client, ...this.errorTuple(error));
    }
  }

  @SubscribeMessage('getSongReserved')
  getSongReserved(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'getSongReserved', payload);
  }
  @SubscribeMessage('reserveSong')
  reserveSong(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'reserveSong', payload);
  }
  @SubscribeMessage('nextSong')
  nextSong(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'nextSong', payload);
  }
  @SubscribeMessage('stopAllSong')
  stopAllSong(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'stopAllSong', payload);
  }
  @SubscribeMessage('onSearch')
  onSearch(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'onSearch', payload);
  }
  @SubscribeMessage('getPerformers')
  getPerformers(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'getPerformers', payload);
  }
  @SubscribeMessage('addPerformer')
  addPerformer(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'addPerformer', payload);
  }
  @SubscribeMessage('removePerformer')
  removePerformer(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'removePerformer', payload);
  }
  @SubscribeMessage('clearAllPerformers')
  clearAllPerformers(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'clearAllPerformers', payload);
  }
  @SubscribeMessage('pauseVideo')
  pauseVideo(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'pauseVideo', payload);
  }
  @SubscribeMessage('playVideo')
  playVideo(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'playVideo', payload);
  }
  @SubscribeMessage('toggleScore')
  toggleScore(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'toggleScore', payload);
  }
  @SubscribeMessage('toggleThemeMode')
  toggleThemeMode(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'toggleThemeMode', payload);
  }
  @SubscribeMessage('updatePrimaryColor')
  updatePrimaryColor(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'updatePrimaryColor', payload);
  }
  @SubscribeMessage('updateKey')
  updateKey(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'updateKey', payload);
  }
  @SubscribeMessage('updatePresets')
  updatePresets(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'updatePresets', payload);
  }
  @SubscribeMessage('updateMenuMode')
  updateMenuMode(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleRemoteCommand(client, 'updateMenuMode', payload);
  }

  @SubscribeMessage('songReserved')
  songReserved(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleMainResponse(client, 'songReserved', payload);
  }
  @SubscribeMessage('videoStatus')
  videoStatus(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleMainResponse(client, 'videoStatus', payload);
  }
  @SubscribeMessage('searchResults')
  searchResults(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleMainResponse(client, 'searchResults', payload);
  }
  @SubscribeMessage('performers')
  performers(client: Socket, payload: SocketEnvelope): Promise<SocketAck> {
    return this.handleMainResponse(client, 'performers', payload);
  }
  @SubscribeMessage('toggleScoreFromMain')
  toggleScoreFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(client, 'toggleScoreFromMain', payload);
  }
  @SubscribeMessage('toggleThemeModeFromMain')
  toggleThemeModeFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(client, 'toggleThemeModeFromMain', payload);
  }
  @SubscribeMessage('updatePrimaryColorFromMain')
  updatePrimaryColorFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(
      client,
      'updatePrimaryColorFromMain',
      payload,
    );
  }
  @SubscribeMessage('updateKeyFromMain')
  updateKeyFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(client, 'updateKeyFromMain', payload);
  }
  @SubscribeMessage('updatePresetsFromMain')
  updatePresetsFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(client, 'updatePresetsFromMain', payload);
  }
  @SubscribeMessage('updateMenuModeFromMain')
  updateMenuModeFromMain(
    client: Socket,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    return this.handleMainResponse(client, 'updateMenuModeFromMain', payload);
  }

  private async connectMain(client: Socket, sessionId: string): Promise<void> {
    const auth = this.authService();
    const user = await auth.authenticate(
      this.readCookie(client, auth.cookieName),
    );
    if (!user || !sessionId)
      throw this.socketException(
        'SESSION_NOT_FOUND',
        'A valid karaoke session is required.',
      );
    await this.authorization().findActiveSession(user.id, sessionId);
    const context: MainContext = {
      kind: 'main',
      sessionId,
      sessionKind: 'karaoke',
      ownerId: user.id,
    };
    const existingId = this.mainSocketBySession.get(this.sessionKey(context));
    if (existingId && existingId !== client.id) {
      const existing = this.server.sockets.sockets.get(existingId);
      existing?.emit('socketError', {
        code: 'DUPLICATE_MAIN_CLIENT',
        message: 'This karaoke session is active in another main tab.',
      });
      existing?.disconnect(true);
    }
    client.data.kantaTube = context;
    this.mainSocketBySession.set(this.sessionKey(context), client.id);
    await client.join(this.room(sessionId, 'karaoke'));
    this.server
      .to(this.room(sessionId, 'karaoke'))
      .emit('mainClientStatus', { status: 'online' });
    this.notifyPendingRemotes(sessionId, 'karaoke', client);
  }

  private async connectGuestMain(
    client: Socket,
    sessionId: string,
    hostToken: string,
  ): Promise<void> {
    await this.authorization().authorizeGuestHost(sessionId, hostToken);
    const context: MainContext = {
      kind: 'main',
      sessionId,
      sessionKind: 'guest',
    };
    const existingId = this.mainSocketBySession.get(this.sessionKey(context));
    if (existingId && existingId !== client.id) {
      const existing = this.server.sockets.sockets.get(existingId);
      existing?.emit('socketError', {
        code: 'DUPLICATE_MAIN_CLIENT',
        message:
          'This anonymous karaoke session is active in another main tab.',
      });
      existing?.disconnect(true);
    }
    client.data.kantaTube = context;
    this.mainSocketBySession.set(this.sessionKey(context), client.id);
    await client.join(this.room(sessionId, 'guest'));
    this.server
      .to(this.room(sessionId, 'guest'))
      .emit('mainClientStatus', { status: 'online' });
    this.notifyPendingRemotes(sessionId, 'guest', client);
  }

  private async connectPendingRemote(
    client: Socket,
    pairingToken: string,
    deviceId: string,
  ): Promise<void> {
    const pending = await this.authorization().createPendingRemote(
      pairingToken,
      deviceId,
      this.deviceLabel(client),
    );
    this.disconnectDuplicateRemote(
      client,
      deviceId,
      pending.sessionId,
      pending.sessionKind,
    );
    client.data.kantaTube = {
      kind: 'remote',
      sessionId: pending.sessionId,
      sessionKind: pending.sessionKind,
      deviceId,
      grantId: pending.grant.id,
      state: 'pending',
    } satisfies RemoteContext;
    client.emit('remoteConnectionPending', {
      sessionId: pending.sessionId,
      requestId: pending.grant.id,
    });
    const mainId = this.mainSocketBySession.get(
      this.sessionKey(pending.sessionId, pending.sessionKind),
    );
    if (mainId)
      this.notifyPendingRemote(this.server.sockets.sockets.get(mainId), client);
  }

  private async connectApprovedRemote(
    client: Socket,
    sessionId: string,
    deviceId: string,
    grantToken: string,
  ): Promise<void> {
    const grant = await this.authorization().authorizeGrant(
      sessionId,
      deviceId,
      grantToken,
    );
    const sessionKind: RemoteSessionKind = grant.remoteHostSessionId
      ? 'guest'
      : 'karaoke';
    this.disconnectDuplicateRemote(client, deviceId, sessionId, sessionKind);
    client.data.kantaTube = {
      kind: 'remote',
      sessionId,
      sessionKind,
      deviceId,
      grantId: grant.id,
      state: 'approved',
    } satisfies RemoteContext;
    await client.join(this.room(sessionId, sessionKind));
    client.emit('remoteConnectionApproved', { sessionId });
    client.emit('mainClientStatus', {
      status: this.mainSocketBySession.has(
        this.sessionKey(sessionId, sessionKind),
      )
        ? 'online'
        : 'offline',
    });
  }

  private async handleRemoteCommand(
    client: Socket,
    eventName: RemoteCommandEvent,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    const context = this.context(client);
    if (!context || context.kind !== 'remote')
      return this.fail(
        client,
        'REMOTE_NOT_AUTHORIZED',
        'Only an approved remote can send this command.',
      );
    if (context.state !== 'approved')
      return this.fail(
        client,
        'REMOTE_PENDING',
        'Remote device approval is still pending.',
      );
    const validation = this.validateEnvelope(payload, eventName);
    if ('message' in validation)
      return this.fail(client, 'INVALID_PAYLOAD', validation.message);
    if (
      !this.rateLimiter?.allowSocketEvent(
        `${context.deviceId}:${context.sessionId}`,
        eventName,
      )
    )
      return this.fail(
        client,
        'RATE_LIMITED',
        'Too many remote commands. Please slow down.',
      );
    try {
      await this.authorization().assertGrantActive(
        context.sessionId,
        context.deviceId,
        context.grantId,
        context.sessionKind,
      );
    } catch (error) {
      return this.fail(client, ...this.errorTuple(error));
    }
    const mainId = this.mainSocketBySession.get(this.sessionKey(context));
    const main = mainId ? this.server.sockets.sockets.get(mainId) : undefined;
    if (!main || this.context(main)?.kind !== 'main')
      return this.fail(
        client,
        'MAIN_CLIENT_OFFLINE',
        'The main karaoke screen is offline.',
      );
    main.emit(eventName, { event: eventName, data: validation.data });
    return { ok: true };
  }

  private handleMainResponse(
    client: Socket,
    eventName: string,
    payload: SocketEnvelope,
  ): Promise<SocketAck> {
    const context = this.context(client);
    if (!context || context.kind !== 'main')
      return Promise.resolve(
        this.fail(
          client,
          'REMOTE_NOT_AUTHORIZED',
          'Only the main client can publish responses.',
        ),
      );
    if (!(MAIN_RESPONSE_EVENTS as readonly string[]).includes(eventName))
      return Promise.resolve(
        this.fail(client, 'INVALID_PAYLOAD', 'Unknown socket response event.'),
      );
    const validation = this.validateEnvelope(payload, eventName);
    if ('message' in validation)
      return Promise.resolve(
        this.fail(client, 'INVALID_PAYLOAD', validation.message),
      );
    this.server
      .to(this.room(context.sessionId, context.sessionKind))
      .emit(eventName, { event: eventName, data: validation.data });
    return Promise.resolve({ ok: true });
  }

  private validateEnvelope(
    payload: SocketEnvelope,
    eventName: string,
  ): { ok: true; data: unknown } | { ok: false; message: string } {
    if (!this.isRecord(payload) || payload.event !== eventName)
      return { ok: false, message: 'The socket event envelope is invalid.' };
    if (Object.keys(payload).some((key) => !['event', 'data'].includes(key)))
      return {
        ok: false,
        message: 'Socket payload contains unsupported fields.',
      };
    const data = payload.data;
    if (data !== undefined && this.jsonSize(data) > 400 * 1024)
      return { ok: false, message: 'Socket payload is too large.' };
    if (
      REMOTE_COMMAND_EVENTS.includes(eventName as RemoteCommandEvent) &&
      !this.validCommandData(eventName, data)
    )
      return {
        ok: false,
        message: 'Socket payload does not match the event contract.',
      };
    if (
      MAIN_RESPONSE_EVENTS.includes(
        eventName as (typeof MAIN_RESPONSE_EVENTS)[number],
      ) &&
      !this.validResponseData(eventName, data)
    )
      return {
        ok: false,
        message: 'Socket response does not match the event contract.',
      };
    return { ok: true, data };
  }

  private validCommandData(eventName: string, data: unknown): boolean {
    if (['getSongReserved', 'getPerformers'].includes(eventName))
      return data === undefined || data === null;
    if (eventName === 'clearAllPerformers')
      return this.validCommandOptions(data);
    if (
      ['nextSong', 'stopAllSong', 'playVideo', 'pauseVideo'].includes(eventName)
    )
      return this.validCommandOptions(data);
    if (eventName === 'onSearch')
      return this.stringField(data, 'search', 200) !== null;
    if (['addPerformer', 'removePerformer'].includes(eventName)) {
      const record = this.recordField(data);
      return record
        ? Object.keys(record).every((key) =>
            ['name'].includes(key),
          ) && this.stringValue(record.name, 60) !== ''
        : this.stringValue(data, 60) !== '';
    }
    if (eventName === 'toggleThemeMode') return typeof data === 'boolean';
    if (eventName === 'toggleScore')
      return this.booleanField(data, 'checked') !== null;
    if (eventName === 'reserveSong') return this.validSong(data);
    if (eventName === 'updateKey')
      return this.stringField(data, 'selectedKey', 120) !== null;
    if (eventName === 'updateMenuMode')
      return ['static', 'overlay'].includes(
        this.stringField(data, 'menuMode', 20) || '',
      );
    if (eventName === 'updatePresets')
      return this.stringField(data, 'presetEvent', 80) !== null;
    if (eventName === 'updatePrimaryColor') {
      const record = this.recordField(data);
      return (
        !!record &&
        ['primary', 'surface'].includes(this.stringValue(record.type, 20)) &&
        !!this.recordField(record.color)
      );
    }
    return false;
  }

  private validCommandOptions(data: unknown): boolean {
    if (data === undefined || data === null) return true;
    const record = this.recordField(data);
    if (!record) return false;
    return (
      Object.keys(record).every((key) =>
        ['currentVideoId'].includes(key),
      ) &&
      (record.currentVideoId === undefined ||
        this.stringValue(record.currentVideoId, 20) !== '')
    );
  }

  private validResponseData(eventName: string, data: unknown): boolean {
    if (eventName === 'videoStatus')
      return this.stringField(data, 'videoStatus', 30) !== null;
    if (eventName === 'performers') {
      const performers = this.recordField(data)?.performers;
      return (
        Array.isArray(performers) &&
        performers.length <= 100 &&
        performers.every((value) => this.stringValue(value, 60) !== '')
      );
    }
    if (eventName === 'searchResults') {
      const results = this.recordField(data)?.searchResults;
      return Array.isArray(results) && results.length <= 200;
    }
    if (eventName === 'songReserved') return !!this.recordField(data);
    if (eventName === 'toggleThemeModeFromMain')
      return typeof data === 'boolean';
    if (eventName === 'toggleScoreFromMain')
      return this.booleanField(data, 'checked') !== null;
    if (eventName === 'updateKeyFromMain')
      return this.stringField(data, 'selectedKey', 120) !== null;
    if (eventName === 'updateMenuModeFromMain')
      return ['static', 'overlay'].includes(
        this.stringField(data, 'menuMode', 20) || '',
      );
    if (eventName === 'updatePresetsFromMain')
      return this.stringField(data, 'presetEvent', 80) !== null;
    if (eventName === 'updatePrimaryColorFromMain')
      return !!this.recordField(data);
    return false;
  }

  private validSong(value: unknown): boolean {
    const song = this.recordField(value);
    return (
      !!song &&
      /^[A-Za-z0-9_-]{6,20}$/.test(this.stringValue(song.videoId, 20)) &&
      this.stringField(song, 'title', 200) !== null &&
      this.stringField(song, 'description', 2_000) !== null &&
      /^https?:\/\//i.test(this.stringValue(song.thumbnails, 2_048)) &&
      this.stringField(song, 'performer', 60) !== null
    );
  }

  private requireMain(client: Socket): MainContext | null {
    const context = this.context(client);
    return context?.kind === 'main' ? context : null;
  }

  private findRemoteByGrant(grantId: string): Socket | undefined {
    return [...(this.server?.sockets?.sockets?.values() ?? [])].find(
      (socket) => {
        const context = this.context(socket);
        return context?.kind === 'remote' && context.grantId === grantId;
      },
    );
  }

  private connectedRemotes(
    sessionId: string,
    sessionKind: RemoteSessionKind,
  ): Socket[] {
    return [...(this.server?.sockets?.sockets?.values() ?? [])].filter(
      (socket) => {
        const context = this.context(socket);
        return (
          context?.kind === 'remote' &&
          context.sessionId === sessionId &&
          context.sessionKind === sessionKind
        );
      },
    );
  }

  private notifyPendingRemotes(
    sessionId: string,
    sessionKind: RemoteSessionKind,
    main?: Socket,
  ): void {
    if (!main) return;
    for (const socket of this.server?.sockets?.sockets?.values() ?? []) {
      const context = this.context(socket);
      if (
        context?.kind !== 'remote' ||
        context.sessionId !== sessionId ||
        context.sessionKind !== sessionKind ||
        context.state !== 'pending'
      )
        continue;
      this.notifyPendingRemote(main, socket);
    }
  }

  private notifyPendingRemote(main?: Socket, remote?: Socket): void {
    if (!main || !remote) return;
    const context = this.context(remote);
    if (!context || context.kind !== 'remote') return;
    main.emit('remoteConnectionRequest', {
      requestId: context.grantId,
      deviceId: context.deviceId,
      device: this.deviceLabel(remote),
    });
  }

  private disconnectDuplicateRemote(
    client: Socket,
    deviceId: string,
    sessionId?: string,
    sessionKind?: RemoteSessionKind,
  ): void {
    for (const socket of this.server?.sockets?.sockets?.values() ?? []) {
      if (socket.id === client.id) continue;
      const context = this.context(socket);
      if (
        context?.kind === 'remote' &&
        context.deviceId === deviceId &&
        (!sessionId || context.sessionId === sessionId) &&
        (!sessionKind || context.sessionKind === sessionKind)
      ) {
        socket.emit('remoteConnectionRevoked', {
          message: 'This remote device connected in another tab.',
        });
        socket.disconnect(true);
      }
    }
  }

  private context(client: Socket): SocketContext | undefined {
    return client.data?.kantaTube as SocketContext | undefined;
  }

  private handshakeAuth(client: Socket): UnknownRecord {
    return this.isRecord(client.handshake.auth) ? client.handshake.auth : {};
  }

  private readCookie(client: Socket, name: string): string | undefined {
    const raw = client.handshake.headers?.cookie;
    if (typeof raw !== 'string') return undefined;
    for (const item of raw.split(';')) {
      const separator = item.indexOf('=');
      if (separator >= 0 && item.slice(0, separator).trim() === name)
        return decodeURIComponent(item.slice(separator + 1).trim());
    }
    return undefined;
  }

  private deviceLabel(client: Socket): string {
    const userAgent = client.handshake.headers?.['user-agent'];
    if (typeof userAgent !== 'string') return 'Remote device';
    return /mobile|android|iphone|ipad/i.test(userAgent)
      ? 'Mobile remote'
      : 'Browser remote';
  }

  private room(sessionId: string, sessionKind: RemoteSessionKind): string {
    return `${this.roomPrefix}${sessionKind}:${sessionId}`;
  }

  private sessionKey(
    contextOrSessionId:
      | Pick<SocketContext, 'sessionId' | 'sessionKind'>
      | string,
    sessionKind?: RemoteSessionKind,
  ): string {
    const sessionId =
      typeof contextOrSessionId === 'string'
        ? contextOrSessionId
        : contextOrSessionId.sessionId;
    const kind =
      typeof contextOrSessionId === 'string'
        ? sessionKind || 'karaoke'
        : contextOrSessionId.sessionKind;
    return `${kind}:${sessionId}`;
  }
  private requestId(payload: UnknownRecord): string {
    return this.stringValue(payload?.requestId, 64);
  }
  private stringValue(value: unknown, max: number): string {
    return typeof value === 'string' && value.trim().length <= max
      ? value.trim()
      : '';
  }
  private stringField(
    value: unknown,
    field: string,
    max: number,
  ): string | null {
    const result = this.stringValue(this.recordField(value)?.[field], max);
    return result || null;
  }
  private booleanField(value: unknown, field: string): boolean | null {
    const fieldValue = this.recordField(value)?.[field];
    return typeof fieldValue === 'boolean' ? fieldValue : null;
  }
  private recordField(value: unknown): UnknownRecord | null {
    return this.isRecord(value) ? value : null;
  }
  private isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  private jsonSize(value: unknown): number {
    try {
      return JSON.stringify(value)?.length ?? 0;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private fail(
    client: Socket,
    code: SocketErrorCode,
    message: string,
  ): SocketAck {
    const error = { code, message };
    client.emit('socketError', error);
    return { ok: false, error };
  }

  private authorization(): RemoteAuthorizationService {
    if (!this.remoteAuthorization)
      throw new Error('Remote authorization is not configured.');
    return this.remoteAuthorization;
  }

  private authService(): AuthService {
    if (!this.auth) throw new Error('Socket authentication is not configured.');
    return this.auth;
  }

  private socketException(
    code: SocketErrorCode,
    message: string,
  ): Error & { response: { code: SocketErrorCode; message: string } } {
    const error = new Error(message) as Error & {
      response: { code: SocketErrorCode; message: string };
    };
    error.response = { code, message };
    return error;
  }

  private errorTuple(error: unknown): [SocketErrorCode, string] {
    const payload = this.errorPayload(error);
    return [payload.code, payload.message];
  }

  private errorPayload(error: unknown): {
    code: SocketErrorCode;
    message: string;
  } {
    const response = (error as { response?: unknown })?.response;
    const record = this.isRecord(response) ? response : {};
    const code = this.isSocketErrorCode(record.code)
      ? record.code
      : record.statusCode === 400
        ? 'INVALID_PAYLOAD'
        : 'REMOTE_NOT_AUTHORIZED';
    const message =
      typeof record.message === 'string'
        ? record.message
        : 'Socket authorization failed.';
    return { code, message };
  }

  private isSocketErrorCode(value: unknown): value is SocketErrorCode {
    return [
      'PAIR_TOKEN_INVALID',
      'PAIR_TOKEN_EXPIRED',
      'REMOTE_PENDING',
      'REMOTE_REJECTED',
      'REMOTE_REVOKED',
      'REMOTE_NOT_AUTHORIZED',
      'SESSION_NOT_FOUND',
      'SESSION_EXPIRED',
      'INVALID_PAYLOAD',
      'RATE_LIMITED',
      'MAIN_CLIENT_OFFLINE',
      'DUPLICATE_MAIN_CLIENT',
    ].includes(value as string);
  }
}
