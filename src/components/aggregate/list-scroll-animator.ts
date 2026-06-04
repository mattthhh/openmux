/**
 * Smooth scroll animator for the aggregate view sidebar list.
 *
 * Wraps the PTY ScrollAnimator with a single key ("list") so the sidebar
 * benefits from the same chase-pattern animation used for terminal
 * viewports. Each scroll event sets the target by 1 line; the animation
 * loop chases it at configurable speed/easing.
 *
 * Unlike the PTY path which uses the animator's target as base for
 * same-direction scroll accumulation, the sidebar always uses the
 * current display offset. The sidebar's maxOffset (tree length) is
 * much larger than the viewport's real scroll range, so the target
 * can overshoot the display. Starting from the target would then
 * require many reversal events before the target crosses back into
 * the visible range. Starting from the displayed position avoids this
 * entirely — direction changes are instant.
 */

import { ScrollAnimator } from '../../terminal/scroll-animation';

const LIST_KEY = 'list';

export interface ListScrollAnimatorConfig {
  /** Lines per frame when distance > 1. Higher = snappier. Default: 12 */
  speed?: number;
  /** Easing ratio for settle. Higher = less easing. Default: 0.7 */
  easing?: number;
  /** Called on each animation tick with the new offset */
  onAnimate?: (offset: number) => void;
}

export class ListScrollAnimator {
  private animator: ScrollAnimator;
  private _onAnimate: ((offset: number) => void) | null;

  constructor(config?: ListScrollAnimatorConfig) {
    this._onAnimate = config?.onAnimate ?? null;
    this.animator = new ScrollAnimator({
      speed: config?.speed ?? 12,
      easing: config?.easing ?? 0.7,
    });
    if (this._onAnimate) {
      this.animator.setOnAnimate((_key, offset) => this._onAnimate!(offset));
    }
  }

  /** Set the animation callback after construction */
  setOnAnimate(cb: (offset: number) => void): void {
    this._onAnimate = cb;
    this.animator.setOnAnimate((_key, offset) => cb(offset));
  }

  /**
   * Scroll the list by a delta (e.g., +1 / -1 for wheel, +5 / -5 for page).
   *
   * Always uses the current display offset as the base, not the target.
   * The sidebar's maxOffset (tree length) exceeds the viewport's real
   * scroll range, so the target can overshoot. Starting from the displayed
   * position ensures direction changes take effect immediately.
   */
  scrollBy(delta: number, maxOffset: number): void {
    const currentOffset = this.animator.getCurrentOffset(LIST_KEY) ?? 0;
    const targetOffset = Math.max(0, Math.min(maxOffset, currentOffset + delta));
    this.animator.initialize(LIST_KEY, currentOffset);
    this.animator.setTarget(LIST_KEY, targetOffset, maxOffset);
  }

  /**
   * Snap both target and current to a specific offset (no animation).
   * Used for: selection-follow, open/close, setListScrollOffset.
   */
  snapTo(offset: number, maxOffset: number): void {
    const clamped = Math.max(0, Math.min(maxOffset, offset));
    this.animator.initialize(LIST_KEY, clamped);
    this.animator.setTarget(LIST_KEY, clamped, maxOffset);
    this.animator.snapToTarget(LIST_KEY);

    if (this._onAnimate) {
      this._onAnimate(clamped);
    }
  }

  /**
   * Initialize the animator with a known current offset
   * (e.g., when the aggregate view first opens).
   */
  initialize(offset: number): void {
    this.animator.initialize(LIST_KEY, offset);
  }

  /** Get the current animated offset */
  getCurrentOffset(): number {
    return this.animator.getCurrentOffset(LIST_KEY) ?? 0;
  }

  /** Whether the animator is actively chasing */
  isAnimating(): boolean {
    return this.animator.isAnimating(LIST_KEY);
  }

  /** Clean up on unmount */
  cleanup(): void {
    this.animator.cleanup();
  }
}
