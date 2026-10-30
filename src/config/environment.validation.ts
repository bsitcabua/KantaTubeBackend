import { resolvePayMongoMode } from '../modules/karaoke-pass/karaoke-pass.config';

export function validateEnvironment(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...values,
    PAYMONGO_MODE: resolvePayMongoMode(values.PAYMONGO_MODE),
  };
}
