import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  YoutubePersonalKeyDeleteResponse,
  YoutubePersonalKeyStatusResponse,
} from './youtube.types';

@Injectable()
export class YoutubePersonalKeyService {
  static readonly alias = 'personal_session';

  private readonly keysByVisitorId = new Map<string, string>();
  private readonly maxSessions: number;

  constructor(private readonly configService: ConfigService) {
    const configuredMaximum = Number(
      this.configService.get<string>('YOUTUBE_PERSONAL_KEY_MAX_SESSIONS'),
    );
    this.maxSessions =
      Number.isInteger(configuredMaximum) && configuredMaximum > 0
        ? configuredMaximum
        : 200;
  }

  register(visitorId: string, apiKey: string): YoutubePersonalKeyStatusResponse {
    this.ensureEnabled();
    const normalizedVisitorId = this.validateVisitorId(visitorId);
    const normalizedApiKey = this.validateApiKey(apiKey);

    if (
      !this.keysByVisitorId.has(normalizedVisitorId) &&
      this.keysByVisitorId.size >= this.maxSessions
    ) {
      throw new ServiceUnavailableException({
        code: 'personal_key_capacity_reached',
        message:
          'Personal key registration is temporarily full. Remove an existing personal key or try again later.',
      });
    }

    this.keysByVisitorId.set(normalizedVisitorId, normalizedApiKey);
    return this.getStatus(normalizedVisitorId);
  }

  getStatus(visitorId: string): YoutubePersonalKeyStatusResponse {
    this.ensureEnabled();
    const normalizedVisitorId = this.validateVisitorId(visitorId);
    return {
      available: this.keysByVisitorId.has(normalizedVisitorId),
      alias: YoutubePersonalKeyService.alias,
    };
  }

  remove(visitorId: string): YoutubePersonalKeyDeleteResponse {
    this.ensureEnabled();
    const normalizedVisitorId = this.validateVisitorId(visitorId);
    return { removed: this.keysByVisitorId.delete(normalizedVisitorId) };
  }

  resolve(visitorId: string): string {
    this.ensureEnabled();
    const normalizedVisitorId = this.validateVisitorId(visitorId);
    const apiKey = this.keysByVisitorId.get(normalizedVisitorId);

    if (!apiKey) {
      throw new NotFoundException({
        code: 'personal_key_not_registered',
        message:
          'No personal YouTube API key is registered for this visitor session.',
      });
    }

    return apiKey;
  }

  has(visitorId?: string): boolean {
    if (!visitorId || !this.isEnabled() || !this.isValidVisitorId(visitorId)) {
      return false;
    }

    return this.keysByVisitorId.has(visitorId.trim());
  }

  private validateVisitorId(visitorId: string): string {
    const normalizedVisitorId = (visitorId ?? '').trim();
    if (!this.isValidVisitorId(normalizedVisitorId)) {
      throw new BadRequestException({
        code: 'invalid_visitor_id',
        message: 'A valid KantaTube visitor ID is required.',
      });
    }

    return normalizedVisitorId;
  }

  private isValidVisitorId(visitorId: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      visitorId,
    );
  }

  private validateApiKey(apiKey: string): string {
    const normalizedApiKey = (apiKey ?? '').trim();
    if (!/^AIza[0-9A-Za-z_-]{30,50}$/.test(normalizedApiKey)) {
      throw new BadRequestException({
        code: 'invalid_personal_key_format',
        message: 'Please enter a valid YouTube API key.',
      });
    }

    return normalizedApiKey;
  }

  private ensureEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException({
        code: 'personal_keys_disabled',
        message: 'Personal YouTube API keys are currently disabled.',
      });
    }
  }

  private isEnabled(): boolean {
    return (
      this.configService
        .get<string>('YOUTUBE_PERSONAL_KEYS_ENABLED')
        ?.trim()
        .toLowerCase() !== 'false'
    );
  }
}
