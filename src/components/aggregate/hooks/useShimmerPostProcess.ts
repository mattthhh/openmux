/**
 * Direct-to-terminal shimmer renderer.
 *
 * Instead of modifying the render buffer via colorMatrix (which forces
 * a full root.render() + renderNative() pipeline on every frame), writes
 * SGR escape sequences directly to the terminal after each render.
 *
 * The buffer always contains original, unshimmered colors. This means
 * renderNative() diffs against an identical previous buffer and finds
 * no changes — making each frame nearly free when nothing else changed.
 * Our SGR writes happen after renderNative(), overriding the on-screen
 * colors for shimmer cells without touching the buffer.
 *
 * Uses requestLive() for smooth 30fps timing with the render loop.
 * After each frame, re-applies shimmer SGRs. When all shimmer expires,
 * releases the live request and the renderer stops.
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

      // Cursor move + set color + re-write character
      const x = pos.labelStartX + i;
      const y = pos.y;
      parts.push(`\x1b[${y + 1};${x + 1}H\x1b[38;2;${r};${g};${b}m`);
      if (i < pos.labelText.length) {
        parts.push(pos.labelText[i]);
      }
    }
  }

  if (parts.length > 0) {
    // Reset SGR + restore cursor
    parts.push('\x1b[0m\x1b[u');
    return '\x1b[s' + parts.join('');
  }
  return '';
}

export function useShimmerPostProcess(renderer: CliRenderer, isActive: () => boolean): void {
  let registered = false;
  let liveRetained = false;
  let frameListener: ((frame: { frameId: number }) => void) | null = null;

  const registerFrameListener = (): void => {
    if (frameListener) return;
    frameListener = () => {
      if (!isActive() || shimmerStates.size === 0) return;

      // Expire all shimmer states (including those without positions)
      const now = Date.now();
      for (const ptyId of shimmerStates.keys()) {
        hasActiveShimmer(ptyId, now);
      }
      if (shimmerStates.size === 0) return;

      // Write shimmer SGRs directly to terminal after the render.
      // The buffer has original (unshimmered) colors, so renderNative()
      // outputs them. Our SGRs then override the on-screen colors.
      const positions = getAllShimmerRowPositions();
      if (positions.size === 0) return;
      const output = buildShimmerOutput(positions, now);
      if (output) {
        process.stdout.write(output);
      }
    };
    renderer.on('frame', frameListener);
  };

  const unregisterFrameListener = (): void => {
    if (frameListener) {
      renderer.off('frame', frameListener);
      frameListener = null;
    }
  };

  const retainLive = (): void => {
    if (liveRetained) return;
    renderer.requestLive();
    liveRetained = true;
  };

  const releaseLive = (): void => {
    if (!liveRetained) return;
    renderer.dropLive();
    liveRetained = false;
  };

  createEffect(() => {
    if (isActive()) {
      registerFrameListener();
    } else {
      clearShimmerRowPositions();
      releaseLive();
      unregisterFrameListener();
    }
  });

  const updateLiveState = (): void => {
    if (!isActive()) return;
    if (shimmerStates.size > 0) {
      retainLive();
    } else {
      releaseLive();
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
    releaseLive();
    unregisterFrameListener();
    unsubscribe();
  });
}
