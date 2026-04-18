/**
 * Scroll handlers for TerminalContext
 * Handles scroll operations with animated chase for mouse wheel scrolling.
 */

import type { TerminalScrollState } from '../../core/types';
import { clampScrollOffset, calculateScrollDelta } from '../../core/scroll-utils';
import { ScrollAnimator } from '../../terminal/scroll-animation';
import {
  getScrollState as getScrollStateFromBridge,
  setScrollOffset as setScrollOffsetBridge,
  scrollToBottom as scrollToBottomBridge,
} from '../../effect/bridge';

/**
 * Creates scroll handlers for TerminalContext.
 *
 * scrollTerminal (mouse wheel) uses the ScrollAnimator for smooth chase.
 * setScrollOffset (direct positioning: scrollbar drag, copy mode, search)
 * and scrollToBottom bypass animation and snap immediately.
 */
export function createScrollHandlers(
  getScrollState: (ptyId: string) => TerminalScrollState | undefined
) {
  /** Animated scroll controller — chases target offset per frame */
  const animator = new ScrollAnimator({
    speed: 2,
    easing: 0.5,
  });

  // Track the last offset we wrote per-pty via setScrollOffsetBridge.
  // This lets us distinguish "cache hasn't caught up with our write" from
  // "something externally changed the offset". Without this, the onAnimate
  // callback would misinterpret stale cache values as external adjustments
  // and cancel legitimate scroll-up animations.
  const lastWrittenOffset = new Map<string, number>();

  // When the animator steps, apply the new offset via the bridge
  // which triggers notifyScrollSubscribers → subscriber → render.
  //
  // We detect external adjustments (new output while scrolled back, or
  // auto-scroll-to-bottom on typing) by comparing the cache's
  // viewportOffset with our last written value. If the cache has moved
  // independently of our writes, an external adjustment happened.
  animator.setOnAnimate((ptyId, offset) => {
    const cached = getScrollState(ptyId);
    const lastWritten = lastWrittenOffset.get(ptyId) ?? 0;

    if (cached) {
      const externalDelta = cached.viewportOffset - lastWritten;
      if (externalDelta !== 0) {
        if (cached.viewportOffset === 0 && lastWritten !== 0) {
          // External scroll-to-bottom (e.g., user typed while scrolled back).
          // Cancel animation and snap to bottom.
          animator.setTarget(ptyId, 0, cached.scrollbackLength);
          animator.snapToTarget(ptyId);
          lastWrittenOffset.set(ptyId, 0);
          setScrollOffsetBridge(ptyId, 0);
          return;
        }
        // External adjustment (e.g., new output shifted the offset).
        // Rebase the animator relative to the external change.
        animator.adjustOffset(ptyId, externalDelta);
        offset += externalDelta;
      }
    }

    lastWrittenOffset.set(ptyId, offset);
    setScrollOffsetBridge(ptyId, offset);
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
    setScrollOffsetBridge(ptyId, clampedOffset);
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
    /** Remove animator state for a destroyed PTY */
    removeAnimation,
    cleanup,
  };
}
