import {
  DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
  parseMaxKaraokeQueueSize,
} from './karaoke-config';

describe('karaoke configuration', () => {
  it('accepts a configured positive integer', () => {
    expect(parseMaxKaraokeQueueSize('15')).toBe(15);
  });

  it('uses the safe default when the setting is missing', () => {
    expect(parseMaxKaraokeQueueSize(undefined)).toBe(
      DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
    );
  });

  it.each(['', '0', '-1', '1.5', 'not-a-number', '1e3'])(
    'uses the safe default for invalid value %s',
    (value) => {
      expect(parseMaxKaraokeQueueSize(value)).toBe(
        DEFAULT_MAX_KARAOKE_QUEUE_SIZE,
      );
    },
  );
});
