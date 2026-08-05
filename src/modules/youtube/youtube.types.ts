export interface YoutubeThumbnail {
  url: string;
}

export interface YoutubeSearchItem {
  id: {
    videoId: string;
  };
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      medium: YoutubeThumbnail;
    };
  };
}

export interface YoutubeSearchResponse {
  items: YoutubeSearchItem[];
}

export interface YoutubeKeyAliasesResponse {
  aliases: string[];
  defaultAlias: string;
}

export interface YoutubePersonalKeyRequest {
  apiKey: string;
}

export interface YoutubePersonalKeyStatusResponse {
  available: boolean;
  alias: string;
}

export interface YoutubePersonalKeyDeleteResponse {
  removed: boolean;
}

export interface YoutubeApiError {
  message?: string;
  status?: string;
  errors?: Array<{ reason?: string }>;
  details?: Array<{ reason?: string }>;
}
