import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YoutubePersonalKeyService } from './youtube-personal-key.service';
import { YoutubeService } from './youtube.service';

describe('YoutubeService', () => {
  const apiKey = 'server-only-test-key';
  const backupApiKey = 'server-only-backup-test-key';
  let service: YoutubeService;
  let personalKeyService: YoutubePersonalKeyService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    const configValues: Record<string, string> = {
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
    service = new YoutubeService(configService, personalKeyService);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('uses a personal key only for the exact matching visitor ID', async () => {
    const visitorId = '123e4567-e89b-42d3-a456-426614174000';
    const otherVisitorId = '123e4567-e89b-42d3-a456-426614174001';
    const personalKey = `AIza${'a'.repeat(35)}`;
    personalKeyService.register(visitorId, personalKey);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(service.getKeyAliases(visitorId).aliases).toContain(
      YoutubePersonalKeyService.alias,
    );
    expect(service.getKeyAliases(otherVisitorId).aliases).not.toContain(
      YoutubePersonalKeyService.alias,
    );

    await service.search(
      'personal test',
      YoutubePersonalKeyService.alias,
      visitorId,
    );
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(new URL(requestUrl).searchParams.get('key')).toBe(personalKey);

    await expect(
      service.search(
        'wrong visitor',
        YoutubePersonalKeyService.alias,
        otherVisitorId,
      ),
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
    service = new YoutubeService(configService, personalKeyService);

    await expect(service.search('test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
