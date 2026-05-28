/**
 * Tests for async subscription cleanup race condition fix.
 * Verifies that the `mounted` flag pattern correctly handles the race
 * where a component unmounts before async registration completes.
 */
import { describe, test, expect, vi } from 'bun:test';

/**
 * Simulates the async registration pattern used in components.
 * This is the pattern we're testing:
 *
 * ```ts
 * createEffect(() => {
 *   let unsubscribe: (() => void) | null = null;
 *   let mounted = true;
 *
 *   registerKeyboardHandler(handler).then((unsub) => {
 *     if (mounted) {
 *       unsubscribe = unsub;
 *     } else {
 *       unsub(); // Cleanup immediately if already unmounted
 *     }
 *   });
 *
 *   onCleanup(() => {
 *     mounted = false;
 *     if (unsubscribe) unsubscribe();
 *   });
 * });
 * ```
 */

interface AsyncRegistrationResult {
  cleanup: () => void;
  isRegistrationCalled: () => boolean;
  isCleanupCalled: () => boolean;
}

/**
 * Simulates the mounted flag pattern for async registration cleanup.
 */
function createAsyncRegistration(registerFn: () => Promise<() => void>): AsyncRegistrationResult {
  let unsubscribe: (() => void) | null = null;
  let mounted = true;
  let registrationCalled = false;
  let cleanupCalled = false;

  registerFn().then((unsub) => {
    registrationCalled = true;
    if (mounted) {
      unsubscribe = unsub;
    } else {
      // Component unmounted before registration completed - cleanup immediately
      unsub();
    }
  });

  return {
    cleanup: () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
        cleanupCalled = true;
      }
    },
    isRegistrationCalled: () => registrationCalled,
    isCleanupCalled: () => cleanupCalled,
  };
}

describe('Async Subscription Cleanup Pattern', () => {
  describe('when cleanup is called after registration completes', () => {
    test('should call the unsubscribe function', async () => {
      const unsubFn = vi.fn();

      // Registration completes immediately
      const registerFn = vi.fn(() => Promise.resolve(unsubFn));

      const registration = createAsyncRegistration(registerFn);

      // Wait for registration to complete
      await Promise.resolve();

      expect(registration.isRegistrationCalled()).toBe(true);

      // Now cleanup
      registration.cleanup();

      expect(unsubFn).toHaveBeenCalledTimes(1);
      expect(registration.isCleanupCalled()).toBe(true);
    });
  });

  describe('when cleanup is called before registration completes', () => {
    test('should call unsubscribe immediately when registration completes', async () => {
      const unsubFn = vi.fn();
      let resolveRegistration: ((unsub: () => void) => void) | null = null;

      // Registration is delayed
      const registerFn = vi.fn(
        () =>
          new Promise<() => void>((resolve) => {
            resolveRegistration = resolve;
          })
      );

      const registration = createAsyncRegistration(registerFn);

      // Cleanup is called BEFORE registration completes (the race condition)
      registration.cleanup();

      expect(registration.isRegistrationCalled()).toBe(false);
      expect(unsubFn).not.toHaveBeenCalled();

      // Now registration completes
      resolveRegistration!(unsubFn);
      await Promise.resolve();

      // The unsubscribe should have been called immediately
      // because mounted was already false
      expect(registration.isRegistrationCalled()).toBe(true);
      expect(unsubFn).toHaveBeenCalledTimes(1);
    });

    test('should not leak handlers when unmount races with registration', async () => {
      const handlers: Array<() => void> = [];
      const unregisterFn = vi.fn((handler: () => void) => {
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      });

      // Simulate a registry that tracks handlers
      const registerFn = vi.fn(() => {
        const handler = vi.fn();
        handlers.push(handler);
        return Promise.resolve(() => unregisterFn(handler));
      });

      // Create multiple registrations and immediately cleanup (race condition)
      const registrations = Array.from({ length: 10 }, () => createAsyncRegistration(registerFn));

      // Cleanup all immediately (before registrations complete)
      registrations.forEach((r) => r.cleanup());

      // Wait for all registrations to complete
      await Promise.resolve();
      await Promise.resolve(); // Extra tick for safety

      // All handlers should have been unregistered
      expect(handlers.length).toBe(0);
      expect(unregisterFn).toHaveBeenCalledTimes(10);
    });
  });

  describe('without the mounted flag pattern (demonstrating the bug)', () => {
    test('would leak handlers without the fix', async () => {
      const handlers: Array<() => void> = [];
      const unregisterFn = vi.fn((handler: () => void) => {
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      });

      // Buggy pattern WITHOUT mounted flag
      function createBuggyRegistration(registerFn: () => Promise<() => void>): {
        cleanup: () => void;
      } {
        let unsubscribe: (() => void) | null = null;

        registerFn().then((unsub) => {
          unsubscribe = unsub; // Always assigns, even if cleanup was called
        });

        return {
          cleanup: () => {
            if (unsubscribe) {
              unsubscribe();
            }
            // BUG: if registration hasn't completed yet, unsubscribe is null
            // and we never call the cleanup function
          },
        };
      }

      const registerFn = vi.fn(() => {
        const handler = vi.fn();
        handlers.push(handler);
        return Promise.resolve(() => unregisterFn(handler));
      });

      // Create registration and immediately cleanup (race condition)
      const registration = createBuggyRegistration(registerFn);
      registration.cleanup(); // Called before registration completes

      // Wait for registration to complete
      await Promise.resolve();

      // BUG: Handler is leaked because cleanup was called before registration completed
      expect(handlers.length).toBe(1); // Handler was never unregistered!
      expect(unregisterFn).not.toHaveBeenCalled();
    });
  });
});
