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
  setShimmerFocusedPty,
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
    // Default: focus on a different PTY so pty-1 is considered
    // unfocused (glow should fire in basic tests).
    setShimmerFocusedPty('pty-other');
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

  it('unsuppressPtyShimmer does not restart shimmer from stale activity', () => {
    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
    expect(hasActiveShimmer('pty-1')).toBe(false);

    // suppress clears glow (simulates component cleanup)
    suppressPtyShimmer('pty-1');
    expect(hasPostShimmerGlow('pty-1')).toBe(false);

    // unsuppress should NOT restart shimmer from stale activity data
    unsuppressPtyShimmer('pty-1');
    expect(hasActiveShimmer('pty-1')).toBe(false);
    // No glow either (suppress cleared it and unsuppress didn't recreate)
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });
});

describe('post-shimmer glow — focus gating', () => {
  beforeEach(() => {
    clearPtyStdoutActivity('pty-1');
    clearPtyStdoutActivity('pty-2');
    unsuppressPtyShimmer('pty-1');
    unsuppressPtyShimmer('pty-2');
    clearPostShimmerGlow('pty-1');
    clearPostShimmerGlow('pty-2');
    // Focus on a different PTY so pty-1/pty-2 are unfocused by default
    setShimmerFocusedPty('pty-other');
  });

  it('does NOT glow when the PTY is focused at activity time', () => {
    setShimmerFocusedPty('pty-1');

    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasActiveShimmer('pty-1')).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('glows for a non-focused PTY at activity time', () => {
    setShimmerFocusedPty('pty-2');

    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasActiveShimmer('pty-1')).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('does NOT glow when user was focused at activity time but switches away before completion', () => {
    const baseTime = 10000;
    // User is watching pty-1 when activity fires
    setShimmerFocusedPty('pty-1');
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Midway through shimmer, user switches to pty-2
    setShimmerFocusedPty('pty-2');

    driveShimmerCompletion('pty-1', baseTime);

    // No glow: user was watching when the activity happened
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('glows when activity happened while unfocused even if user switches TO the PTY later', () => {
    const baseTime = 10000;
    // Activity happens while user is NOT watching
    setShimmerFocusedPty('pty-2');
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // User switches to pty-1 after activity was recorded
    setShimmerFocusedPty('pty-1');

    driveShimmerCompletion('pty-1', baseTime);

    // Glow fires: the activity happened while the user wasn't watching
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('captured focus at activity time — switching away AFTER recording does not produce glow', () => {
    const baseTime = 10000;
    // User is watching pty-1 when activity occurs
    setShimmerFocusedPty('pty-1');
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Activity was recorded while focused → sawUnfocusedActivity = false.
    // Now switch away — this should NOT retroactively cause glow.
    setShimmerFocusedPty('pty-2');

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('queued activity while unfocused does NOT upgrade sawUnfocusedActivity', () => {
    const baseTime = 10000;
    // Initial activity while focused — user was watching
    setShimmerFocusedPty('pty-1');
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Switch away — new activity queues while unfocused
    setShimmerFocusedPty('pty-2');
    recordPtyStdoutActivity('pty-1', baseTime + 3000);

    driveShimmerCompletion('pty-1', baseTime);

    // No glow: the shimmer started while focused, queued activity from
    // prompt echo etc. should not retroactively trigger glow.
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('no-glow for focused PTY via max duration cap', () => {
    setShimmerFocusedPty('pty-1');

    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // Past max total duration — guaranteed completion
    const afterMax = baseTime + 16000;
    expect(hasActiveShimmer('pty-1', afterMax)).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('glow via max duration if any activity was unfocused', () => {
    const baseTime = 10000;
    // Activity while unfocused
    setShimmerFocusedPty('pty-2');
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    const afterMax = baseTime + 16000;
    expect(hasActiveShimmer('pty-1', afterMax)).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('covers the ls -a scenario: focused PTY, fast command, switch away, no glow', () => {
    setShimmerFocusedPty('pty-1');

    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    // User switches to another PTY before shimmer animation finishes
    setShimmerFocusedPty('pty-2');

    // Shimmer completes — no glow because user was watching when ls ran
    driveShimmerCompletion('pty-1', baseTime);

    expect(hasActiveShimmer('pty-1')).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });

  it('npm install while away: unfocused PTY, glow fires', () => {
    setShimmerFocusedPty('pty-2');

    const baseTime = 10000;
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasActiveShimmer('pty-1')).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(true);
  });

  it('null focusedPtyId assumes focused — no false glow on startup', () => {
    // Simulates app startup before the SolidJS effect runs
    setShimmerFocusedPty(null); // Explicitly null — before effect runs
    const baseTime = 10000;
    // PTY output arrives — should NOT glow even though focusedPtyId is null
    recordPtyStdoutActivity('pty-1', baseTime);
    recordPtyStdoutActivity('pty-1', baseTime + 100);

    driveShimmerCompletion('pty-1', baseTime);

    expect(hasActiveShimmer('pty-1')).toBe(false);
    expect(hasPostShimmerGlow('pty-1')).toBe(false);
  });
});
