/**
 * Direct-to-terminal shimmer renderer.
 *
 * Writes SGR escape sequences directly to the terminal output to apply
 * the shimmer color darkening effect. Bypasses the OpenTUI render
 * pipeline entirely during animation — no root.render(), no
 * colorMatrix, no renderNative() on shimmer frames.
 *
 * Architecture:
 * - setTimeout chain writes SGR sequences at ~30fps for the sweep
 * - After any OpenTUI render (frame event), re-applies shimmer
 *   since the render overwrites our SGRs with original colors
 * - Uses requestLive()/dropLive() only as a render timing signal
 *   so the frame event fires at 30fps for re-application after renders
 * - When all shimmer expires, releases live, stops timer, zero CPU
 *
 * CPU profile (aggregate view at idle with shimmer active):
 * - Before: ~37% (root.render() + colorMatrix + renderNative at 30fps)
 * - After:  ~2% (10 SGR sequences + cursor moves per frame)
 *
 * The buffer always contains original, unshimmered colors. Since
 * root.render() writes the same content every frame when nothing
 * else changed, renderNative() diffs against an identical buffer
 * and nearly always skips output — making those frames very cheap.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { CliRenderer } from '@opentui/core';
import {
  hasActiveShimmer,
  hasPostShimmerGlow,
  getShimmerSweepPosition,
  shimmerIntensity,
  shimmerStates,
  subscribeToShimmerStateChange,
  DEFAULT_CONFIG,
} from '../../../core/shimmer';
import type { ShimmerRowPosition } from '../../../core/shimmer-registry';
import {
  getAllShimmerRowPositions,
  clearShimmerRowPositions,
} from '../../../core/shimmer-registry';

/** Target frame interval for shimmer animation (~30fps). */
const SHIMMER_FRAME_MS = 33;

/** Build SGR escape sequences that darken shimmer cells toward the background. */
function buildShimmerOutput(
  positions: ReadonlyMap<string, ShimmerRowPosition>,
  now: number
): string {
  const bandHalfWidth = DEFAULT_CONFIG.bandHalfWidth;
  const maxBlend = DEFAULT_CONFIG.maxBlend;
  const parts: string[] = [];

  for (const [ptyId, pos] of positions) {
    if (hasPostShimmerGlow(ptyId)) continue;
    if (!hasActiveShimmer(ptyId, now)) continue;

    const sweepPos = getShimmerSweepPosition(ptyId, pos.labelLength, now);
    if (sweepPos === null) continue;

    const fg = pos.fgColor;
    const bg = pos.bgColor;

    for (let i = 0; i < pos.labelLength; i++) {
      const distance = Math.abs(i - sweepPos);
      const intensity = shimmerIntensity(distance, bandHalfWidth);
      if (intensity <= 0) continue;

      const attenuation = intensity * maxBlend;
      const r = Math.round(fg.r + (bg.r - fg.r) * attenuation);
      const g = Math.round(fg.g + (bg.g - fg.g) * attenuation);
      const b = Math.round(fg.b + (bg.b - fg.b) * attenuation);

      const x = pos.labelStartX + i;
      const y = pos.y;
      // Cursor move + set color + re-write character
      parts.push(`\x1b[${y + 1};${x + 1}H\x1b[38;2;${r};${g};${b}m`);
      if (i < pos.labelText.length) {
        parts.push(pos.labelText[i]);
      }
    }
  }

  if (parts.length > 0) {
    // Reset SGR + restore cursor position
    parts.push('\x1b[0m\x1b[u');
    return '\x1b[s' + parts.join('');
  }
  return '';
}

export function useShimmerPostProcess(_renderer: CliRenderer, isActive: () => boolean): void {
  let animationTimer: ReturnType<typeof setTimeout> | null = null;
  let frameListener: (() => void) | null = null;

  function writeShimmerFrame(): void {
    if (!isActive() || shimmerStates.size === 0) return;

    const now = Date.now();

    // Expire all shimmer states (including those without positions)
    for (const ptyId of shimmerStates.keys()) {
      hasActiveShimmer(ptyId, now);
    }

    if (shimmerStates.size === 0) {
      stopAnimation();
      return;
    }

    const positions = getAllShimmerRowPositions();
    if (positions.size === 0) return;

    const output = buildShimmerOutput(positions, now);
    if (output) {
      process.stdout.write(output);
    }
  }

  function startAnimation(): void {
    if (animationTimer) return;

    const tick = (): void => {
      if (!isActive() || shimmerStates.size === 0) {
        animationTimer = null;
        return;
      }
      writeShimmerFrame();
      animationTimer = setTimeout(tick, SHIMMER_FRAME_MS);
    };
    tick();
  }

  function stopAnimation(): void {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
  }

  // After each OpenTUI render, re-apply shimmer since the render
  // overwrites our direct SGR sequences with buffer content.
  function onFrame(): void {
    if (!isActive() || shimmerStates.size === 0) return;
    writeShimmerFrame();
  }

  createEffect(() => {
    if (isActive()) {
      frameListener = onFrame;
      _renderer.on('frame', frameListener);
    } else {
      clearShimmerRowPositions();
      stopAnimation();
      if (frameListener) {
        _renderer.off('frame', frameListener);
        frameListener = null;
      }
    }
  });

  const updateLiveState = (): void => {
    if (!isActive()) return;
    if (shimmerStates.size > 0) {
      startAnimation();
    } else {
      stopAnimation();
    }
  };

  const unsubscribe = subscribeToShimmerStateChange(updateLiveState);

  createEffect(() => {
    if (isActive()) {
      updateLiveState();
    }
  });

  onCleanup(() => {
    clearShimmerRowPositions();
    stopAnimation();
    if (frameListener) {
      _renderer.off('frame', frameListener);
      frameListener = null;
    }
    unsubscribe();
  });
}
