/**
 * Application-wide time rules.
 *
 * Instant timestamps remain UTC ISO values at API boundaries. Only calendar
 * calculations that describe a KantaTube business day use Asia/Manila.
 */
export const APPLICATION_TIME_ZONE = 'Asia/Manila' as const;

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readZonedDateParts(value: Date, timeZone = APPLICATION_TIME_ZONE): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function asUtcMilliseconds(parts: ZonedDateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** Returns YYYY-MM-DD in the application business timezone. */
export function getApplicationDateKey(value = new Date()): string {
  const parts = readZonedDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Converts a wall-clock value in an IANA zone into its absolute instant.
 * This deliberately derives the zone offset through Intl instead of applying
 * a fixed UTC+8 arithmetic adjustment.
 */
export function fromApplicationWallClock(
  parts: Pick<ZonedDateParts, 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'>,
  timeZone = APPLICATION_TIME_ZONE,
): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = new Date(wallClockAsUtc);

  // Two passes are enough to converge on the correct offset, including zones
  // whose offset changes near the requested wall-clock date.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const displayed = readZonedDateParts(candidate, timeZone);
    const displayedAsUtc = asUtcMilliseconds(displayed);
    candidate = new Date(wallClockAsUtc - (displayedAsUtc - candidate.getTime()));
  }
  return candidate;
}

/** Returns the absolute instant for the next Asia/Manila midnight. */
export function getNextApplicationMidnight(value = new Date()): Date {
  const current = readZonedDateParts(value);
  const nextDate = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  return fromApplicationWallClock({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

export function formatApplicationDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-PH',
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: APPLICATION_TIME_ZONE }).format(new Date(value));
}
