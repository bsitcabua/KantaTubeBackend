import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  YoutubeApiError,
  YoutubeKeyAliasesResponse,
  YoutubeSearchItem,
  YoutubeSearchResponse,
} from './youtube.types';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private readonly youtubeSearchUrl =
    'https://www.googleapis.com/youtube/v3/search';
  private readonly requestTimeoutMs = 10000;

  constructor(
    private readonly configService: ConfigService,
    private readonly personalKeyService: YoutubePersonalKeyService,
  ) {}

  getKeyAliases(visitorId?: string): YoutubeKeyAliasesResponse {
    const configuredKeys = this.getConfiguredApiKeys();
    const aliases = Object.keys(configuredKeys);

    if (aliases.length > 0) {
      const configuredDefault = this.configService
        .get<string>('YOUTUBE_DEFAULT_API_KEY_ALIAS')
        ?.trim();
      const defaultAlias =
        configuredDefault && configuredKeys[configuredDefault]
          ? configuredDefault
          : aliases[0];

      return {
        aliases: this.withPersonalAlias(aliases, visitorId),
        defaultAlias,
      };
    }

    if (this.configService.get<string>('YOUTUBE_API_KEY')?.trim()) {
      return {
        aliases: this.withPersonalAlias(['default'], visitorId),
        defaultAlias: 'default',
      };
    }

    this.throwMissingKeyConfiguration();
  }

  async search(
    searchQuery: string,
    requestedKeyAlias?: string,
    visitorId?: string,
  ): Promise<YoutubeSearchResponse> {
    const normalizedQuery = this.normalizeQuery(searchQuery);
    const apiKey = this.resolveApiKey(requestedKeyAlias, visitorId);

    const effectiveQuery = normalizedQuery.toLowerCase().includes('karaoke')
      ? normalizedQuery
      : `${normalizedQuery} Karaoke`;
    const params = new URLSearchParams({
      part: 'snippet',
      q: effectiveQuery,
      fields:
        'items(id/videoId,snippet(title,description,thumbnails/medium/url))',
      maxResults: '20',
      type: 'video',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      key: apiKey,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(`${this.youtubeSearchUrl}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        this.handleYoutubeError(response.status, payload);
      }

      if (!this.isSearchResponse(payload)) {
        this.logger.error('YouTube returned an invalid search response.');
        throw new BadGatewayException({
          code: 'youtube_invalid_response',
          message: 'YouTube search returned an invalid response.',
        });
      }

      this.logger.log(
        `YouTube search.list completed with ${payload.items.length} result(s).`,
      );
      return payload;
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn('YouTube search.list timed out.');
        throw new GatewayTimeoutException({
          code: 'youtube_timeout',
          message: 'YouTube search took too long. Please try again.',
        });
      }

      this.logger.error(
        `YouTube search.list failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw new BadGatewayException({
        code: 'youtube_unavailable',
        message: 'Unable to reach YouTube search. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeQuery(searchQuery: string): string {
    const normalized = (searchQuery ?? '').trim().replace(/\s+/g, ' ');

    if (!normalized) {
      throw new BadRequestException({
        code: 'invalid_search_query',
        message: 'Please enter a song or artist to search.',
      });
    }

    if (normalized.length > 100) {
      throw new BadRequestException({
        code: 'invalid_search_query',
        message: 'Search text must be 100 characters or fewer.',
      });
    }

    return normalized;
  }

  private resolveApiKey(
    requestedAlias?: string,
    visitorId?: string,
  ): string {
    if (requestedAlias?.trim() === YoutubePersonalKeyService.alias) {
      return this.personalKeyService.resolve(visitorId ?? '');
    }

    const configuredKeys = this.getConfiguredApiKeys();
    const aliases = Object.keys(configuredKeys);

    if (aliases.length > 0) {
      const defaultAlias =
        this.configService
          .get<string>('YOUTUBE_DEFAULT_API_KEY_ALIAS')
          ?.trim() || aliases[0];
      const selectedAlias = requestedAlias?.trim() || defaultAlias;
      const selectedKey = configuredKeys[selectedAlias];

      if (!selectedKey) {
        throw new BadRequestException({
          code: 'invalid_api_key_alias',
          message: 'The selected YouTube API key is not available.',
        });
      }

      return selectedKey;
    }

    const singleApiKey = this.configService
      .get<string>('YOUTUBE_API_KEY')
      ?.trim();
    if (singleApiKey) {
      if (requestedAlias?.trim() && requestedAlias.trim() !== 'default') {
        throw new BadRequestException({
          code: 'invalid_api_key_alias',
          message: 'The selected YouTube API key is not available.',
        });
      }
      return singleApiKey;
    }

    this.throwMissingKeyConfiguration();
  }

  private withPersonalAlias(
    aliases: string[],
    visitorId?: string,
  ): string[] {
    return this.personalKeyService.has(visitorId)
      ? [...aliases, YoutubePersonalKeyService.alias]
      : aliases;
  }

  private getConfiguredApiKeys(): Record<string, string> {
    const serializedKeys = this.configService
      .get<string>('YOUTUBE_API_KEYS')
      ?.trim();
    if (!serializedKeys) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(serializedKeys);
      if (!this.isRecord(parsed)) {
        throw new Error('The value must be a JSON object.');
      }

      return Object.entries(parsed).reduce<Record<string, string>>(
        (keys, [alias, value]) => {
          if (typeof value === 'string' && value.trim()) {
            keys[alias] = value.trim();
          }
          return keys;
        },
        {},
      );
    } catch (error: unknown) {
      this.logger.error(
        `YOUTUBE_API_KEYS is invalid: ${
          error instanceof Error ? error.message : 'Unknown configuration error'
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'youtube_not_configured',
        message: 'YouTube search is temporarily unavailable.',
      });
    }
  }

  private throwMissingKeyConfiguration(): never {
    this.logger.error(
      'Neither YOUTUBE_API_KEYS nor YOUTUBE_API_KEY is configured.',
    );
    throw new ServiceUnavailableException({
      code: 'youtube_not_configured',
      message: 'YouTube search is temporarily unavailable.',
    });
  }

  private handleYoutubeError(status: number, payload: unknown): never {
    const apiError = this.getYoutubeApiError(payload);
    const reasons = [
      ...(apiError?.errors?.map((item) => item.reason) ?? []),
      ...(apiError?.details?.map((item) => item.reason) ?? []),
    ];
    const quotaReasons = new Set([
      'quotaExceeded',
      'dailyLimitExceeded',
      'rateLimitExceeded',
      'userRateLimitExceeded',
      'RATE_LIMIT_EXCEEDED',
    ]);
    const isQuotaExceeded =
      status === HttpStatus.TOO_MANY_REQUESTS ||
      apiError?.status === 'RESOURCE_EXHAUSTED' ||
      reasons.some((reason) => reason && quotaReasons.has(reason));

    if (isQuotaExceeded) {
      this.logger.warn('YouTube search quota or upstream rate limit was reached.');
      throw new HttpException(
        {
          code: 'quota_exceeded',
          message:
            'YouTube search quota has been reached. Please try again after the quota resets.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const normalizedReasons = reasons
      .filter((reason): reason is string => Boolean(reason))
      .map((reason) => reason.toLowerCase());
    const normalizedMessage = apiError?.message?.toLowerCase() ?? '';
    const hasReason = (...expectedReasons: string[]): boolean =>
      expectedReasons.some((expectedReason) =>
        normalizedReasons.includes(expectedReason.toLowerCase()),
      );

    const isInvalidKey =
      hasReason('keyInvalid', 'API_KEY_INVALID') ||
      normalizedMessage.includes('api key not valid') ||
      normalizedMessage.includes('api key is invalid');
    if (isInvalidKey) {
      this.logger.error('YouTube rejected the selected API key as invalid.');
      throw new ServiceUnavailableException({
        code: 'youtube_key_invalid',
        message:
          'The selected YouTube API key is invalid. Please update it on the backend.',
      });
    }

    const isApiDisabled =
      hasReason('accessNotConfigured', 'serviceDisabled', 'API_DISABLED') ||
      normalizedMessage.includes('has not been used in project') ||
      normalizedMessage.includes('is disabled');
    if (isApiDisabled) {
      this.logger.error(
        'YouTube Data API v3 is not enabled for the selected key project.',
      );
      throw new ServiceUnavailableException({
        code: 'youtube_api_not_enabled',
        message:
          'YouTube Data API v3 is not enabled for the selected backend key project.',
      });
    }

    const isHttpReferrerBlocked =
      hasReason('ipRefererBlocked', 'API_KEY_HTTP_REFERRER_BLOCKED') ||
      normalizedMessage.includes('requests from referer') ||
      normalizedMessage.includes('http referrer');
    const isIpAddressBlocked = hasReason('API_KEY_IP_ADDRESS_BLOCKED');
    const isServiceBlocked =
      hasReason('API_KEY_SERVICE_BLOCKED') ||
      normalizedMessage.includes('api key service restrictions');
    const isApplicationRestrictionBlocked = normalizedMessage.includes(
      'application restriction',
    );
    const isKeyRestrictionMismatch =
      isHttpReferrerBlocked ||
      isIpAddressBlocked ||
      isServiceBlocked ||
      isApplicationRestrictionBlocked;
    if (isKeyRestrictionMismatch) {
      this.logger.error(
        `YouTube rejected the selected API key restriction; status ${status}; reason(s): ${
          normalizedReasons.join(', ') || 'restriction mismatch'
        }.`,
      );

      const message = isHttpReferrerBlocked
        ? 'This YouTube API key is restricted to browser referrers and cannot be used by the backend.'
        : isIpAddressBlocked
          ? 'This YouTube API key does not allow requests from the backend server IP address.'
          : isServiceBlocked
            ? 'This API key does not allow YouTube Data API v3. Update its API restrictions in Google Cloud Console.'
            : 'Google rejected this API key because its application restrictions do not allow the backend request.';

      throw new ServiceUnavailableException({
        code: 'youtube_key_restricted',
        message,
      });
    }

    this.logger.error(
      `YouTube search.list returned status ${status}; reason(s): ${
        normalizedReasons.join(', ') || 'unknown'
      }.`,
    );
    throw new BadGatewayException({
      code: 'youtube_upstream_error',
      message: 'YouTube search failed. Please try again.',
    });
  }

  private getYoutubeApiError(payload: unknown): YoutubeApiError | undefined {
    if (!this.isRecord(payload) || !this.isRecord(payload['error'])) {
      return undefined;
    }

    return payload['error'] as YoutubeApiError;
  }

  private isSearchResponse(payload: unknown): payload is YoutubeSearchResponse {
    return (
      this.isRecord(payload) &&
      Array.isArray(payload['items']) &&
      payload['items'].every((item) => this.isSearchItem(item))
    );
  }

  private isSearchItem(item: unknown): item is YoutubeSearchItem {
    if (!this.isRecord(item)) {
      return false;
    }

    const id = item['id'];
    const snippet = item['snippet'];
    if (!this.isRecord(id) || !this.isRecord(snippet)) {
      return false;
    }

    const thumbnails = snippet['thumbnails'];
    if (!this.isRecord(thumbnails) || !this.isRecord(thumbnails['medium'])) {
      return false;
    }

    return (
      typeof id['videoId'] === 'string' &&
      typeof snippet['title'] === 'string' &&
      typeof snippet['description'] === 'string' &&
      typeof thumbnails['medium']['url'] === 'string'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
