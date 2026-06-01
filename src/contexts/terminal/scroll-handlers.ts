/**
 * Scroll handlers for TerminalContext
 * Handles scroll operations with animated chase for mouse wheel scrolling.
 */

import type { TerminalScrollState } from '../../core/types';
import { clampScrollOffset, calculateScrollDelta } from '../../core/scroll-utils';
import { ScrollAnimator } from '../../terminal/scroll-animation';
import {
  getScrollState as getScrollStateFromBridge,
  setScrollOffsetSync,
  setScrollOffsetNoNotify,
  requestScrollAnimRender,
} from '../../effect/bridge';

export function createScrollHandlers(
  getScrollState: (ptyId: string) => TerminalScrollState | undefined
) {
  const animator = new ScrollAnimator({
    speed: 12,
    easing: 0.7,
  });

  // The animator is the sole writer of viewportOffset during animation.
  // onAnimate writes session + cache + viewState synchronously on every tick.
  // requestScrollAnimRender updates viewState.scrollState.viewportOffset and
  // calls requestRenderFrame (which coalesces internally via renderRequested flag).
  // This avoids the flicker gap where viewState still has the old value while
  // the animator has already set the new one.
  // The perf win over the pre-805fc026 approach: we don't call notifySubscribers
  // (which does FFI + cell conversion) — just a property write + coalesced render.
  animator.setOnAnimate((ptyId, offset) => {
    setScrollOffsetNoNotify(ptyId, offset);

    const cached = getScrollState(ptyId);
    if (cached) {
      (cached as { viewportOffset: number }).viewportOffset = offset;
      cached.isAtBottom = offset === 0;
    }

    requestScrollAnimRender(ptyId, offset);
  });

  const handleGetScrollState = (ptyId: string): TerminalScrollState | undefined => {
    return getScrollState(ptyId);
  };

  const scrollTerminal = (ptyId: string, delta: number): void => {
    const cached = getScrollState(ptyId);
    if (cached) {
      // Only use the animator's target as base when it's actively chasing.
      // After animation finishes, the stale targetOffset/curentOffset in
      // animator.states would cause a jump (e.g. offset adjusted by heavy
      // output in between, then next scroll uses the old target as base).
      const active = animator.isAnimating(ptyId);
      const animTarget = active ? animator.getTargetOffset(ptyId) : undefined;
      const baseOffset = animTarget ?? cached.viewportOffset;
      const targetOffset = calculateScrollDelta(baseOffset, delta, cached.scrollbackLength);
      if (animTarget === undefined) {
        animator.initialize(ptyId, cached.viewportOffset);
      }
      animator.setTarget(ptyId, targetOffset, cached.scrollbackLength);
    } else {
      getScrollStateFromBridge(ptyId).then((state) => {
        if (state) {
          const active = animator.isAnimating(ptyId);
          const animTarget = active ? animator.getTargetOffset(ptyId) : undefined;
          const baseOffset = animTarget ?? state.viewportOffset;
          const targetOffset = calculateScrollDelta(baseOffset, delta, state.scrollbackLength);
          if (animTarget === undefined) {
            animator.initialize(ptyId, state.viewportOffset);
          }
          animator.setTarget(ptyId, targetOffset, state.scrollbackLength);
        }
      });
    }
  };

  const handleSetScrollOffset = (ptyId: string, offset: number): void => {
    const cached = getScrollState(ptyId);
    const clampedOffset = cached
      ? clampScrollOffset(offset, cached.scrollbackLength)
      : Math.max(0, offset);
    animator.setTarget(ptyId, clampedOffset, cached?.scrollbackLength ?? clampedOffset);
    animator.snapToTarget(ptyId);
    setScrollOffsetNoNotify(ptyId, clampedOffset);
    // Write the offset directly to viewState via the render callback.
    // The subscriber doesn't write viewportOffset from the absolute value
    // (single-writer rule), so we must go through requestScrollAnimRender.
    requestScrollAnimRender(ptyId, clampedOffset);
    // Update the cache too — the subscriber's setScrollStateCache also
    // doesn't write viewportOffset from the absolute value.
    if (cached) {
      (cached as { viewportOffset: number }).viewportOffset = clampedOffset;
      cached.isAtBottom = clampedOffset === 0;
    }
    setScrollOffsetSync(ptyId, clampedOffset);
  };

  /** Programmatic scroll-to-bottom (not auto-called on keypress). */
  const handleScrollToBottom = (ptyId: string): void => {
    animator.setTarget(ptyId, 0, Number.MAX_SAFE_INTEGER);
    animator.snapToTarget(ptyId);
    setScrollOffsetNoNotify(ptyId, 0);
    const cached = getScrollState(ptyId);
    if (cached) {
      (cached as { viewportOffset: number }).viewportOffset = 0;
      cached.isAtBottom = true;
    }
    requestScrollAnimRender(ptyId, 0);
    setScrollOffsetSync(ptyId, 0);
  };

  const cleanup = (): void => {
    animator.cleanup();
  };

  const removeAnimation = (ptyId: string): void => {
    animator.remove(ptyId);
  };

  return {
    handleGetScrollState,
    scrollTerminal,
    handleSetScrollOffset,
    handleScrollToBottom,
    adjustAnimationOffset: (ptyId: string, delta: number) => animator.adjustOffset(ptyId, delta),
    isAnimating: (ptyId: string) => animator.isAnimating(ptyId),
    removeAnimation,
    cleanup,
  };
}
