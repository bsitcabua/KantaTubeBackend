import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeSearchCacheService } from './youtube-search-cache.service';
import {
  YOUTUBE_QUOTA_EXHAUSTED_COOLDOWN_MS,
  YoutubeService,
} from './youtube.service';

describe('YoutubeService', () => {
  const apiKey = 'server-only-test-key';
  const backupApiKey = 'server-only-backup-test-key';
  let service: YoutubeService;
  let personalKeyService: YoutubePersonalKeyService;
  let searchCacheService: YoutubeSearchCacheService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let configValues: Record<string, string>;

  beforeEach(() => {
    configValues = {
      YOUTUBE_API_KEYS: JSON.stringify({
        primary: apiKey,
        backup: backupApiKey,
      }),
      YOUTUBE_DEFAULT_API_KEY_ALIAS: 'primary',
    };
    const configService = {
      get: jest.fn((name: string) => configValues[name]),
    } as unknown as ConfigService;
    personalKeyService = new YoutubePersonalKeyService(configService);
    searchCacheService = new YoutubeSearchCacheService(configService);
    service = new YoutubeService(
      configService,
      personalKeyService,
      searchCacheService,
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function successResponse(videoId = 'video-1'): Response {
    return new Response(
      JSON.stringify({
        items: [
          {
            id: { videoId },
            snippet: {
              title: 'Test Karaoke',
              description: '',
              thumbnails: { medium: { url: 'thumbnail.jpg' } },
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function emptyResponse(): Response {
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function quotaResponse(): Response {
    return new Response(
      JSON.stringify({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded.',
          errors: [{ reason: 'quotaExceeded' }],
        },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function youtubeErrorResponse(
    status: number,
    reason: string,
    message: string,
  ): Response {
    return new Response(
      JSON.stringify({
        error: {
          status: 'PERMISSION_DENIED',
          message,
          errors: [{ reason }],
        },
      }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('searches YouTube with the server key and preserves the frontend response shape', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: { videoId: 'video-1' },
              snippet: {
                title: 'Test Karaoke',
                description: '',
                thumbnails: { medium: { url: 'thumbnail.jpg' } },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await service.search('  test   song  ');

    expect(result.items[0].id.videoId).toBe('video-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    const parsedUrl = new URL(requestUrl);
    expect(parsedUrl.searchParams.get('q')).toBe('test song Karaoke');
    expect(parsedUrl.searchParams.get('key')).toBe(apiKey);
    expect(parsedUrl.searchParams.get('maxResults')).toBe('20');
    expect(parsedUrl.searchParams.get('videoEmbeddable')).toBe('true');
    expect(parsedUrl.searchParams.get('videoSyndicated')).toBe('true');
  });

  it('returns aliases without returning API key values', () => {
    expect(service.getKeyAliases()).toEqual({
      aliases: ['primary', 'backup'],
      defaultAlias: 'primary',
    });
    expect(JSON.stringify(service.getKeyAliases())).not.toContain(apiKey);
    expect(JSON.stringify(service.getKeyAliases())).not.toContain(backupApiKey);
  });

  it('reuses a cached response for equivalent normalized searches', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await service.search('  Disco   Karaoke  ');
    await service.search('disco karaoke');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the manually selected key alias', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await service.search('test', 'backup');

    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(new URL(requestUrl).searchParams.get('key')).toBe(backupApiKey);
  });

  it('uses a personal key only for the exact matching authenticated user ID', async () => {
    const userA = '123e4567-e89b-42d3-a456-426614174000';
    const userB = '123e4567-e89b-42d3-a456-426614174001';
    const personalKey = `AIza${'a'.repeat(35)}`;
    personalKeyService.register(userA, personalKey);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(service.getKeyAliases(userA).aliases).toContain(
      YoutubePersonalKeyService.alias,
    );
    expect(service.getKeyAliases(userB).aliases).not.toContain(
      YoutubePersonalKeyService.alias,
    );

    await service.search(
      'personal test',
      YoutubePersonalKeyService.alias,
      userA,
    );
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(new URL(requestUrl).searchParams.get('key')).toBe(personalKey);

    await expect(
      service.search('wrong visitor', YoutubePersonalKeyService.alias, userB),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an alias that is not configured', async () => {
    await expect(service.search('test', 'missing')).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not append karaoke when it is already present', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await service.search('OPM Karaoke');

    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(new URL(requestUrl).searchParams.get('q')).toBe('OPM Karaoke');
  });

  it('maps YouTube quota errors to the stable application error contract', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded.',
            errors: [{ reason: 'quotaExceeded' }],
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.search('quota')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('does not switch aliases when automatic switching is disabled', async () => {
    configValues.AUTO_SWITCH_KEY = 'false';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(emptyResponse());

    await expect(service.search('disabled fallback')).rejects.toMatchObject({
      status: 429,
      response: { code: 'quota_exceeded' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('key'),
    ).toBe(apiKey);
  });

  it('treats an unrecognized automatic-switch value as disabled', async () => {
    configValues.AUTO_SWITCH_KEY = 'yes';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(emptyResponse());

    await expect(service.search('invalid switch value')).rejects.toMatchObject({
      status: 429,
      response: { code: 'quota_exceeded' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back from a quota-exhausted primary alias to the next alias', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse('backup-video'));

    const result = await service.search('primary fallback');

    expect(result.items[0].id.videoId).toBe('backup-video');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([request]) =>
        new URL(String(request)).searchParams.get('key'),
      ),
    ).toEqual([apiKey, backupApiKey]);
  });

  it('tries every configured alias once in deterministic fallback order', async () => {
    const primary = 'primary-test-key';
    const backup1 = 'backup1-test-key';
    const backup2 = 'backup2-test-key';
    configValues.AUTO_SWITCH_KEY = 'true';
    configValues.YOUTUBE_API_KEYS = JSON.stringify({
      primary,
      backup1,
      backup2,
    });
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse('last-backup-video'));

    const result = await service.search('explicit backup', 'backup1');

    expect(result.items[0].id.videoId).toBe('last-backup-video');
    expect(
      fetchMock.mock.calls.map(([request]) =>
        new URL(String(request)).searchParams.get('key'),
      ),
    ).toEqual([backup1, primary, backup2]);
  });

  it('returns the existing quota error when every server alias is exhausted', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(quotaResponse());

    await expect(service.search('all exhausted')).rejects.toMatchObject({
      status: 429,
      response: { code: 'quota_exceeded' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops fallback immediately for an invalid key error', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(
        youtubeErrorResponse(
          400,
          'keyInvalid',
          'API key not valid. Please pass a valid API key.',
        ),
      )
      .mockResolvedValueOnce(successResponse());

    await expect(service.search('invalid fallback')).rejects.toMatchObject({
      status: 503,
      response: { code: 'youtube_key_invalid' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops fallback for restriction and timeout errors', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(
        youtubeErrorResponse(
          403,
          'ipRefererBlocked',
          'Requests from referer <empty> are blocked.',
        ),
      )
      .mockResolvedValueOnce(successResponse());

    await expect(service.search('restricted fallback')).rejects.toMatchObject({
      status: 503,
      response: { code: 'youtube_key_restricted' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), {
        name: 'AbortError',
      }),
    );
    fetchMock.mockResolvedValueOnce(successResponse());

    await expect(service.search('timeout fallback')).rejects.toMatchObject({
      status: 504,
      response: { code: 'youtube_timeout' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never switches from a personal key to a server alias', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    const userId = '123e4567-e89b-42d3-a456-426614174000';
    const personalKey = `AIza${'b'.repeat(35)}`;
    personalKeyService.register(userId, personalKey);
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse());

    await expect(
      service.search('personal quota', YoutubePersonalKeyService.alias, userId),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'quota_exceeded' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('key'),
    ).toBe(personalKey);
  });

  it('caches a successful fallback result under the successful alias', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse('backup-cache-video'))
      .mockResolvedValueOnce(successResponse('primary-cache-video'));

    await service.search('cache scope');
    configValues.AUTO_SWITCH_KEY = 'false';
    const primaryResult = await service.search('cache scope', 'primary');

    expect(primaryResult.items[0].id.videoId).toBe('primary-cache-video');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('key'),
    ).toBe(apiKey);
  });

  it('skips a known-exhausted alias during the cooldown', async () => {
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse('first-backup'))
      .mockResolvedValueOnce(successResponse('second-backup'));

    await service.search('first tracked search');
    await service.search('second tracked search');

    expect(
      fetchMock.mock.calls.map(([request]) =>
        new URL(String(request)).searchParams.get('key'),
      ),
    ).toEqual([apiKey, backupApiKey, backupApiKey]);
  });

  it('retries an exhausted alias after the cooldown expires', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    configValues.AUTO_SWITCH_KEY = 'true';
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(successResponse('initial-backup'))
      .mockResolvedValueOnce(successResponse('after-cooldown'));

    await service.search('before cooldown');
    now += YOUTUBE_QUOTA_EXHAUSTED_COOLDOWN_MS + 1;
    await service.search('after cooldown');

    expect(
      fetchMock.mock.calls.map(([request]) =>
        new URL(String(request)).searchParams.get('key'),
      ),
    ).toEqual([apiKey, backupApiKey, apiKey]);
  });

  it('does not expose configured key values in quota logs or errors', async () => {
    const secretPrimary = 'SUPER_SECRET_PRIMARY_KEY';
    const secretBackup = 'SUPER_SECRET_BACKUP_KEY';
    configValues.AUTO_SWITCH_KEY = 'true';
    configValues.YOUTUBE_API_KEYS = JSON.stringify({
      primary: secretPrimary,
      backup: secretBackup,
    });
    const warningSpy = jest.spyOn(Logger.prototype, 'warn');
    fetchMock
      .mockResolvedValueOnce(quotaResponse())
      .mockResolvedValueOnce(quotaResponse());

    let thrownError: unknown;
    try {
      await service.search('secret safety');
    } catch (error: unknown) {
      thrownError = error;
    }

    const loggedWarnings = warningSpy.mock.calls.flat().join(' ');
    expect(loggedWarnings).not.toContain(secretPrimary);
    expect(loggedWarnings).not.toContain(secretBackup);
    expect(JSON.stringify(thrownError)).not.toContain(secretPrimary);
    expect(JSON.stringify(thrownError)).not.toContain(secretBackup);
  });

  it('identifies a backend-incompatible browser-referrer key', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            status: 'PERMISSION_DENIED',
            message: 'Requests from referer <empty> are blocked.',
            errors: [{ reason: 'ipRefererBlocked' }],
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.search('restricted')).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'youtube_key_restricted',
      },
    });
  });

  it('identifies an invalid API key without exposing its value', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            status: 'INVALID_ARGUMENT',
            message: 'API key not valid. Please pass a valid API key.',
            errors: [{ reason: 'keyInvalid' }],
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.search('invalid')).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'youtube_key_invalid',
      },
    });
  });

  it('identifies when YouTube Data API v3 is disabled', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            status: 'PERMISSION_DENIED',
            message: 'YouTube Data API v3 is disabled.',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.search('disabled')).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'youtube_api_not_enabled',
      },
    });
  });

  it('fails safely when the backend key is not configured', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    personalKeyService = new YoutubePersonalKeyService(configService);
    searchCacheService = new YoutubeSearchCacheService(configService);
    service = new YoutubeService(
      configService,
      personalKeyService,
      searchCacheService,
    );

    await expect(service.search('test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
