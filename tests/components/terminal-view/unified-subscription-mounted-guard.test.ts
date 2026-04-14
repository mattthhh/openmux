/**
 * Tests for the mounted guard in setupUnifiedSubscription.
 *
 * Root cause: When the user rapidly switches PTYs in the aggregate view,
 * the setupUnifiedSubscription's init() function has two sequential await
 * points (getEmulator, subscribeUnifiedToPty). If the component is cleaned
 * up between those awaits, the cleanup runs with `unsubscribe` still null,
 * so it cannot unsubscribe. When the second await resolves, the function
 * continues and calls attachVisibleEmulator, re-enabling updates for the
 * old PTY after cleanup has already torn it down.
 *
 * The fix: Check `mounted` after each await and call `unsubscribe()`
 * immediately if the component was cleaned up during the await.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'bun:test';

import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
import type { TerminalViewState } from '../../../src/components/terminal-view/view-state';
import type { UnifiedTerminalUpdate } from '../../../src/core/types';

/**
 * Deferred promise helper for precise async timing control.
 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Simplified harness that mirrors the init/cleanup logic from
 * setupUnifiedSubscription without the SolidJS createEffect wrapper.
 * This lets us control the timing of async operations precisely.
 */
function createSubscriptionHarness(deps: {
  getEmulator: (ptyId: string) => Promise<ITerminalEmulator | null>;
  subscribeUnified: (
    ptyId: string,
    callback: (update: UnifiedTerminalUpdate) => void
  ) => Promise<() => void>;
  attachVisibleEmulator: (ptyId: string, emulator: ITerminalEmulator) => void;
  registerVisiblePty: (ptyId: string) => void;
  unregisterVisiblePty: (ptyId: string, emulator: ITerminalEmulator | null) => void;
  clearVisiblePty: (ptyId: string) => void;
  isPtyActive: (ptyId: string) => boolean;
  viewState: TerminalViewState;
}) {
  let mounted = true;
  let unsubscribe: (() => void) | null = null;
  let currentPtyId: string | null = null;

  /**
   * Mirrors the init() function from setupUnifiedSubscription WITH the fix.
   * The key difference: mounted guard after subscribeUnifiedToPty await.
   */
  const initWithFix = async (ptyId: string) => {
    currentPtyId = ptyId;

    deps.registerVisiblePty(ptyId);

    const em = await deps.getEmulator(ptyId);
    if (!mounted) {
      return;
    }

    deps.viewState.emulator = em;

    const unsubResult = await deps.subscribeUnified(ptyId, () => {});
    // --- FIX: mounted guard after await ---
    if (!mounted) {
      unsubResult();
      return;
    }

    unsubscribe = unsubResult;

    // Now safe to enable updates
    if (em) {
      deps.attachVisibleEmulator(ptyId, em);
    }
  };

  /**
   * Mirrors the init() function WITHOUT the fix — continues after unmount.
   */
  const initWithoutFix = async (ptyId: string) => {
    currentPtyId = ptyId;

    deps.registerVisiblePty(ptyId);

    const em = await deps.getEmulator(ptyId);
    if (!mounted) return;

    deps.viewState.emulator = em;

    const unsubResult = await deps.subscribeUnified(ptyId, () => {});
    // BUG: No mounted guard here — continues even after unmount
    unsubscribe = unsubResult;

    // Re-enables updates for old PTY after cleanup!
    if (em) {
      deps.attachVisibleEmulator(ptyId, em);
    }
  };

  /**
   * Mirrors the onCleanup from setupUnifiedSubscription.
   */
  const cleanup = () => {
    mounted = false;
    if (unsubscribe) {
      unsubscribe();
    }
    if (currentPtyId) {
      if (deps.isPtyActive(currentPtyId)) {
        deps.unregisterVisiblePty(currentPtyId, deps.viewState.emulator);
      } else {
        deps.clearVisiblePty(currentPtyId);
      }
    }
    deps.viewState.terminalState = null;
    deps.viewState.emulator = null;
  };

  return {
    initWithFix,
    initWithoutFix,
    cleanup,
    isMounted: () => mounted,
    getUnsubscribe: () => unsubscribe,
  };
}

function createViewState(): TerminalViewState {
  return {
    terminalState: null,
    scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
    emulator: null,
    lastScrollbackLength: null,
    pendingPrefetch: null,
    prefetchInProgress: false,
    executePrefetchFn: null,
    lastStableViewportOffset: 0,
    lastStableScrollbackLength: 0,
    lastStableRowCache: null,
    lastObservedViewportOffset: 0,
    lastObservedScrollbackLength: 0,
  };
}

/**
 * Flush the microtask queue by yielding multiple times.
 */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('setupUnifiedSubscription mounted guard', () => {
  let viewState: TerminalViewState;

  beforeEach(() => {
    viewState = createViewState();
  });

  describe('normal flow (no race)', () => {
    test('completes subscription setup when component stays mounted', async () => {
      const mockEmulator = { isDisposed: false } as unknown as ITerminalEmulator;
      const mockUnsub = vi.fn();

      const harness = createSubscriptionHarness({
        getEmulator: vi.fn().mockResolvedValue(mockEmulator),
        subscribeUnified: vi.fn().mockResolvedValue(mockUnsub),
        attachVisibleEmulator: vi.fn(),
        registerVisiblePty: vi.fn(),
        unregisterVisiblePty: vi.fn(),
        clearVisiblePty: vi.fn(),
        isPtyActive: () => true,
        viewState,
      });

      await harness.initWithFix('pty-1');
      await flushMicrotasks();

      expect(harness.getUnsubscribe()).toBe(mockUnsub);
      expect(viewState.emulator).toBe(mockEmulator);
      expect(harness.isMounted()).toBe(true);
    });
  });

  describe('unmount during subscribeUnifiedToPty await (the critical race)', () => {
    test('with fix: unsubscribes immediately if unmounted during subscribeUnified await', async () => {
      const mockEmulator = { isDisposed: false } as unknown as ITerminalEmulator;
      const mockUnsub = vi.fn();

      // Use deferred promises for precise timing control
      const emulatorDeferred = createDeferred<ITerminalEmulator | null>();
      const subscribeDeferred = createDeferred<() => void>();

      const attachVisible = vi.fn();

      const harness = createSubscriptionHarness({
        getEmulator: vi.fn().mockReturnValue(emulatorDeferred.promise),
        subscribeUnified: vi.fn().mockReturnValue(subscribeDeferred.promise),
        attachVisibleEmulator: attachVisible,
        registerVisiblePty: vi.fn(),
        unregisterVisiblePty: vi.fn(),
        clearVisiblePty: vi.fn(),
        isPtyActive: () => true,
        viewState,
      });

      // Start init — it will await getEmulator
      const initPromise = harness.initWithFix('pty-1');

      // Resolve getEmulator so init progresses to the subscribeUnified await
      emulatorDeferred.resolve(mockEmulator);
      await flushMicrotasks();

      // Now init is awaiting subscribeUnified
      expect(viewState.emulator).toBe(mockEmulator);

      // Unmount while subscribeUnified is pending
      harness.cleanup();

      // Now resolve subscribeUnified — the mounted guard should call unsubResult()
      subscribeDeferred.resolve(mockUnsub);

      await initPromise;
      await flushMicrotasks();

      // WITH FIX: the mounted guard calls unsubResult() immediately
      expect(mockUnsub).toHaveBeenCalled();
      // attachVisibleEmulator should NOT be called (we exited before that line)
      expect(attachVisible).not.toHaveBeenCalled();
    });

    test('without fix: leaks subscription and re-enables updates after unmount', async () => {
      const mockEmulator = { isDisposed: false } as unknown as ITerminalEmulator;
      const mockUnsub = vi.fn();

      const emulatorDeferred = createDeferred<ITerminalEmulator | null>();
      const subscribeDeferred = createDeferred<() => void>();

      const attachVisible = vi.fn();

      const harness = createSubscriptionHarness({
        getEmulator: vi.fn().mockReturnValue(emulatorDeferred.promise),
        subscribeUnified: vi.fn().mockReturnValue(subscribeDeferred.promise),
        attachVisibleEmulator: attachVisible,
        registerVisiblePty: vi.fn(),
        unregisterVisiblePty: vi.fn(),
        clearVisiblePty: vi.fn(),
        isPtyActive: () => true,
        viewState,
      });

      // Start init — progresses to subscribeUnified await
      const initPromise = harness.initWithoutFix('pty-1');
      emulatorDeferred.resolve(mockEmulator);
      await flushMicrotasks();

      // Unmount while subscribeUnified is pending
      harness.cleanup();

      // Now resolve subscribeUnified — WITHOUT fix, continues past the mount check
      subscribeDeferred.resolve(mockUnsub);

      await initPromise;
      await flushMicrotasks();

      // WITHOUT FIX: attachVisibleEmulator IS called, re-enabling updates
      // for the old PTY after cleanup has already run
      expect(attachVisible).toHaveBeenCalledWith('pty-1', mockEmulator);

      // WITHOUT FIX: unsubscribe is set after cleanup ran (but cleanup couldn't call it)
      // So the subscription function is stored but was never invoked during cleanup
      expect(harness.getUnsubscribe()).toBe(mockUnsub);
    });
  });

  describe('rapid PTY switching in aggregate view', () => {
    test('prevents stale subscription from re-enabling updates when switching from A to B quickly', async () => {
      const emulatorA = { isDisposed: false, id: 'A' } as unknown as ITerminalEmulator;

      const emulatorDeferred = createDeferred<ITerminalEmulator | null>();
      const subscribeDeferred = createDeferred<() => void>();

      const unsubA = vi.fn();
      const attachVisible = vi.fn();

      const harness = createSubscriptionHarness({
        getEmulator: vi.fn().mockReturnValue(emulatorDeferred.promise),
        subscribeUnified: vi.fn().mockReturnValue(subscribeDeferred.promise),
        attachVisibleEmulator: attachVisible,
        registerVisiblePty: vi.fn(),
        unregisterVisiblePty: vi.fn(),
        clearVisiblePty: vi.fn(),
        isPtyActive: () => true,
        viewState,
      });

      // Start init for PTY-A
      const initPromise = harness.initWithFix('pty-A');
      emulatorDeferred.resolve(emulatorA);
      await flushMicrotasks();

      // Before subscribeUnified resolves, user switches to PTY-B
      // This triggers cleanup for PTY-A
      harness.cleanup();

      // Now subscribeUnified for PTY-A resolves
      subscribeDeferred.resolve(unsubA);

      await initPromise;
      await flushMicrotasks();

      // WITH FIX: unsubA is called immediately (no leak)
      expect(unsubA).toHaveBeenCalled();

      // attachVisible was NOT called for PTY-A after cleanup
      expect(attachVisible).not.toHaveBeenCalledWith('pty-A', emulatorA);
    });

    test('allows normal subscription for the next PTY after previous was cancelled', async () => {
      const emulator = { isDisposed: false } as unknown as ITerminalEmulator;
      const unsub = vi.fn();
      const attachVisible = vi.fn();

      const freshViewState = createViewState();

      const harness = createSubscriptionHarness({
        getEmulator: vi.fn().mockResolvedValue(emulator),
        subscribeUnified: vi.fn().mockResolvedValue(unsub),
        attachVisibleEmulator: attachVisible,
        registerVisiblePty: vi.fn(),
        unregisterVisiblePty: vi.fn(),
        clearVisiblePty: vi.fn(),
        isPtyActive: () => true,
        viewState: freshViewState,
      });

      // Normal init for the next PTY
      await harness.initWithFix('pty-next');
      await flushMicrotasks();

      expect(harness.getUnsubscribe()).toBe(unsub);
      expect(attachVisible).toHaveBeenCalledWith('pty-next', emulator);
      expect(freshViewState.emulator).toBe(emulator);
    });
  });
});
