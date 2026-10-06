export const DEFAULT_MAX_KARAOKE_QUEUE_SIZE = 15;

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
