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
  /** Animated scroll controller — chases target offset per frame */
  const animator = new ScrollAnimator({
    speed: 12,
    easing: 0.7,
  });

  // Track the last offset we wrote per-pty via setScrollOffsetNoNotify.
  const lastWrittenOffset = new Map<string, number>();

  // Coalesce animation renders: the animator runs a tight microtask loop,
  // but we only need ONE render request per frame.
  let renderCoalesced = false;

  // When the animator steps, just update the session offset without
  // notifying subscribers. The animator owns the scroll offset during
  // animation — nothing else should override it.
  //
  // External adjustments (scrollback growth while scrolled up) are
  // handled by adjustAnimationOffset(), called from the subscriber in
  // unified-subscription.ts after it detects a scrollback length change.
  // We do NOT read the cache in onAnimate because the cache is unreliable:
  // it's replaced by the subscriber at any point and the in-place mutation
  // from registerScrollCacheUpdate can race with those replacements,
  // producing false external deltas that snap the animator to bottom.
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

  /**
   * Get scroll state for a PTY (sync when available)
   */
  const handleGetScrollState = (ptyId: string): TerminalScrollState | undefined => {
    return getScrollState(ptyId);
  };

  /**
   * Scroll terminal by delta lines (animated).
   * Used by mouse wheel scroll events — sets target, animation chases it.
   */
  const scrollTerminal = (ptyId: string, delta: number): void => {
    const cached = getScrollState(ptyId);
    if (cached) {
      // Use the animator's current offset (not the cache) as the base
      // so rapid scroll events accumulate on the target, not the render position
      const currentTarget = animator.getTargetOffset(ptyId);
      const baseOffset = currentTarget ?? cached.viewportOffset;
      const targetOffset = calculateScrollDelta(baseOffset, delta, cached.scrollbackLength);
      // Initialize animator with current position if new
      if (currentTarget === undefined) {
        animator.initialize(ptyId, cached.viewportOffset);
        lastWrittenOffset.set(ptyId, cached.viewportOffset);
      }
      animator.setTarget(ptyId, targetOffset, cached.scrollbackLength);
    } else {
      // Fallback: fetch state and then scroll (handles edge cases where cache isn't populated)
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

  /**
   * Set absolute scroll offset (immediate, no animation).
   * Used by scrollbar drag, copy mode, search — snaps directly.
   */
  const handleSetScrollOffset = (ptyId: string, offset: number): void => {
    const cached = getScrollState(ptyId);
    const clampedOffset = cached
      ? clampScrollOffset(offset, cached.scrollbackLength)
      : Math.max(0, offset);
    // Snap any in-flight animation to the new offset
    animator.setTarget(ptyId, clampedOffset, cached?.scrollbackLength ?? clampedOffset);
    animator.snapToTarget(ptyId);
    lastWrittenOffset.set(ptyId, clampedOffset);
    setScrollOffsetSync(ptyId, clampedOffset);
  };

  /**
   * Scroll terminal to bottom (immediate, no animation).
   */
  const handleScrollToBottom = (ptyId: string): void => {
    animator.setTarget(ptyId, 0, Number.MAX_SAFE_INTEGER);
    animator.snapToTarget(ptyId);
    lastWrittenOffset.set(ptyId, 0);
    scrollToBottomBridge(ptyId);
  };

  /**
   * Clean up animator resources (call on unmount)
   */
  const cleanup = (): void => {
    animator.cleanup();
    lastWrittenOffset.clear();
  };

  /**
   * Remove state for a destroyed PTY
   */
  const removeAnimation = (ptyId: string): void => {
    animator.remove(ptyId);
    lastWrittenOffset.delete(ptyId);
  };

  return {
    handleGetScrollState,
    scrollTerminal,
    handleSetScrollOffset,
    handleScrollToBottom,
    /** Expose animator for external offset adjustments (e.g., scrollback reflow) */
    adjustAnimationOffset: (ptyId: string, delta: number) => animator.adjustOffset(ptyId, delta),
    /** Snap the animator to a specific offset (e.g., emulator auto-scrolled to bottom) */
    snapAnimator: (ptyId: string, offset: number) => {
      const cached = getScrollState(ptyId);
      animator.setTarget(ptyId, offset, cached?.scrollbackLength ?? Number.MAX_SAFE_INTEGER);
      animator.snapToTarget(ptyId);
      lastWrittenOffset.set(ptyId, offset);
    },
    /** Remove animator state for a destroyed PTY */
    removeAnimation,
    cleanup,
  };
}
