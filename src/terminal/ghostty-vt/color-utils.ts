import type { TerminalCell } from '../../core/types';
import { areTerminalColorsEqual, type TerminalColors } from '../terminal-colors';

export function buildOscColorSequence(colors: TerminalColors): string {
  const format = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
  let osc = `\x1b]10;${format(colors.foreground)}\x07`;
  osc += `\x1b]11;${format(colors.background)}\x07`;
  osc += `\x1b]12;${format(colors.foreground)}\x07`;

  const palette = colors.palette;
  const count = Math.min(16, palette.length);
  for (let i = 0; i < count; i++) {
    osc += `\x1b]4;${i};${format(palette[i] ?? 0)}\x07`;
  }
  return osc;
}

export function cloneColors(colors: TerminalColors): TerminalColors {
  return {
    foreground: colors.foreground,
    background: colors.background,
    palette: colors.palette.slice(),
    isDefault: colors.isDefault,
  };
}

export function buildColorRemap(
  from: TerminalColors,
  to: TerminalColors
): Map<number, number> | null {
  if (areTerminalColorsEqual(from, to)) return null;
  const map = new Map<number, number>();
  if (from.foreground !== to.foreground) {
    map.set(from.foreground, to.foreground);
  }
  if (from.background !== to.background) {
    map.set(from.background, to.background);
  }

  const paletteSize = Math.min(from.palette.length, to.palette.length);
  for (let i = 0; i < paletteSize; i++) {
    const fromColor = from.palette[i];
    const toColor = to.palette[i];
    if (fromColor === toColor) continue;
    if (fromColor === from.foreground || fromColor === from.background) continue;
    map.set(fromColor, toColor);
  }

  return map.size ? map : null;
}

export function applyColorRemapToRow(row: TerminalCell[], remap: Map<number, number>): void {
  for (const cell of row) {
    const fgKey = (cell.fg.r << 16) | (cell.fg.g << 8) | cell.fg.b;
    const fgNext = remap.get(fgKey);
    if (fgNext !== undefined) {
      setRgb(cell.fg, fgNext);
    }
    const bgKey = (cell.bg.r << 16) | (cell.bg.g << 8) | cell.bg.b;
    const bgNext = remap.get(bgKey);
    if (bgNext !== undefined) {
      setRgb(cell.bg, bgNext);
    }
  }
}

function setRgb(target: { r: number; g: number; b: number }, color: number): void {
  target.r = (color >> 16) & 0xff;
  target.g = (color >> 8) & 0xff;
  target.b = color & 0xff;
}
