/**
 * Wires the shimmer post-processor to the renderer lifecycle.
 *
 * When the aggregate view is shown, registers applyShimmerPostProcess
 * as a post-process function. While shimmer is active, drives rendering
 * with a targeted setTimeout chain that calls requestRender() — one frame
 * at a time at ~60fps. When no shimmer is active, no renders are scheduled.
 *
 * This avoids requestLive() which starts the full 30fps render loop
 * (SolidJS reconciliation + native output on every frame) even when only
 * the post-process overlay is changing. requestRender() does a single
 * frame with minimal reconciliation overhead since no SolidJS signals
 * have changed — only the post-process colorMatrix is applied to the
 * already-rendered buffer.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { CliRenderer } from '@opentui/core';
import { applyShimmerPostProcess } from '../../../core/shimmer-postprocess';
import { shimmerStates, subscribeToShimmerStateChange } from '../../../core/shimmer';
import { clearShimmerRowPositions } from '../../../core/shimmer-registry';

/** Target frame time for shimmer animation (~60fps). */
const SHIMMER_FRAME_MS = 16;

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

  function startAnimation(): void {
    if (animationTimer) return;
    // Drive shimmer with a setTimeout chain that calls requestRender().
    // Each call schedules exactly one frame. The post-process function
    // applies the shimmer sweep to the existing buffer. Since no SolidJS
    // signals change between frames, reconciliation is a no-op — only the
    // native rendering + post-process runs.
    //
    // Using setTimeout instead of requestLive() avoids the 30fps render
    // loop which does full SolidJS reconciliation + frame callbacks on
    // every frame. requestRender() does a single frame and stops.
    const tick = () => {
      if (!isActive() || shimmerStates.size === 0) {
        animationTimer = null;
        return;
      }
      renderer.requestRender();
      animationTimer = setTimeout(tick, SHIMMER_FRAME_MS);
    };
    // Start immediately — the first shimmer frame should appear ASAP.
    tick();
  }

  function stopAnimation(): void {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
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
