/**
 * Shimmer state change subscription hook
 *
 * Exposes a version counter that increments whenever shimmer states change
 * (start, stop, clear). Components use this to subscribe to shimmer state
 * transitions without per-frame RAF overhead — the actual sweep animation
 * is applied via the native colorMatrix post-processor.
 */

import { createSignal, onCleanup } from 'solid-js';
import { subscribeToShimmerStateChange } from '../../../core/shimmer';

/**
 * Subscribe to shimmer state changes (start/stop) without subscribing to RAF.
 */
export function useShimmerStateVersion(): () => number {
  const [version, setVersion] = createSignal(0);
  const unsubscribe = subscribeToShimmerStateChange(() => {
    setVersion((current) => current + 1);
  });

  onCleanup(() => {
    unsubscribe();
  });

  return version;
}
