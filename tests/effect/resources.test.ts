/**
 * Tests for ResourceStack and resource management utilities.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  ResourceStack,
  isAbortError,
  once,
  isDisposable,
  isAsyncDisposable,
} from '../../src/effect/resources';

describe('ResourceStack', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('core functionality', () => {
    it('should defer cleanup functions and execute in LIFO order', async () => {
      const cleanupOrder: number[] = [];

      {
        await using resources = new ResourceStack();
        resources.defer(() => {
          cleanupOrder.push(1);
        });
        resources.defer(() => {
          cleanupOrder.push(2);
        });
        resources.defer(() => {
          cleanupOrder.push(3);
        });
      }

      expect(cleanupOrder).toEqual([3, 2, 1]);
    });

    it('should defer all cleanup functions at once', async () => {
      const cleanupOrder: number[] = [];

      {
        await using resources = new ResourceStack();
        resources.deferAll(
          () => {
            cleanupOrder.push(1);
          },
          () => {
            cleanupOrder.push(2);
          },
          () => {
            cleanupOrder.push(3);
          }
        );
      }

      expect(cleanupOrder).toEqual([3, 2, 1]);
    });

    it('should defer safe with error logging', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = new Error('Cleanup failed');

      {
        await using resources = new ResourceStack();
        resources.deferSafe(() => {
          throw error;
        });
      }

      expect(consoleWarn).toHaveBeenCalledWith('Resource cleanup failed:', error);
      consoleWarn.mockRestore();
    });

    it('should register and cleanup timers', async () => {
      vi.useFakeTimers();
      const callback = vi.fn();

      {
        await using resources = new ResourceStack();
        const timer = setTimeout(callback, 1000);
        resources.registerTimer(timer);
      }

      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should register and cleanup intervals', async () => {
      vi.useFakeTimers();
      const callback = vi.fn();

      {
        await using resources = new ResourceStack();
        const interval = setInterval(callback, 100);
        resources.registerInterval(interval);
      }

      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should register and abort AbortController', async () => {
      const controller = new AbortController();

      {
        await using resources = new ResourceStack();
        resources.registerAbortController(controller);
        expect(controller.signal.aborted).toBe(false);
      }

      expect(controller.signal.aborted).toBe(true);
    });

    it('should register event listeners', async () => {
      const emitter = { on: vi.fn(), off: vi.fn() };

      {
        await using resources = new ResourceStack();
        resources.registerEventListener(emitter, 'test', () => {});
      }

      expect(emitter.off).toHaveBeenCalledWith('test', expect.any(Function));
    });

    it('should register disposable resources', async () => {
      const disposeFn = vi.fn();
      const resource = { [Symbol.asyncDispose]: disposeFn };

      {
        await using resources = new ResourceStack();
        resources.registerDisposable(resource);
      }

      expect(disposeFn).toHaveBeenCalled();
    });

    it('should register subscriptions', async () => {
      const unsubscribe = vi.fn();

      {
        await using resources = new ResourceStack();
        resources.registerSubscription(unsubscribe);
      }

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('cleanup guarantees', () => {
    it('should cleanup even when function throws', async () => {
      const cleanupOrder: string[] = [];

      try {
        await using resources = new ResourceStack();
        resources.defer(() => {
          cleanupOrder.push('cleanup-1');
        });
        resources.defer(() => {
          cleanupOrder.push('cleanup-2');
        });
        throw new Error('Test error');
      } catch {
        // Expected
      }

      expect(cleanupOrder).toEqual(['cleanup-2', 'cleanup-1']);
    });

    it('should cleanup on early return', async () => {
      let cleaned = false;

      async function test() {
        await using resources = new ResourceStack();
        resources.defer(() => {
          cleaned = true;
        });
        if (true) return 'early';
        resources.defer(() => {});
        return 'late';
      }

      const result = await test();
      expect(result).toBe('early');
      expect(cleaned).toBe(true);
    });

    it('should handle nested ResourceStacks', async () => {
      const cleanupOrder: string[] = [];

      {
        await using outer = new ResourceStack();
        outer.defer(() => {
          cleanupOrder.push('outer');
        });

        {
          await using inner = new ResourceStack();
          inner.defer(() => {
            cleanupOrder.push('inner');
          });
        }
      }

      expect(cleanupOrder).toEqual(['inner', 'outer']);
    });

    it('should continue cleanup when one defer throws', async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();
      resources.defer(() => {
        cleanupOrder.push('first');
      });
      resources.defer(() => {
        throw new Error('Cleanup error');
      });
      resources.defer(() => {
        cleanupOrder.push('third');
      });

      await expect(resources[Symbol.asyncDispose]()).rejects.toThrow('Cleanup error');
      expect(cleanupOrder).toContain('first');
      expect(cleanupOrder).toContain('third');
    });

    it('should handle multiple deferSafe failures', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      {
        await using resources = new ResourceStack();
        resources.deferSafe(() => {
          throw new Error('Error 1');
        });
        resources.deferSafe(() => {
          throw new Error('Error 2');
        });
        resources.deferSafe(() => {
          /* success */
        });
      }

      expect(consoleWarn).toHaveBeenCalledTimes(2);
      consoleWarn.mockRestore();
    });
  });

  describe('pattern tests', () => {
    it('should clean up PTY resources', async () => {
      const unsubscribers = { unified: vi.fn(), exit: vi.fn() };
      const state = {
        ptySubscriptions: new Map([['pty-1', unsubscribers]]),
        ptyEmulators: new Map([['pty-1', {}]]),
      };

      {
        await using resources = new ResourceStack();
        resources.registerSubscription(unsubscribers.unified);
        resources.registerSubscription(unsubscribers.exit);
        resources.deferSafe(() => state.ptySubscriptions.delete('pty-1'));
        resources.deferSafe(() => state.ptyEmulators.delete('pty-1'));
      }

      expect(unsubscribers.unified).toHaveBeenCalled();
      expect(unsubscribers.exit).toHaveBeenCalled();
      expect(state.ptySubscriptions.has('pty-1')).toBe(false);
    });

    it('should clean up session picker on close', async () => {
      const dispatchCalls: string[] = [];
      const mockDispatch = (action: { type: string }) => {
        dispatchCalls.push(action.type);
      };

      {
        await using resources = new ResourceStack();
        resources.defer(() => mockDispatch({ type: 'CLOSE_SESSION_PICKER' }));
        mockDispatch({ type: 'SET_ACTIVE_SESSION' });
      }

      expect(dispatchCalls).toContain('CLOSE_SESSION_PICKER');
    });

    it('should clean up socket event listeners', async () => {
      const mockSocket = {
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      };

      {
        await using resources = new ResourceStack();
        resources.defer(() => mockSocket.removeAllListeners('error'));
        resources.defer(() => mockSocket.removeListener('connect'));
      }

      expect(mockSocket.removeAllListeners).toHaveBeenCalledWith('error');
    });
  });
});

describe('utility functions', () => {
  it('should identify abort errors', () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    expect(isAbortError(abortError)).toBe(true);
    expect(isAbortError(new Error('Other'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it('should create once functions', () => {
    let count = 0;
    const cleanup = once(() => {
      count++;
    });

    cleanup();
    cleanup();
    cleanup();

    expect(count).toBe(1);
  });

  it('should identify disposable resources', () => {
    const disposable = { [Symbol.dispose]: () => {} };
    expect(isDisposable(disposable)).toBe(true);
    expect(isDisposable({})).toBe(false);
    expect(isDisposable(null)).toBe(false);
  });

  it('should identify async disposable resources', () => {
    const asyncDisposable = { [Symbol.asyncDispose]: async () => {} };
    expect(isAsyncDisposable(asyncDisposable)).toBe(true);
    expect(isAsyncDisposable({})).toBe(false);
  });
});
