/**
 * Wires the shimmer post-processor to the renderer lifecycle.
 *
 * When the aggregate view is shown, registers applyShimmerPostProcess
 * as a post-process function. While shimmer is active, drives rendering
 * with a targeted timer that only requests frames when the shimmer sweep
 * crosses a character boundary — the only times the visual output actually
 * changes. Between crossings, the buffer is unchanged and no render is needed.
 *
 * This keeps CPU usage proportional to the actual visual change rate:
 * ~16 frames per 2.5s sweep for a 40-char label instead of 75 frames
 * at 30fps. At idle (no shimmer), zero renders are scheduled.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { CliRenderer } from '@opentui/core';
import { applyShimmerPostProcess } from '../../../core/shimmer-postprocess';
import {
  shimmerStates,
  subscribeToShimmerStateChange,
  getShimmerSweepPosition,
  DEFAULT_CONFIG,
} from '../../../core/shimmer';
import {
  clearShimmerRowPositions,
  getAllShimmerRowPositions,
} from '../../../core/shimmer-registry';

export function useShimmerPostProcess(renderer: CliRenderer, isActive: () => boolean): void {
  let registered = false;
  let animationTimer: ReturnType<typeof setTimeout> | null = null;

  const postProcessFn = applyShimmerPostProcess;

  function register(): void {
    if (registered) return;
    renderer.addPostProcessFn(postProcessFn);
    registered = true;
  }

  function unregister(): void {
    if (!registered) return;
    renderer.removePostProcessFn(postProcessFn);
    clearShimmerRowPositions();
    registered = false;
  }

  /**
   * Calculate the time until the shimmer sweep crosses the next character
   * boundary for any active shimmer. Returns the minimum delay across all
   * active shimmer states, or null if no shimmer is active.
   *
   * For a sweep moving at (labelLength / sweepDuration) characters per ms,
   * the time to cross one character is (sweepDuration / labelLength) ms.
   * We use the minimum across all active shimmers to ensure the fastest
   * one gets serviced.
   */
  function getTimeToNextBoundary(): number | null {
    const positions = getAllShimmerRowPositions();
    if (positions.size === 0 || shimmerStates.size === 0) return null;

    let minDelay = Infinity;

    for (const [ptyId, pos] of positions) {
      const state = shimmerStates.get(ptyId);
      if (!state) continue;

      const labelLength = pos.labelLength;
      if (labelLength <= 0) continue;

      // Time per character crossing for this shimmer
      const msPerChar = state.sweepDuration / labelLength;

      // How far into the current character cell is the sweep?
      const sweepPos = getShimmerSweepPosition(ptyId, labelLength);
      if (sweepPos === null) continue;

      // Fractional position within the current character
      const fractional = sweepPos % 1;
      // Time until the sweep reaches the next integer position
      const delay = (1 - fractional) * msPerChar;

      if (delay < minDelay) {
        minDelay = delay;
      }
    }

    return minDelay === Infinity ? null : Math.max(minDelay, 1);
  }

  function startAnimation(): void {
    if (animationTimer) return;
    scheduleNextFrame();
  }

  function stopAnimation(): void {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
  }

  function scheduleNextFrame(): void {
    // Request an immediate first frame so shimmer appears without delay
    renderer.requestRender();

    // Then schedule subsequent frames at character-boundary crossings
    const delay = getTimeToNextBoundary();
    if (delay === null) {
      animationTimer = null;
      return;
    }
    animationTimer = setTimeout(tick, delay);
  }

  function tick(): void {
    if (!isActive() || shimmerStates.size === 0) {
      animationTimer = null;
      return;
    }
    scheduleNextFrame();
  }

  // Register/unregister based on aggregate view visibility
  createEffect(() => {
    if (isActive()) {
      register();
    } else {
      unregister();
      stopAnimation();
    }
  });

  // Start/stop animation based on shimmer state
  const updateLiveState = (): void => {
    if (!isActive()) return;
    if (shimmerStates.size > 0) {
      startAnimation();
    } else {
      stopAnimation();
    }
  };

  // Subscribe to shimmer state changes to update animation
  const unsubscribe = subscribeToShimmerStateChange(updateLiveState);

  // Also run on effect re-evaluation
  createEffect(() => {
    if (isActive()) {
      updateLiveState();
    }
  });

  onCleanup(() => {
    unregister();
    stopAnimation();
    unsubscribe();
  });
}
