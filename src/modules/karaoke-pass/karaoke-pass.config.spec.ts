import { ConfigService } from '@nestjs/config';
import {
  getPayMongoRuntimeConfig,
  getPayMongoRuntimeConfigForMode,
  resolvePayMongoMode,
} from './karaoke-pass.config';

describe('PayMongo runtime configuration', () => {
  it('selects mode-specific credentials and validates QR expiry bounds', () => {
    const values: Record<string, string> = {
      PAYMONGO_MODE: 'live',
      PAYMONGO_LIVE_SECRET_KEY: 'sk_live_example',
      PAYMONGO_LIVE_PUBLIC_KEY: 'pk_live_example',
      PAYMONGO_LIVE_WEBHOOK_SECRET: 'whsec_live_example',
      PAYMONGO_QRPH_EXPIRY_SECONDS: '9000',
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;

    expect(getPayMongoRuntimeConfig(config)).toEqual({
      mode: 'live',
      secretKey: 'sk_live_example',
      publicKey: 'pk_live_example',
      webhookSecret: 'whsec_live_example',
      qrExpirySeconds: 9000,
      available: true,
    });
  });

  it('fails closed when credentials are absent and uses the safe expiry default', () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const result = getPayMongoRuntimeConfig(config);

    expect(result.available).toBe(false);
    expect(result.mode).toBe('test');
    expect(result.qrExpirySeconds).toBe(1800);
  });

  it('rejects unsupported modes instead of silently selecting TEST', () => {
    expect(() => resolvePayMongoMode('sandbox')).toThrow(
      'PAYMONGO_MODE must be either test or live.',
    );
  });

  it('reads only TEST credentials when the active mode is TEST', () => {
    const values: Record<string, string> = {
      PAYMONGO_MODE: 'test',
      PAYMONGO_TEST_SECRET_KEY: 'sk_test_example',
      PAYMONGO_TEST_WEBHOOK_SECRET: 'whsec_test_example',
      PAYMONGO_LIVE_SECRET_KEY: 'must-not-be-read',
      PAYMONGO_LIVE_WEBHOOK_SECRET: 'must-not-be-read',
    };
    const get = jest.fn((key: string) => values[key]);
    const config = { get } as unknown as ConfigService;

    expect(getPayMongoRuntimeConfig(config).secretKey).toBe('sk_test_example');
    expect(get).not.toHaveBeenCalledWith('PAYMONGO_LIVE_SECRET_KEY');
    expect(get).not.toHaveBeenCalledWith('PAYMONGO_LIVE_WEBHOOK_SECRET');
    expect(getPayMongoRuntimeConfigForMode(config, 'test').webhookSecret).toBe(
      'whsec_test_example',
    );
  });
});
