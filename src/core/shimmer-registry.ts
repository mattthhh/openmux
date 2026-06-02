/**
 * Shimmer registry - tracks buffer positions of shimmering PTY rows.
 *
 * PtyTreeRow instances register their screen positions here so the
 * direct-to-terminal shimmer renderer can write SGR escape sequences
 * for the affected cells. Positions are in terminal coordinates
 * (screenX, screenY) and include FG/BG colors and label text for
 * computing the darkened shimmer color directly.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Parse a hex color string (#rrggbb) into RgbColor. */
export function hexToRgb(hex: string): RgbColor {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

export interface ShimmerRowPosition {
  /** Terminal Y coordinate (1-based for ANSI, stored 0-based) */
  y: number;
  /** Terminal X coordinate where the label starts (0-based) */
  labelStartX: number;
  /** Length of the label text */
  labelLength: number;
  /** The label text (needed to re-write characters with new SGR color) */
  labelText: string;
  /** Foreground color of the label text */
  fgColor: RgbColor;
  /** Background color (shimmer target — the color we lerp toward) */
  bgColor: RgbColor;
}

const rowPositions = new Map<string, ShimmerRowPosition>();

export function registerShimmerRow(ptyId: string, position: ShimmerRowPosition): void {
  rowPositions.set(ptyId, position);
}

export function unregisterShimmerRow(ptyId: string): void {
  rowPositions.delete(ptyId);
}

export function getAllShimmerRowPositions(): ReadonlyMap<string, ShimmerRowPosition> {
  return rowPositions;
}

export function clearShimmerRowPositions(): void {
  rowPositions.clear();
}
