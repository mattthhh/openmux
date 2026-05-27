/**
 * Post-shimmer glow tests.
 * Tests for hasPostShimmerGlow and clearPostShimmerGlow — the "something
 * happened here" bright indicator shown after a shimmer sweep finishes.
 *
 * The glow persists until explicitly cleared (selection click, PTY removal,
 * or new shimmer). No auto-expiry timeout.
 *
 * NOTE: hasActiveShimmer is stateful — it processes ONE sweep transition per
 * call and mutates internal sweepCount/startTime. Tests either:
 * - Use times past the 15s max shimmer cap (guaranteed completion)
 * - Drive state transitions with intermediate hasActiveShimmer calls first
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordPtyStdoutActivity,
  clearPtyStdoutActivity,
  hasActiveShimmer,
  hasPostShimmerGlow,
  clearPostShimmerGlow,
  suppressPtyShimmer,
  unsuppressPtyShimmer,
} from '../shimmer';

/** Helper: advance shimmer through all sweeps by checking at intermediate times. */
function driveShimmerCompletion(ptyId: string, baseTime: number): void {
  // First sweep completes at +2500ms (approx)
  hasActiveShimmer(ptyId, baseTime + 2600);
  // Queued sweep (if any) completes at +5000ms (approx)
  hasActiveShimmer(ptyId, baseTime + 5100);
  // Safety: one more check past any remaining duration
  hasActiveShimmer(ptyId, baseTime + 7600);
}

describe('post-shimmer glow', () => {
  beforeEach(() => {
    clearPtyStdoutActivity('pty-1');
    clearPtyStdoutActivity('pty-2');
    unsuppressPtyShimmer('pty-1');
    unsuppressPtyShimmer('pty-2');
    clearPostShimmerGlow('pty-1');
    clearPostShimmerGlow('pty-2');
  });

  it('returns false when the PTY has never shimmered', () => {
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('returns true after shimmer naturally completes and persists', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    const afterShimmer = baseTime + 7700;
    expect(hasActiveShimmer('pty-1', afterShimmer)).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    // Still present later — no timeout expiry
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('is cleared by suppressPtyShimmer (selection click)', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    // Selection click clears glow
    suppressPtyShimmer('pty-1');
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('is cleared by clearPtyStdoutActivity (PTY removed)', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    clearPtyStdoutActivity('pty-1');
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('is cleared by clearPostShimmerGlow (explicit clear)', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    clearPostShimmerGlow('pty-1');
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('is cleared when new shimmer starts (new activity)', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    // New activity clears glow and starts fresh shimmer
    recordPtyStdoutActivity('pty-1', baseTime + 7700);
    recordPtyStdoutActivity('pty-1', baseTime + 7800);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('is not set when shimmer is suppressed at completion time', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Suppress before completion — should not set glow
    suppressPtyShimmer('pty-1');

    driveShimmerCompletion('pty-1', baseTime);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('handles max total shimmer duration (15s) completing with glow', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Past max total duration — guaranteed completion even without
    // intermediate calls to drive state transitions
    const afterMax = baseTime + 16000;
    expect(hasActiveShimmer('pty-1', afterMax)).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('does not overlap with active shimmer — glow waits until shimmer ends', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // While shimmer is still active, glow should not apply
    const duringShimmer = baseTime + 1000;
    if (hasActiveShimmer('pty-1', duringShimmer)) {
      expect(hasPostShimmerGlow('pty-1')).toBe(false);
    }
  });

  it('persists indefinitely until explicitly cleared — no timeout', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    // Glow persists
    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    // Even after a long time, glow is still present (no auto-expiry)
    expect(hasPostShimmerGlow('pty-1')).toBe(true);

    // Only cleared by explicit action (selection)
    clearPostShimmerGlow('pty-1');
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });
});
