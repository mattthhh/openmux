/**
 * Shimmer activity tracking tests.
 * Tests for recordPtyStdoutActivity, hasRecentPtyStdoutActivity.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordPtyStdoutActivity,
  hasRecentPtyStdoutActivity,
  clearPtyStdoutActivity,
  clonePtyStdoutActivity,
  hasActiveShimmer,
  suppressPtyShimmer,
  unsuppressPtyShimmer,
  setShimmerFocusedPty,
} from '../shimmer';

describe('shimmer activity tracking', () => {
  beforeEach(() => {
    // Clear all activity state before each test
    clearPtyStdoutActivity('pty-1');
    clearPtyStdoutActivity('pty-2');
    clearPtyStdoutActivity('pty-3');
    clearPtyStdoutActivity('saved:session-1:pane-1');
    unsuppressPtyShimmer('pty-1');
    unsuppressPtyShimmer('pty-2');
    unsuppressPtyShimmer('pty-3');
    unsuppressPtyShimmer('saved:session-1:pane-1');
    setShimmerFocusedPty('pty-other');
  });

  describe('recordPtyStdoutActivity', () => {
    it('records activity for a PTY', () => {
      recordPtyStdoutActivity('pty-1', 1000);
      expect(hasRecentPtyStdoutActivity('pty-1', 1000)).toBe(false); // Only 1 event

      recordPtyStdoutActivity('pty-1', 1100);
      expect(hasRecentPtyStdoutActivity('pty-1', 1100)).toBe(true); // 2 events
    });

    it('accumulates multiple activity events', () => {
      const now = Date.now();
      recordPtyStdoutActivity('pty-1', now);
      recordPtyStdoutActivity('pty-1', now + 100);
      recordPtyStdoutActivity('pty-1', now + 200);

      expect(hasRecentPtyStdoutActivity('pty-1', now + 200)).toBe(true);
    });

    it('prunes stale entries outside the 2500ms window', () => {
      const baseTime = 10000;

      // Add 2 events within window
      recordPtyStdoutActivity('pty-1', baseTime);
      recordPtyStdoutActivity('pty-1', baseTime + 1000);

      // Check at the edge of the window (both still valid)
      expect(hasRecentPtyStdoutActivity('pty-1', baseTime + 2500)).toBe(true);

      // Check after window expired (both pruned, only 0 left)
      expect(hasRecentPtyStdoutActivity('pty-1', baseTime + 2501)).toBe(false);
    });

    it('handles multiple PTYs independently', () => {
      const now = Date.now();

      recordPtyStdoutActivity('pty-1', now);
      recordPtyStdoutActivity('pty-1', now + 100);

      recordPtyStdoutActivity('pty-2', now);
      recordPtyStdoutActivity('pty-2', now + 100);

      expect(hasRecentPtyStdoutActivity('pty-1', now + 100)).toBe(true);
      expect(hasRecentPtyStdoutActivity('pty-2', now + 100)).toBe(true);
    });

    it('retains recent activity while shimmer is suppressed but does not restart shimmer on unsuppress', () => {
      const now = Date.now();

      suppressPtyShimmer('pty-1');
      recordPtyStdoutActivity('pty-1', now);
      recordPtyStdoutActivity('pty-1', now + 100);

      expect(hasRecentPtyStdoutActivity('pty-1', now + 100)).toBe(true);
      expect(hasActiveShimmer('pty-1', now + 100)).toBe(false);

      // unsuppress no longer restarts shimmer from stale activity.
      // New activity through recordPtyStdoutActivity will start fresh shimmer.
      unsuppressPtyShimmer('pty-1');
      expect(hasActiveShimmer('pty-1')).toBe(false);
    });

    it('clones recent activity to a saved aggregate row id', () => {
      const now = 2000;
      const savedPtyId = 'saved:session-1:pane-1';

      recordPtyStdoutActivity('pty-1', now);
      recordPtyStdoutActivity('pty-1', now + 100);
      clonePtyStdoutActivity('pty-1', savedPtyId, now + 100);

      expect(hasRecentPtyStdoutActivity(savedPtyId, now + 100)).toBe(true);
      expect(hasActiveShimmer(savedPtyId, now + 100)).toBe(true);
    });
  });

  describe('hasRecentPtyStdoutActivity', () => {
    it('requires minimum 2 events for activity', () => {
      const now = Date.now();

      // Single event - not enough
      recordPtyStdoutActivity('pty-1', now);
      expect(hasRecentPtyStdoutActivity('pty-1', now)).toBe(false);

      // Second event - now active
      recordPtyStdoutActivity('pty-1', now + 100);
      expect(hasRecentPtyStdoutActivity('pty-1', now + 100)).toBe(true);
    });

    it('returns false for unknown PTY', () => {
      expect(hasRecentPtyStdoutActivity('unknown-pty', Date.now())).toBe(false);
    });

    it('handles mixed old and new events', () => {
      const baseTime = 10000;

      // Old events (outside window)
      recordPtyStdoutActivity('pty-1', baseTime);
      recordPtyStdoutActivity('pty-1', baseTime + 100);

      // New events (inside window)
      const newTime = baseTime + 3000;
      recordPtyStdoutActivity('pty-1', newTime);
      recordPtyStdoutActivity('pty-1', newTime + 100);

      // Should only count new events
      expect(hasRecentPtyStdoutActivity('pty-1', newTime + 200)).toBe(true);
    });
  });

  describe('clearPtyStdoutActivity', () => {
    it('clears all activity for a PTY', () => {
      const now = Date.now();

      recordPtyStdoutActivity('pty-1', now);
      recordPtyStdoutActivity('pty-1', now + 100);
      expect(hasRecentPtyStdoutActivity('pty-1', now + 100)).toBe(true);

      clearPtyStdoutActivity('pty-1');
      expect(hasRecentPtyStdoutActivity('pty-1', now + 100)).toBe(false);
    });

    it('is safe to call on non-existent PTY', () => {
      expect(() => clearPtyStdoutActivity('non-existent')).not.toThrow();
    });
  });
});
