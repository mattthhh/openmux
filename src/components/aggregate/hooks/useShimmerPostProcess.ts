/**
 * Shimmer post-processor using OpenTUI's postProcessFn pipeline.
 *
 * Applies shimmer color darkening by modifying the render buffer's
 * cell FG colors during the post-process step, which runs AFTER
 * SolidJS writes to the buffer and BEFORE the native diff engine
 * reads it. This avoids the race condition between direct
 * process.stdout.write() and the native renderer's threaded stdout
 * output (useThread=true).
 *
 * Architecture:
 * - setTimeout chain calls requestRender() at ~30fps
 * - On each render cycle, PtyTreeRow's renderAfter registers
 *   shimmer row positions in the shimmer-registry
 * - This postProcessFn reads those positions and modifies FG
 *   colors in the buffer before the native diff runs
 * - The diff engine writes the modified colors as normal ANSI
 * - No direct stdout writes, no threading races
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

export function useShimmerPostProcess(_renderer: CliRenderer, isActive: () => boolean): void {
  let animationTimer: ReturnType<typeof setTimeout> | null = null;

  function requestShimmerFrame(): void {
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

    // Request a render cycle. The postProcessFn will apply shimmer
    // to the buffer before the native diff engine reads it.
    _renderer.requestRender();
  }

  function startAnimation(): void {
    if (animationTimer) return;

    const tick = (): void => {
      if (!isActive() || shimmerStates.size === 0) {
        animationTimer = null;
        return;
      }
      requestShimmerFrame();
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

  // Post-process function: modifies FG colors in the render buffer
  // for cells that should shimmer. Runs after SolidJS writes (and
  // renderAfter registers positions) but before the diff engine.
  function applyShimmer(_buffer: unknown, _deltaTime: number): void {
    if (!isActive() || shimmerStates.size === 0) return;

    const now = Date.now();
    const positions = getAllShimmerRowPositions();
    if (positions.size === 0) return;

    const buffer = _buffer as {
      buffers?: {
        fg: Uint16Array;
      };
      width?: number;
    };

    const bufs = buffer.buffers;
    const bufWidth = buffer.width;
    if (!bufs || !bufWidth) return;

    const fgArr = bufs.fg;
    const bandHalfWidth = DEFAULT_CONFIG.bandHalfWidth;
    const maxBlend = DEFAULT_CONFIG.maxBlend;

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
        const cellIndex = y * bufWidth + x;
        const off = cellIndex * 4;

        // Write RGB values, preserving the metadata byte (high byte).
        // Packed format: [R | meta_byte_0<<8, G | meta_byte_1<<8, ...]
        fgArr[off] = (fgArr[off] & 0xff00) | r;
        fgArr[off + 1] = (fgArr[off + 1] & 0xff00) | g;
        fgArr[off + 2] = (fgArr[off + 2] & 0xff00) | b;
        // Alpha and meta bytes unchanged
      }
    }
  }

  // Register with OpenTUI's post-process pipeline
  (_renderer as any).addPostProcessFn(applyShimmer);

  createEffect(() => {
    if (!isActive()) {
      clearShimmerRowPositions();
      stopAnimation();
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
    (_renderer as any).removePostProcessFn(applyShimmer);
    unsubscribe();
  });
}
