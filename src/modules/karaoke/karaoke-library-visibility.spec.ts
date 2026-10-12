import {
  KaraokeLibraryVisibility,
  normalizeKaraokeLibraryVisibility,
} from './karaoke-library-visibility';

describe('Karaoke library visibility', () => {
  it('defaults missing, null, and unknown values to private', () => {
    expect(normalizeKaraokeLibraryVisibility(undefined)).toBe(KaraokeLibraryVisibility.PRIVATE);
    expect(normalizeKaraokeLibraryVisibility(null)).toBe(KaraokeLibraryVisibility.PRIVATE);
    expect(normalizeKaraokeLibraryVisibility('legacy')).toBe(KaraokeLibraryVisibility.PRIVATE);
  });

  it('accepts only the exact public value as public', () => {
    expect(normalizeKaraokeLibraryVisibility(KaraokeLibraryVisibility.PUBLIC)).toBe(KaraokeLibraryVisibility.PUBLIC);
    expect(normalizeKaraokeLibraryVisibility('PUBLIC')).toBe(KaraokeLibraryVisibility.PRIVATE);
  });
});
