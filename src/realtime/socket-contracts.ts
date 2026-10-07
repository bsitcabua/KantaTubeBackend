export const REMOTE_COMMAND_EVENTS = [
  'getSongReserved',
  'reserveSong',
  'nextSong',
  'stopAllSong',
  'onSearch',
  'getPerformers',
  'addPerformer',
  'removePerformer',
  'clearAllPerformers',
  'pauseVideo',
  'playVideo',
  'toggleScore',
  'toggleThemeMode',
  'updatePrimaryColor',
  'updateKey',
  'updatePresets',
  'updateMenuMode',
] as const;

export const MAIN_RESPONSE_EVENTS = [
  'songReserved',
  'videoStatus',
  'searchResults',
  'queueError',
  'performers',
  'toggleScoreFromMain',
  'toggleThemeModeFromMain',
  'updatePrimaryColorFromMain',
  'updateKeyFromMain',
  'updatePresetsFromMain',
  'updateMenuModeFromMain',
] as const;

export type RemoteCommandEvent = (typeof REMOTE_COMMAND_EVENTS)[number];
export type MainResponseEvent = (typeof MAIN_RESPONSE_EVENTS)[number];

export interface SocketEnvelope<T = unknown> {
  event: string;
  data?: T;
}

export type MainClientStatus = 'online' | 'offline' | 'reconnecting';

export interface RemoteConnectionRequest {
  requestId: string;
  deviceId: string;
  device: string;
}

export type SocketErrorCode =
  | 'PAIR_TOKEN_INVALID'
  | 'PAIR_TOKEN_EXPIRED'
  | 'REMOTE_PENDING'
  | 'REMOTE_REJECTED'
  | 'REMOTE_REVOKED'
  | 'REMOTE_NOT_AUTHORIZED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SOCKET_TICKET_REJECTED'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'MAIN_CLIENT_OFFLINE'
  | 'QUEUE_FULL'
  | 'DUPLICATE_MAIN_CLIENT';

export interface SocketErrorPayload {
  code: SocketErrorCode;
  message: string;
}
