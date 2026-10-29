export enum AppearanceMode {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
  SYSTEM = 'SYSTEM',
}

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return (
    value === AppearanceMode.LIGHT ||
    value === AppearanceMode.DARK ||
    value === AppearanceMode.SYSTEM
  );
}
