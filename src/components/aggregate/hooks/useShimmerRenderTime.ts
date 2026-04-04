/**
 * Event-based shimmer render trigger
 *
 * Instead of 200 individual shimmer subscriptions, we use a single
 * requestAnimationFrame loop that updates a shared timestamp signal.
 * PTY rows read this timestamp to calculate their shimmer position.
 *
 * This gives us:
 * - One RAF loop instead of 200
 * - Lazy calculation (only active PTYs compute shimmer)
 * - Natural animation via SolidJS reactivity
 */

import { createSignal, onCleanup, type Accessor } from 'solid-js';

/** Polyfill for requestAnimationFrame in Bun/Node environment */
const raf =
  typeof (globalThis as any).requestAnimationFrame === 'function'
    ? (globalThis as any).requestAnimationFrame.bind(globalThis)
    : (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16);

/** Polyfill for cancelAnimationFrame */
const caf =
  typeof (globalThis as any).cancelAnimationFrame === 'function'
    ? (globalThis as any).cancelAnimationFrame.bind(globalThis)
    : (id: number) => clearTimeout(id);

/** Shared render timestamp for shimmer animation */
let globalRenderTime = Date.now();
const [renderTimeSignal, setRenderTimeSignal] = createSignal(Date.now());

/** RAF handle */
let rafId: number | null = null;

/** Number of active shimmer subscribers */
let subscriberCount = 0;

/**
 * Start the global shimmer animation loop.
 * Only runs when there are subscribers.
 */
function startRenderLoop(): void {
  if (rafId !== null) return;

  const tick = (): void => {
    globalRenderTime = Date.now();
    setRenderTimeSignal(globalRenderTime);
    rafId = raf(tick);
  };

  rafId = raf(tick);
}

/**
 * Stop the global shimmer animation loop.
 */
function stopRenderLoop(): void {
  if (rafId !== null) {
    caf(rafId);
    rafId = null;
  }
}

/**
 * Subscribe to the global render time signal.
 * Returns an accessor that reads the current render timestamp.
 * The component will re-render every frame while subscribed.
 */
export function useShimmerRenderTime(): Accessor<number> {
  // Track that we have an active subscriber
  subscriberCount++;

  if (subscriberCount === 1) {
    startRenderLoop();
  }

  onCleanup(() => {
    subscriberCount--;
    if (subscriberCount === 0) {
      stopRenderLoop();
    }
  });

  return renderTimeSignal;
}

/**
 * Get the current render time without subscribing (for memoized calculations).
 */
export function getRenderTime(): number {
  return globalRenderTime;
}

/**
 * Manually trigger a render update (for testing or forced refresh).
 */
export function triggerRenderUpdate(): void {
  setRenderTimeSignal(Date.now());
}
