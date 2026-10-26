import {
  APPLICATION_TIME_ZONE,
  fromApplicationWallClock,
  getApplicationDateKey,
  getNextApplicationMidnight,
} from './application-date-time';

describe('application date/time', () => {
  it('uses the Manila business date before, at, and after midnight', () => {
    expect(getApplicationDateKey(new Date('2026-10-20T15:59:59.999Z'))).toBe('2026-10-20');
    expect(getApplicationDateKey(new Date('2026-10-20T16:00:00.000Z'))).toBe('2026-10-21');
    expect(getApplicationDateKey(new Date('2026-10-20T16:00:00.001Z'))).toBe('2026-10-21');
  });

  it('resolves the next Manila midnight as an absolute UTC instant', () => {
    const beforeMidnight = getNextApplicationMidnight(new Date('2026-10-20T15:59:59.999Z'));
    const afterMidnight = getNextApplicationMidnight(new Date('2026-10-20T16:00:00.001Z'));

    expect(beforeMidnight.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(afterMidnight.toISOString()).toBe('2026-10-21T16:00:00.000Z');
  });

  it('does not depend on the Node process timezone for wall-clock conversion', () => {
    const originalTimeZone = process.env.TZ;

    try {
      process.env.TZ = 'America/Los_Angeles';
      const midnight = fromApplicationWallClock({ year: 2026, month: 10, day: 21, hour: 0, minute: 0, second: 0 });

      expect(midnight.toISOString()).toBe('2026-10-20T16:00:00.000Z');
      expect(APPLICATION_TIME_ZONE).toBe('Asia/Manila');
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });
});
