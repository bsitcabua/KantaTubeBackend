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

  private readonly keysByUserId = new Map<string, string>();
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

  register(userId: string, apiKey: string): YoutubePersonalKeyStatusResponse {
    this.ensureEnabled();
    const normalizedUserId = this.validateUserId(userId);
    const normalizedApiKey = this.validateApiKey(apiKey);

    if (
      !this.keysByUserId.has(normalizedUserId) &&
      this.keysByUserId.size >= this.maxSessions
    ) {
      throw new ServiceUnavailableException({
        code: 'personal_key_capacity_reached',
        message:
          'Personal key registration is temporarily full. Remove an existing personal key or try again later.',
      });
    }

    this.keysByUserId.set(normalizedUserId, normalizedApiKey);
    return this.getStatus(normalizedUserId);
  }

  getStatus(userId: string): YoutubePersonalKeyStatusResponse {
    this.ensureEnabled();
    const normalizedUserId = this.validateUserId(userId);
    return {
      available: this.keysByUserId.has(normalizedUserId),
      alias: YoutubePersonalKeyService.alias,
    };
  }

  remove(userId: string): YoutubePersonalKeyDeleteResponse {
    this.ensureEnabled();
    const normalizedUserId = this.validateUserId(userId);
    return { removed: this.keysByUserId.delete(normalizedUserId) };
  }

  resolve(userId: string): string {
    this.ensureEnabled();
    const normalizedUserId = this.validateUserId(userId);
    const apiKey = this.keysByUserId.get(normalizedUserId);

    if (!apiKey) {
      throw new NotFoundException({
        code: 'personal_key_not_registered',
        message:
          'No personal YouTube API key is registered for this account.',
      });
    }

    return apiKey;
  }

  has(userId?: string): boolean {
    if (!userId || !this.isEnabled() || !this.isValidUserId(userId)) {
      return false;
    }

    return this.keysByUserId.has(userId.trim());
  }

  private validateUserId(userId: string): string {
    const normalizedUserId = (userId ?? '').trim();
    if (!this.isValidUserId(normalizedUserId)) {
      throw new BadRequestException({
        code: 'invalid_user_id',
        message: 'A valid authenticated user is required.',
      });
    }

    return normalizedUserId;
  }

  private isValidUserId(userId: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
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
