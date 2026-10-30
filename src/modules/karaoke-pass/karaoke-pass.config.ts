import { ConfigService } from '@nestjs/config';

export type PayMongoMode = 'test' | 'live';

export interface PayMongoRuntimeConfig {
  mode: PayMongoMode;
  secretKey: string;
  webhookSecret: string;
  publicKey: string;
  qrExpirySeconds: number;
  available: boolean;
}

export function resolvePayMongoMode(value: unknown): PayMongoMode {
  const normalized =
    typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : 'test';
  if (normalized !== 'test' && normalized !== 'live') {
    throw new Error('PAYMONGO_MODE must be either test or live.');
  }
  return normalized;
}

export function getPayMongoRuntimeConfig(
  config: ConfigService,
): PayMongoRuntimeConfig {
  return getPayMongoRuntimeConfigForMode(
    config,
    resolvePayMongoMode(config.get<string>('PAYMONGO_MODE')),
  );
}

export function getPayMongoRuntimeConfigForMode(
  config: ConfigService,
  mode: PayMongoMode,
): PayMongoRuntimeConfig {
  const prefix = mode === 'live' ? 'LIVE' : 'TEST';
  const secretKey =
    config.get<string>(`PAYMONGO_${prefix}_SECRET_KEY`)?.trim() ?? '';
  const webhookSecret =
    config.get<string>(`PAYMONGO_${prefix}_WEBHOOK_SECRET`)?.trim() ?? '';
  const publicKey =
    config.get<string>(`PAYMONGO_${prefix}_PUBLIC_KEY`)?.trim() ?? '';
  const configuredExpiry = Number(
    config.get<string>('PAYMONGO_QRPH_EXPIRY_SECONDS'),
  );
  const qrExpirySeconds =
    Number.isInteger(configuredExpiry) &&
    configuredExpiry >= 60 &&
    configuredExpiry <= 9000
      ? configuredExpiry
      : 1800;

  return {
    mode,
    secretKey,
    webhookSecret,
    publicKey,
    qrExpirySeconds,
    available: Boolean(secretKey && webhookSecret),
  };
}
