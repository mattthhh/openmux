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
  scrollToBottom as scrollToBottomBridge,
  requestScrollAnimRender,
} from '../../effect/bridge';

export function createScrollHandlers(
  getScrollState: (ptyId: string) => TerminalScrollState | undefined
) {
  const animator = new ScrollAnimator({
    speed: 12,
    easing: 0.7,
  });

  let renderCoalesced = false;

  // The animator is the sole writer of viewportOffset during animation.
  // onAnimate writes session state + cache + schedules one coalesced render.
  // The subscriber must NOT write viewportOffset while the animator is active.
  animator.setOnAnimate((ptyId, offset) => {
    // Write to session state (no notification — that's the perf win)
    setScrollOffsetNoNotify(ptyId, offset);

    // Write to the cache so scrollTerminal reads the correct base offset
    const cached = getScrollState(ptyId);
    if (cached) {
      (cached as { viewportOffset: number }).viewportOffset = offset;
    }

    // Coalesce renders: one per frame after all animation ticks
    if (!renderCoalesced) {
      renderCoalesced = true;
      const finalPtyId = ptyId;
      queueMicrotask(() => {
        renderCoalesced = false;
        const finalOffset = cached?.viewportOffset ?? 0;
        requestScrollAnimRender(finalPtyId, finalOffset);
      });
    }
  });

  const handleGetScrollState = (ptyId: string): TerminalScrollState | undefined => {
    return getScrollState(ptyId);
  };

  const scrollTerminal = (ptyId: string, delta: number): void => {
    const cached = getScrollState(ptyId);
    if (cached) {
      const currentTarget = animator.getTargetOffset(ptyId);
      const baseOffset = currentTarget ?? cached.viewportOffset;
      const targetOffset = calculateScrollDelta(baseOffset, delta, cached.scrollbackLength);
      if (currentTarget === undefined) {
        animator.initialize(ptyId, cached.viewportOffset);
      }
      animator.setTarget(ptyId, targetOffset, cached.scrollbackLength);
    } else {
      getScrollStateFromBridge(ptyId).then((state) => {
        if (state) {
          const currentTarget = animator.getTargetOffset(ptyId);
          const baseOffset = currentTarget ?? state.viewportOffset;
          const targetOffset = calculateScrollDelta(baseOffset, delta, state.scrollbackLength);
          if (currentTarget === undefined) {
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
    setScrollOffsetSync(ptyId, clampedOffset);
  };

  const handleScrollToBottom = (ptyId: string): void => {
    animator.setTarget(ptyId, 0, Number.MAX_SAFE_INTEGER);
    animator.snapToTarget(ptyId);
    // Synchronously update session + cache — the animator's onAnimate
    // won't fire (snapToTarget doesn't trigger onAnimate)
    setScrollOffsetNoNotify(ptyId, 0);
    const cached = getScrollState(ptyId);
    if (cached) {
      (cached as { viewportOffset: number }).viewportOffset = 0;
    }
    requestScrollAnimRender(ptyId, 0);
    scrollToBottomBridge(ptyId);
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
