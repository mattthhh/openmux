/**
 * Tests for polling overlap prevention pattern.
 * Verifies that the `refreshInProgress` flag correctly prevents
 * overlapping async refresh calls from causing issues.
 */
import { describe, test, expect, vi } from 'bun:test';

/**
 * Simulates the refresh overlap prevention pattern used in AggregateViewContext.
 * This is the pattern we're testing:
 *
 * ```ts
 * let refreshInProgress = false;
 *
 * const refreshPtys = async () => {
 *   if (refreshInProgress) return;
 *   refreshInProgress = true;
 *
 *   try {
 *     // ... async work
 *   } finally {
 *     refreshInProgress = false;
 *   }
 * };
 * ```
 */

interface RefreshControllerResult {
  refresh: () => Promise<void>;
  getCallCount: () => number;
  getConcurrentCount: () => number;
  getMaxConcurrent: () => number;
}

/**
 * Creates a refresh controller with overlap prevention.
 */
function createRefreshController(asyncWork: () => Promise<void>): RefreshControllerResult {
  let refreshInProgress = false;
  let callCount = 0;
  let concurrentCount = 0;
  let maxConcurrent = 0;

  const refresh = async () => {
    // Skip if a refresh is already in progress
    if (refreshInProgress) return;
    refreshInProgress = true;
    callCount++;
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);

    try {
      await asyncWork();
    } finally {
      concurrentCount--;
      refreshInProgress = false;
    }
  };

  return {
    refresh,
    getCallCount: () => callCount,
    getConcurrentCount: () => concurrentCount,
    getMaxConcurrent: () => maxConcurrent,
  };
}

/**
 * Creates a buggy refresh controller WITHOUT overlap prevention.
 */
function createBuggyRefreshController(asyncWork: () => Promise<void>): RefreshControllerResult {
  let callCount = 0;
  let concurrentCount = 0;
  let maxConcurrent = 0;

  const refresh = async () => {
    // BUG: No overlap prevention
    callCount++;
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);

    try {
      await asyncWork();
    } finally {
      concurrentCount--;
    }
  };

  return {
    refresh,
    getCallCount: () => callCount,
    getConcurrentCount: () => concurrentCount,
    getMaxConcurrent: () => maxConcurrent,
  };
}

describe('Polling Overlap Prevention Pattern', () => {
  describe('with overlap prevention', () => {
    test('should prevent concurrent refresh calls', async () => {
      let workResolve: (() => void) | null = null;
      const asyncWork = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            workResolve = resolve;
          })
      );

      const controller = createRefreshController(asyncWork);

      // Start first refresh (will be pending)
      const refresh1 = controller.refresh();

      // Try to start more refreshes while first is pending
      controller.refresh();
      controller.refresh();
      controller.refresh();

      // Only one should have started
      expect(controller.getCallCount()).toBe(1);
      expect(controller.getMaxConcurrent()).toBe(1);
      expect(asyncWork).toHaveBeenCalledTimes(1);

      // Complete the first refresh
      workResolve!();
      await refresh1;

      // Now a new refresh can start
      const refresh2 = controller.refresh();
      expect(controller.getCallCount()).toBe(2);

      workResolve!();
      await refresh2;
    });

    test('should allow new refresh after previous completes', async () => {
      const asyncWork = vi.fn(() => Promise.resolve());

      const controller = createRefreshController(asyncWork);

      // Sequential refreshes should all work
      await controller.refresh();
      await controller.refresh();
      await controller.refresh();

      expect(controller.getCallCount()).toBe(3);
      expect(asyncWork).toHaveBeenCalledTimes(3);
    });

    test('should reset flag even if async work throws', async () => {
      let shouldThrow = true;
      const asyncWork = vi.fn(async () => {
        if (shouldThrow) {
          throw new Error('Async work failed');
        }
      });

      const controller = createRefreshController(asyncWork);

      // First refresh throws
      await controller.refresh().catch(() => {});

      expect(controller.getCallCount()).toBe(1);

      // Should be able to refresh again after error
      shouldThrow = false;
      await controller.refresh();

      expect(controller.getCallCount()).toBe(2);
      expect(asyncWork).toHaveBeenCalledTimes(2);
    });

    test('should handle rapid polling interval without overlap', async () => {
      let resolvers: Array<() => void> = [];
      const asyncWork = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          })
      );

      const controller = createRefreshController(asyncWork);

      // Simulate rapid polling (like setInterval every 50ms while work takes 200ms)
      for (let i = 0; i < 10; i++) {
        controller.refresh();
      }

      // Only one should be running
      expect(controller.getCallCount()).toBe(1);
      expect(controller.getMaxConcurrent()).toBe(1);

      // Complete the work
      resolvers[0]();
      await Promise.resolve();

      // Now another poll comes in
      controller.refresh();
      expect(controller.getCallCount()).toBe(2);
    });
  });

  describe('without overlap prevention (demonstrating the bug)', () => {
    test('would allow concurrent refreshes without the fix', async () => {
      let resolvers: Array<() => void> = [];
      const asyncWork = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          })
      );

      const controller = createBuggyRefreshController(asyncWork);

      // Start multiple refreshes (all will run concurrently!)
      controller.refresh();
      controller.refresh();
      controller.refresh();

      // BUG: All three started concurrently
      expect(controller.getCallCount()).toBe(3);
      expect(controller.getMaxConcurrent()).toBe(3);
      expect(asyncWork).toHaveBeenCalledTimes(3);
    });

    test('would cause state inconsistency with concurrent refreshes', async () => {
      // Simulate a stateful refresh that reads and writes
      let state = { value: 0 };
      const stateSnapshots: number[] = [];

      const asyncWork = vi.fn(async () => {
        // Read current state
        const current = state.value;
        stateSnapshots.push(current);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Write new state based on what we read
        state.value = current + 1;
      });

      const controller = createBuggyRefreshController(asyncWork);

      // Start 3 concurrent refreshes
      const p1 = controller.refresh();
      const p2 = controller.refresh();
      const p3 = controller.refresh();

      await Promise.all([p1, p2, p3]);

      // BUG: All three read the same initial value (0)
      // and all wrote value + 1 = 1
      // Instead of incrementing to 3, we only got to 1!
      expect(stateSnapshots).toEqual([0, 0, 0]); // All read same value
      expect(state.value).toBe(1); // Lost updates!
    });

    test('with fix: state updates correctly with sequential refreshes', async () => {
      let state = { value: 0 };
      const stateSnapshots: number[] = [];

      const asyncWork = vi.fn(async () => {
        const current = state.value;
        stateSnapshots.push(current);
        await new Promise((resolve) => setTimeout(resolve, 10));
        state.value = current + 1;
      });

      const controller = createRefreshController(asyncWork);

      // Try to start 3 concurrent refreshes
      const p1 = controller.refresh();
      controller.refresh(); // Skipped
      controller.refresh(); // Skipped

      await p1;

      // Now do two more sequential refreshes
      await controller.refresh();
      await controller.refresh();

      // Only 3 actual refreshes happened
      expect(controller.getCallCount()).toBe(3);
      // State correctly incremented
      expect(stateSnapshots).toEqual([0, 1, 2]);
      expect(state.value).toBe(3);
    });
  });

  describe('polling simulation', () => {
    test('should handle 2-second polling with slow refresh', async () => {
      vi.useFakeTimers();

      const refreshDuration = 500; // 500ms refresh
      const pollInterval = 2000; // 2s polling
      const asyncWork = vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, refreshDuration))
      );

      const controller = createRefreshController(asyncWork);

      // Start polling
      const intervalId = setInterval(() => {
        controller.refresh();
      }, pollInterval);

      // First poll at t=0
      controller.refresh();
      expect(controller.getCallCount()).toBe(1);

      // Advance to t=2000 (second poll, first still running)
      vi.advanceTimersByTime(refreshDuration - 100);
      await Promise.resolve();
      // First refresh still running

      // Try another poll (should be skipped)
      controller.refresh();
      expect(controller.getCallCount()).toBe(1); // Still 1

      // Complete first refresh
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(controller.getConcurrentCount()).toBe(0);

      // Now another poll can succeed
      controller.refresh();
      expect(controller.getCallCount()).toBe(2);

      clearInterval(intervalId);
      vi.useRealTimers();
    });
  });
});
