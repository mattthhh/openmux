/**
 * Wires the shimmer post-processor to the renderer lifecycle.
 *
 * When the aggregate view is shown, registers applyShimmerPostProcess
 * as a post-process function and marks the renderer as "live" so frames
 * continue while any shimmer is animating. When the view is hidden,
 * the post-processor and live status are removed.
 *
 * Shimmer animation becomes fully native: the sweep is applied via
 * colorMatrix + cellMask with zero SolidJS reactive overhead.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { CliRenderer } from '@opentui/core';
import { applyShimmerPostProcess } from '../../../core/shimmer-postprocess';
import { shimmerStates, subscribeToShimmerStateChange } from '../../../core/shimmer';
import { clearShimmerRowPositions } from '../../../core/shimmer-registry';

export function useShimmerPostProcess(renderer: CliRenderer, isActive: () => boolean): void {
  let registered = false;
  let liveRetained = false;

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

  function retainLive(): void {
    if (liveRetained) return;
    renderer.requestLive();
    liveRetained = true;
  }

  function releaseLive(): void {
    if (!liveRetained) return;
    renderer.dropLive();
    liveRetained = false;
  }

  // Register/unregister based on aggregate view visibility
  createEffect(() => {
    if (isActive()) {
      register();
    } else {
      unregister();
      releaseLive();
    }
  });

  // Keep renderer live while any shimmer is active
  const updateLiveState = (): void => {
    if (!isActive()) return;
    if (shimmerStates.size > 0) {
      retainLive();
    } else {
      releaseLive();
    }
  };

  // Subscribe to shimmer state changes to update live status
  const unsubscribe = subscribeToShimmerStateChange(updateLiveState);

  // Also run on effect re-evaluation
  createEffect(() => {
    if (isActive()) {
      updateLiveState();
    }
  });

  onCleanup(() => {
    unregister();
    releaseLive();
    unsubscribe();
  });
}
