/**
 * Native post-processor for shimmer animation.
 *
 * Uses OpenTUI's colorMatrix + cellMask pipeline to apply the shimmer
 * sweep in native (Zig) code instead of per-character JS color blending.
 *
 * Architecture:
 * - PtyTreeRow instances register their buffer positions via shimmer-registry
 * - The post-processor reads active shimmer states from shimmer.ts
 * - Each frame, it builds a cellMask of (x, y, attenuation) triples
 *   for all cells that need shimmer adjustment
 * - buffer.colorMatrix() applies the transform natively in one call
 *
 * Shimmer effect: darkens FG text as the sweep band passes over it,
 * creating the "codex-style" dark shimmer. This is achieved with a
 * zero matrix that maps colors to black, with cellMask attenuation
 * controlling how much each cell is darkened.
 *
 * Post-shimmer glow: rendered as bold text in PtyTreeRow (not via
 * colorMatrix — bold weight ≠ color gain).
 */

import type { OptimizedBuffer } from '@opentui/core';
import { TargetChannel } from '@opentui/core';
import {
  hasActiveShimmer,
  hasPostShimmerGlow,
  getShimmerSweepPosition,
  shimmerIntensity,
  DEFAULT_CONFIG,
} from './shimmer';
import { getAllShimmerRowPositions } from './shimmer-registry';

/**
 * Zero matrix: maps all colors to zero (black).
 * With cellMask attenuation, lerps FG toward black:
 *   output = lerp(original, black, attenuation)
 * This creates the dark shimmer band sweeping across the label.
 */
const ZERO_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

/**
 * Apply shimmer as a native post-processing step.
 *
 * Called each frame via renderer.addPostProcessFn() while the aggregate
 * view is visible. Reads active shimmer states and registered row
 * positions, builds a cellMask, and applies colorMatrix in one call.
 */
export function applyShimmerPostProcess(buffer: OptimizedBuffer, _deltaTime: number): void {
  const now = Date.now();
  const positions = getAllShimmerRowPositions();

  if (positions.size === 0) return;

  const shimmerCells: number[] = [];
  // No glow cells — glow is handled via bold text in PtyTreeRow,
  // not via native colorMatrix (bold weight ≠ color gain)

  const bandHalfWidth = DEFAULT_CONFIG.bandHalfWidth;
  const maxBlend = DEFAULT_CONFIG.maxBlend;

  for (const [ptyId, pos] of positions) {
    // Skip PTYs with post-shimmer glow — glow is rendered as bold text
    // in PtyTreeRow, not via native colorMatrix
    if (hasPostShimmerGlow(ptyId)) continue;

    // Check active shimmer
    if (!hasActiveShimmer(ptyId, now)) continue;

    // Get the sweep position from shimmer state
    const sweepPos = getShimmerSweepPosition(ptyId, pos.labelLength, now);
    if (sweepPos === null) continue;

    for (let i = 0; i < pos.labelLength; i++) {
      const distance = Math.abs(i - sweepPos);
      const intensity = shimmerIntensity(distance, bandHalfWidth);

      if (intensity > 0) {
        const attenuation = intensity * maxBlend;
        shimmerCells.push(pos.labelStartX + i, pos.y, attenuation);
      }
    }
  }

  // Apply shimmer sweep (darken FG toward black)
  if (shimmerCells.length > 0) {
    const cellMask = new Float32Array(shimmerCells);
    buffer.colorMatrix(ZERO_MATRIX, cellMask, 1, TargetChannel.FG);
  }
}
