export const DEFAULT_MAX_KARAOKE_QUEUE_SIZE = 15;

export interface BuyMeACoffeeConfig {
  autoShow: boolean;
  afterCompletedSongs: number;
  cooldownDays: number;
  maxAutoShowPerSession: number;
  manualOpenCountsAsShown: boolean;
  manualOpenResetsCooldown: boolean;
}

export const DEFAULT_BUY_ME_A_COFFEE_CONFIG: BuyMeACoffeeConfig = {
  autoShow: false,
  afterCompletedSongs: 6,
  cooldownDays: 7,
  maxAutoShowPerSession: 1,
  manualOpenCountsAsShown: true,
  manualOpenResetsCooldown: true,
};

export function parseMaxKaraokeQueueSize(value: unknown): number {
  const normalized =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';

  if (!/^\d+$/.test(normalized)) return DEFAULT_MAX_KARAOKE_QUEUE_SIZE;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_KARAOKE_QUEUE_SIZE;
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;

  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseInteger(
  value: unknown,
  fallback: number,
  minimum: number,
): number {
  const normalized =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';

  if (!/^\d+$/.test(normalized)) return fallback;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

export function parseBuyMeACoffeeConfig(values: {
  autoShow?: unknown;
  afterCompletedSongs?: unknown;
  cooldownDays?: unknown;
  maxAutoShowPerSession?: unknown;
  manualOpenCountsAsShown?: unknown;
  manualOpenResetsCooldown?: unknown;
}): BuyMeACoffeeConfig {
  return {
    autoShow: parseBoolean(
      values.autoShow,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.autoShow,
    ),
    afterCompletedSongs: parseInteger(
      values.afterCompletedSongs,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.afterCompletedSongs,
      1,
    ),
    cooldownDays: parseInteger(
      values.cooldownDays,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.cooldownDays,
      0,
    ),
    maxAutoShowPerSession: parseInteger(
      values.maxAutoShowPerSession,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.maxAutoShowPerSession,
      1,
    ),
    manualOpenCountsAsShown: parseBoolean(
      values.manualOpenCountsAsShown,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.manualOpenCountsAsShown,
    ),
    manualOpenResetsCooldown: parseBoolean(
      values.manualOpenResetsCooldown,
      DEFAULT_BUY_ME_A_COFFEE_CONFIG.manualOpenResetsCooldown,
    ),
  };
}
