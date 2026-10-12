export enum KaraokeLibraryVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

/**
 * Privacy is fail-closed. Only the exact public value may expose library
 * content to a Remote; null, legacy, and unknown values remain private.
 */
export function normalizeKaraokeLibraryVisibility(
  value: unknown,
): KaraokeLibraryVisibility {
  return value === KaraokeLibraryVisibility.PUBLIC
    ? KaraokeLibraryVisibility.PUBLIC
    : KaraokeLibraryVisibility.PRIVATE;
}
