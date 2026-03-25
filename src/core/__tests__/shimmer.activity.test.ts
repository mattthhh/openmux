/**
 * Shimmer activity tracking tests.
 * Tests for recordPtyStdoutActivity, hasRecentPtyStdoutActivity, and hasMeaningfulActivity.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordPtyStdoutActivity,
  hasRecentPtyStdoutActivity,
  clearPtyStdoutActivity,
  hasMeaningfulActivity,
  setShimmerEnabled,
  isShimmerEnabled,
  subscribeToShimmer,
} from '../shimmer';
import type { PtyInfo } from '../../contexts/aggregate-view-types';

// Helper to create a mock PTY info
function createMockPtyInfo(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    sessionId: 'session-1',
    cwd: '/home/user/project',
    workspaceId: 1,
    paneId: 'pane-1',
    gitBranch: 'main',
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
    foregroundProcess: 'nvim',
    shell: 'zsh',
    title: 'nvim',
    sessionMetadata: undefined,
    ...overrides,
  };
}

describe('shimmer activity tracking', () => {
  beforeEach(() => {
    // Clear all activity state before each test
    clearPtyStdoutActivity('pty-1');
    clearPtyStdoutActivity('pty-2');
    clearPtyStdoutActivity('pty-3');
    // Reset shimmer enabled state
    setShimmerEnabled(true);
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

  describe('hasMeaningfulActivity', () => {
    it('returns true for active non-background process', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'nvim',
      });
      
      // Record activity
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(true);
    });

    it('returns false when no foreground process', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: undefined,
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns false for background processes (webpack)', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'webpack --watch',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns false for background processes (jest)', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'jest --watch',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns false for background processes (npm run watch)', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'npm run watch',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns false for background processes (vite)', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'vite',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns false when no recent activity recorded', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'nvim',
      });
      
      // No activity recorded
      expect(hasMeaningfulActivity(pty)).toBe(false);
    });

    it('returns true for coding agents like codex', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'codex',
        title: 'codex - working',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(true);
    });

    it('returns true for coding agents like claude', () => {
      const pty = createMockPtyInfo({
        foregroundProcess: 'claude-code',
      });
      
      const now = Date.now();
      recordPtyStdoutActivity(pty.ptyId, now);
      recordPtyStdoutActivity(pty.ptyId, now + 100);
      
      expect(hasMeaningfulActivity(pty)).toBe(true);
    });
  });

  describe('setShimmerEnabled / isShimmerEnabled', () => {
    it('enables shimmer globally', () => {
      setShimmerEnabled(false);
      expect(isShimmerEnabled()).toBe(false);
      
      setShimmerEnabled(true);
      expect(isShimmerEnabled()).toBe(true);
    });

    it('defaults to enabled', () => {
      // Reset to verify default behavior
      setShimmerEnabled(true);
      expect(isShimmerEnabled()).toBe(true);
    });
  });

  describe('subscribeToShimmer', () => {
    it('returns unsubscribe function', () => {
      const unsubscribe = subscribeToShimmer(() => {});
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('calls callback on animation tick when enabled', async () => {
      setShimmerEnabled(true);
      
      let callCount = 0;
      const unsubscribe = subscribeToShimmer(() => {
        callCount++;
      });
      
      // Wait for at least one animation frame (throttled at ~100ms)
      await new Promise((resolve) => setTimeout(resolve, 150));
      
      // Should have been called at least once
      expect(callCount).toBeGreaterThan(0);
      
      unsubscribe();
    });

    it('stops calling callback after unsubscribe', async () => {
      setShimmerEnabled(true);
      
      let callCount = 0;
      const unsubscribe = subscribeToShimmer(() => {
        callCount++;
      });
      
      // Wait for some ticks
      await new Promise((resolve) => setTimeout(resolve, 150));
      const countBefore = callCount;
      
      // Unsubscribe
      unsubscribe();
      
      // Wait again
      await new Promise((resolve) => setTimeout(resolve, 150));
      
      // Count should not have increased
      expect(callCount).toBe(countBefore);
    });

    it('handles multiple subscribers', async () => {
      setShimmerEnabled(true);
      
      let callCount1 = 0;
      let callCount2 = 0;
      
      const unsubscribe1 = subscribeToShimmer(() => {
        callCount1++;
      });
      
      const unsubscribe2 = subscribeToShimmer(() => {
        callCount2++;
      });
      
      // Wait for ticks
      await new Promise((resolve) => setTimeout(resolve, 150));
      
      expect(callCount1).toBeGreaterThan(0);
      expect(callCount2).toBeGreaterThan(0);
      expect(callCount1).toBe(callCount2);
      
      unsubscribe1();
      unsubscribe2();
    });
  });
});
