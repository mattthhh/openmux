/**
 * Shimmer registry - tracks buffer positions of shimmering PTY rows.
 *
 * PtyTreeRow instances register their screen positions here so the
 * native post-processor can build a cellMask targeting the right cells.
 * Positions are in absolute buffer coordinates (screenX, screenY).
 */

export interface ShimmerRowPosition {
  /** Absolute buffer Y coordinate of the row */
  y: number;
  /** Absolute buffer X coordinate where the label starts */
  labelStartX: number;
  /** Length of the label text */
  labelLength: number;
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
