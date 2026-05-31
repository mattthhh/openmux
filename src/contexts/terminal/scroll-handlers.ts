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

  // Track the last offset we wrote per-pty via setScrollOffsetNoNotify.
  const lastWrittenOffset = new Map<string, number>();

  // Coalesce animation renders.
  let renderCoalesced = false;

  // The animator is the sole owner of the scroll offset during animation.
  // onAnimate ONLY writes the offset and schedules a render. It does NOT
  // read from the cache or detect external adjustments. All external changes
  // go through explicit paths:
  //   - Scrollback growth: subscriber calls adjustAnimationOffset()
  //   - Keypress snap-to-bottom: keyboard handler calls handleScrollToBottom()
  animator.setOnAnimate((ptyId, offset) => {
    lastWrittenOffset.set(ptyId, offset);
    setScrollOffsetNoNotify(ptyId, offset);

    if (!renderCoalesced) {
      renderCoalesced = true;
      const finalPtyId = ptyId;
      queueMicrotask(() => {
        renderCoalesced = false;
        const finalOffset = lastWrittenOffset.get(finalPtyId) ?? 0;
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
        lastWrittenOffset.set(ptyId, cached.viewportOffset);
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
            lastWrittenOffset.set(ptyId, state.viewportOffset);
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
    lastWrittenOffset.set(ptyId, clampedOffset);
    setScrollOffsetSync(ptyId, clampedOffset);
  };

  const handleScrollToBottom = (ptyId: string): void => {
    animator.setTarget(ptyId, 0, Number.MAX_SAFE_INTEGER);
    animator.snapToTarget(ptyId);
    lastWrittenOffset.set(ptyId, 0);
    scrollToBottomBridge(ptyId);
  };

  const cleanup = (): void => {
    animator.cleanup();
    lastWrittenOffset.clear();
  };

  const removeAnimation = (ptyId: string): void => {
    animator.remove(ptyId);
    lastWrittenOffset.delete(ptyId);
  };

  return {
    handleGetScrollState,
    scrollTerminal,
    handleSetScrollOffset,
    handleScrollToBottom,
    adjustAnimationOffset: (ptyId: string, delta: number) => animator.adjustOffset(ptyId, delta),
    removeAnimation,
    cleanup,
  };
}
