/**
 * Scroll animation system for smooth viewport scrolling.
 *
 * Decouples scroll input from render output using a chase pattern:
 * - Scroll events update a TARGET offset immediately (no render)
 * - An animation loop chases the target, rendering intermediate
 *   integer offsets per frame
 *
 * On fast scrolling, the target jumps far ahead and the animation
 * converges proportionally faster (spring-like pull). On slow
 * scrolling, the animation eases gently into place.
 *
 * This avoids the throttling problem of immediate 1-line-per-event
 * scrolling where rendering is in the hot path and can't keep up
 * with rapid input.
 */

/** Per-pty scroll animation state */
export interface ScrollAnimationState {
  /** The offset we're animating toward (set immediately by scroll input) */
  targetOffset: number;
  /** The offset we're currently displaying (animated, always integer) */
  currentOffset: number;
  /** Speed of convergence: lines per frame when distance > 1 */
  speed: number;
  /** Whether this animation is active (target !== current) */
  active: boolean;
}

/** Spring configuration */
export interface ScrollSpringConfig {
  /** Lines per frame when distance > 1. Higher = snappier. Default: 2 */
  speed: number;
  /** Ratio of remaining distance to move per frame when distance <= speed.
   * Higher = less easing, more snappy. 1.0 = instant snap. Default: 0.5 */
  easing: number;
}

const DEFAULT_SPRING_CONFIG: ScrollSpringConfig = {
  speed: 2,
  easing: 0.5,
};

/**
 * Animated scroll controller.
 *
 * Create one instance per component that handles scroll (Pane, AggregateView).
 * Call `setTarget()` on scroll events, `tick()` on each animation frame,
 * and `cleanup()` on unmount.
 */
export class ScrollAnimator {
  private states = new Map<string, ScrollAnimationState>();
  private config: ScrollSpringConfig;
  private loopScheduled = false;
  private onAnimate: ((ptyId: string, offset: number) => void) | null = null;
  private activePtyIds = new Set<string>();

  constructor(
    config?: Partial<ScrollSpringConfig>,
    onAnimate?: (ptyId: string, offset: number) => void
  ) {
    this.config = { ...DEFAULT_SPRING_CONFIG, ...config };
    this.onAnimate = onAnimate ?? null;
  }

  /**
   * Set the callback that applies scroll offset changes.
   * Called with (ptyId, newIntegerOffset) when the animation steps.
   */
  setOnAnimate(callback: (ptyId: string, offset: number) => void): void {
    this.onAnimate = callback;
  }

  /**
   * Update the target offset for a pty.
   * This is called on scroll events - no render happens here.
   * The animation loop will chase this target on subsequent frames.
   */
  setTarget(ptyId: string, targetOffset: number, maxOffset: number): void {
    const clamped = Math.max(0, Math.min(targetOffset, maxOffset));

    let state = this.states.get(ptyId);
    if (!state) {
      state = {
        targetOffset: clamped,
        currentOffset: clamped,
        speed: this.config.speed,
        active: false,
      };
      this.states.set(ptyId, state);
    } else {
      state.targetOffset = clamped;
    }

    // If target differs from current, activate animation
    if (state.targetOffset !== state.currentOffset) {
      if (!state.active) {
        state.active = true;
        this.activePtyIds.add(ptyId);
        this.ensureLoop();
      }
    }
  }

  /**
   * Initialize state for a pty with a known current offset
   * (e.g., after subscription delivers initial scroll state).
   */
  initialize(ptyId: string, currentOffset: number): void {
    let state = this.states.get(ptyId);
    if (!state) {
      this.states.set(ptyId, {
        targetOffset: currentOffset,
        currentOffset: currentOffset,
        speed: this.config.speed,
        active: false,
      });
    } else {
      // Snap current to match (don't animate to a stale position)
      state.currentOffset = currentOffset;
    }
  }

  /**
   * Clear state for a pty (on unmount/destroy).
   */
  remove(ptyId: string): void {
    this.states.delete(ptyId);
    this.activePtyIds.delete(ptyId);
    if (this.activePtyIds.size === 0) {
      this.stopLoop();
    }
  }

  /**
   * Get the current animated offset for a pty.
   * Returns undefined if no state exists.
   */
  getCurrentOffset(ptyId: string): number | undefined {
    return this.states.get(ptyId)?.currentOffset;
  }

  /**
   * Get the target offset for a pty.
   */
  getTargetOffset(ptyId: string): number | undefined {
    return this.states.get(ptyId)?.targetOffset;
  }

  /**
   * Check if animation is active for a pty.
   */
  isAnimating(ptyId: string): boolean {
    return this.states.get(ptyId)?.active ?? false;
  }

  /**
   * Adjust both target and current offset by a delta.
   * Used when external factors (new output, scrollback reflow) shift
   * the viewport position, and the animator needs to track the change.
   *
   * If not currently animating, this is a no-op (the offset will be
   * refreshed naturally on the next scroll event or subscription update).
   * If animating, both target and current are shifted so the animation
   * continues chasing in the right direction without fighting the external
   * adjustment.
   */
  adjustOffset(ptyId: string, delta: number): void {
    const state = this.states.get(ptyId);
    if (!state || !state.active) return;
    state.targetOffset += delta;
    state.currentOffset += delta;
    // Clamp to valid range
    state.targetOffset = Math.max(0, state.targetOffset);
    state.currentOffset = Math.max(0, state.currentOffset);
  }

  /**
   * Immediately snap to target without animation.
   * Useful for scrollToBottom during typing or programmatic scroll jumps.
   */
  snapToTarget(ptyId: string): number {
    const state = this.states.get(ptyId);
    if (!state) return 0;
    state.currentOffset = state.targetOffset;
    state.active = false;
    this.activePtyIds.delete(ptyId);
    if (this.activePtyIds.size === 0) {
      this.stopLoop();
    }
    return state.currentOffset;
  }

  /**
   * Process one animation tick.
   * Returns true if any offset changed (caller should trigger render).
   */
  tick(): boolean {
    let changed = false;

    for (const ptyId of this.activePtyIds) {
      const state = this.states.get(ptyId);
      if (!state || !state.active) continue;

      const distance = state.targetOffset - state.currentOffset;
      if (distance === 0) {
        state.active = false;
        this.activePtyIds.delete(ptyId);
        continue;
      }

      let step: number;
      if (Math.abs(distance) <= this.config.speed) {
        // Close to target: apply easing for smooth settle
        // Easing: move by config.easing fraction of remaining distance,
        // but always at least 1 line to guarantee convergence
        step = Math.round(distance * this.config.easing);
        if (step === 0) step = distance > 0 ? 1 : -1;
      } else {
        // Far from target: move at full speed
        step = distance > 0 ? this.config.speed : -this.config.speed;
      }

      state.currentOffset += step;
      changed = true;

      // Notify caller of the new offset
      if (this.onAnimate) {
        this.onAnimate(ptyId, state.currentOffset);
      }
    }

    // Stop loop if no more active animations
    if (this.activePtyIds.size === 0) {
      this.stopLoop();
    }

    return changed;
  }

  /** Ensure the animation loop is running */
  private ensureLoop(): void {
    if (this.loopScheduled) return;
    this.loopScheduled = true;
    // setImmediate runs before setTimeout(0) I/O callbacks in Bun,
    // giving each animation tick higher scheduling priority than
    // drain/notification cycles. This prevents frame drops caused
    // by macrotask contention where setTimeout(0) callbacks from the
    // data pipeline (emulator notifications, drain cycles, background
    // pulse re-pauses) run before scroll animation ticks.
    //
    // The old setTimeout(0) pacing had 24-36 line jumps under concurrent
    // activity because multiple setTimeout(0) sources (drain + notify +
    // animator + re-pause) competed FIFO — a drain cycle could delay a
    // scroll tick by 4-16ms.
    //
    // setImmediate still yields between ticks (no microtask starvation),
    // but its higher priority ensures smooth scroll animation even when
    // the PTY data pipeline is active.
    setImmediate(() => {
      this.loopScheduled = false;
      this.tick();
      if (this.activePtyIds.size > 0) {
        this.ensureLoop();
      }
    });
  }

  /** Stop the animation loop */
  private stopLoop(): void {
    this.loopScheduled = false;
  }

  /** Clean up all state and stop the loop */
  cleanup(): void {
    this.stopLoop();
    this.states.clear();
    this.activePtyIds.clear();
  }
}
