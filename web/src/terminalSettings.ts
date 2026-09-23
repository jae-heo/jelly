export const FONT_SIZE = { min: 10, max: 24, default: 14 };
export const FONT_SIZE_KEY = 'jelly-font-size';

export function storedFontSize(): number {
  try {
    const value = Number(localStorage.getItem(FONT_SIZE_KEY));
    if (Number.isInteger(value) && value >= FONT_SIZE.min && value <= FONT_SIZE.max) return value;
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
  return FONT_SIZE.default;
}
