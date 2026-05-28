import { getCachedRGBA } from '../../terminal/rendering';

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/;

export function resolveThemeColor(value: string, fallback: ReturnType<typeof getCachedRGBA>) {
  const match = HEX_COLOR_RE.exec(value);
  if (!match) return fallback;
  const parsed = parseInt(match[1], 16);
  return getCachedRGBA((parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff);
}
