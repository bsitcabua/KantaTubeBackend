import {
  DEFAULT_BUY_ME_A_COFFEE_CONFIG,
  DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
  parseBoolean,
  parseBuyMeACoffeeConfig,
  parseMaxKaraokeQueueSize,
} from './karaoke-config';

describe('karaoke configuration', () => {
  it('accepts a configured positive queue size', () => {
    expect(parseMaxKaraokeQueueSize('15')).toBe(15);
  });

  it('uses the safe default when the queue setting is missing', () => {
    expect(parseMaxKaraokeQueueSize(undefined)).toBe(
      DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
    );
  });

  it.each(['', '0', '-1', '1.5', 'not-a-number', '1e3'])(
    'uses the safe default for invalid queue value %s',
    (value) => {
      expect(parseMaxKaraokeQueueSize(value)).toBe(
        DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
      );
    },
  );

  it('parses booleans without treating the string false as true', () => {
    expect(parseBoolean('true', false)).toBe(true);
    expect(parseBoolean(' TRUE ', false)).toBe(true);
    expect(parseBoolean('false', true)).toBe(false);
    expect(parseBoolean(false, true)).toBe(false);
  });

  it.each([undefined, null, '', 'yes', 1, '1'])(
    'uses the boolean fallback for invalid value %s',
    (value) => {
      expect(parseBoolean(value, true)).toBe(true);
      expect(parseBoolean(value, false)).toBe(false);
    },
  );

  it('resolves all Buy Me a Coffee defaults when ENV is missing', () => {
    expect(parseBuyMeACoffeeConfig({})).toEqual(DEFAULT_BUY_ME_A_COFFEE_CONFIG);
  });

  it('parses all configured Buy Me a Coffee values', () => {
    expect(
      parseBuyMeACoffeeConfig({
        autoShow: 'true',
        afterCompletedSongs: '3',
        cooldownDays: '14',
        maxAutoShowPerSession: '2',
        manualOpenCountsAsShown: 'false',
        manualOpenResetsCooldown: 'false',
      }),
    ).toEqual({
      autoShow: true,
      afterCompletedSongs: 3,
      cooldownDays: 14,
      maxAutoShowPerSession: 2,
      manualOpenCountsAsShown: false,
      manualOpenResetsCooldown: false,
    });
  });

  it('allows a zero-day cooldown', () => {
    expect(parseBuyMeACoffeeConfig({ cooldownDays: '0' }).cooldownDays).toBe(0);
  });

  it.each(['0', '-1', '1.5', 'abc', 'NaN', 'Infinity', '1e3'])(
    'falls back for an invalid completed-song threshold %s',
    (value) => {
      expect(
        parseBuyMeACoffeeConfig({ afterCompletedSongs: value })
          .afterCompletedSongs,
      ).toBe(DEFAULT_BUY_ME_A_COFFEE_CONFIG.afterCompletedSongs);
    },
  );

  it.each(['-1', '1.5', 'abc', 'NaN', 'Infinity', '1e3'])(
    'falls back for an invalid cooldown %s',
    (value) => {
      expect(
        parseBuyMeACoffeeConfig({ cooldownDays: value }).cooldownDays,
      ).toBe(DEFAULT_BUY_ME_A_COFFEE_CONFIG.cooldownDays);
    },
  );

  it.each(['0', '-1', '1.5', 'abc', 'NaN', 'Infinity', '1e3'])(
    'falls back for an invalid session maximum %s',
    (value) => {
      expect(
        parseBuyMeACoffeeConfig({ maxAutoShowPerSession: value })
          .maxAutoShowPerSession,
      ).toBe(DEFAULT_BUY_ME_A_COFFEE_CONFIG.maxAutoShowPerSession);
    },
  );

  it('defaults automatic support prompts to false for an invalid flag', () => {
    expect(parseBuyMeACoffeeConfig({ autoShow: 'abc' }).autoShow).toBe(false);
  });
});
