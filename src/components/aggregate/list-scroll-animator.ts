/**
 * Smooth scroll animator for the aggregate view sidebar list.
 *
 * Wraps the PTY ScrollAnimator with a single key ("list") so the sidebar
 * benefits from the same chase-pattern animation used for terminal
 * viewports. Each scroll event sets the target by 1 line; the animation
 * loop chases it at configurable speed/easing.
 *
 * Navigation-driven selection changes and direct offset setters
 * (setListScrollOffset, open/close) snap immediately — only wheel
 * and page-scroll input is animated.
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
   * Same pattern as PTY scroll: uses the animator's target as base when
   * actively chasing (accumulates same-direction input), otherwise starts
   * from the current display offset.
   */
  scrollBy(delta: number, maxOffset: number): void {
    const active = this.animator.isAnimating(LIST_KEY);
    const animTarget = active ? this.animator.getTargetOffset(LIST_KEY) : undefined;
    const baseOffset = animTarget ?? this.animator.getCurrentOffset(LIST_KEY) ?? 0;
    const targetOffset = Math.max(0, Math.min(maxOffset, baseOffset + delta));

    if (animTarget === undefined) {
      this.animator.initialize(LIST_KEY, baseOffset);
    }
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
