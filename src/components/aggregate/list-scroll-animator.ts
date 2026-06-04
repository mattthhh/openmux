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
  /** Lines per frame when distance > 1. Higher = snappier. Default: 3 */
  speed?: number;
  /** Easing ratio for settle. Default: 0.5 */
  easing?: number;
  /** Called on each animation tick with the new offset */
  onAnimate?: (offset: number) => void;
}

export class ListScrollAnimator {
  private animator: ScrollAnimator;
  private currentTarget = 0;
  private _onAnimate: ((offset: number) => void) | null;

  constructor(config?: ListScrollAnimatorConfig) {
    this._onAnimate = config?.onAnimate ?? null;
    this.animator = new ScrollAnimator({
      speed: config?.speed ?? 3,
      easing: config?.easing ?? 0.5,
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
   * The target is moved immediately; the animator chases it per-frame.
   */
  scrollBy(delta: number, maxOffset: number): void {
    this.currentTarget = Math.max(0, Math.min(maxOffset, this.currentTarget + delta));
    this.animator.setTarget(LIST_KEY, this.currentTarget, maxOffset);
  }

  /**
   * Snap both target and current to a specific offset (no animation).
   * Used for: selection-follow, open/close, setListScrollOffset.
   */
  snapTo(offset: number, maxOffset: number): void {
    const clamped = Math.max(0, Math.min(maxOffset, offset));
    this.currentTarget = clamped;
    this.animator.initialize(LIST_KEY, clamped);
    this.animator.setTarget(LIST_KEY, clamped, maxOffset);
    this.animator.snapToTarget(LIST_KEY);

    // Apply the snapped offset via the callback
    if (this._onAnimate) {
      this._onAnimate(clamped);
    }
  }

  /**
   * Initialize the animator with a known current offset
   * (e.g., when the aggregate view first opens).
   */
  initialize(offset: number): void {
    this.currentTarget = offset;
    this.animator.initialize(LIST_KEY, offset);
  }

  /** Get the current animated offset */
  getCurrentOffset(): number {
    return this.animator.getCurrentOffset(LIST_KEY) ?? this.currentTarget;
  }

  /** Get the target offset */
  getTargetOffset(): number {
    return this.currentTarget;
  }

  /** Whether the animator is actively chasing */
  isAnimating(): boolean {
    return this.animator.isAnimating(LIST_KEY);
  }

  /** Clean up on unmount */
  cleanup(): void {
    this.animator.cleanup();
    this.currentTarget = 0;
  }
}
