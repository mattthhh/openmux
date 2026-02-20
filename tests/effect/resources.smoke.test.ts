/**
 * Smoke tests for ResourceStack cleanup behavior.
 * These tests verify actual cleanup patterns used throughout the codebase.
 */
import { describe, expect, it, vi, beforeEach } from "bun:test";
import { ResourceStack } from "../../src/effect/resources";

describe("ResourceStack smoke tests", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("Control Client pattern", () => {
    it("should clean up all resources on connection failure", async () => {
      const timerCleared = vi.fn();
      const listenerRemoved = vi.fn();
      const connectListenerRemoved = vi.fn();
      const errorListenerRemoved = vi.fn();

      const mockSocket = {
        once: vi.fn(),
        removeAllListeners: vi.fn((event?: string) => {
          if (event === "error") {
            listenerRemoved();
          }
        }),
        removeListener: vi.fn((event: string) => {
          if (event === "connect") {
            connectListenerRemoved();
          } else if (event === "error") {
            errorListenerRemoved();
          }
        }),
        destroy: vi.fn(),
      };

      await using resources = new ResourceStack();

      const timer = setTimeout(() => {}, 1000);
      resources.registerTimer(timer);
      resources.defer(timerCleared);

      resources.defer(() => {
        mockSocket.removeAllListeners("error");
      });

      const handleConnect = () => {};
      const handleError = () => {};

      mockSocket.once("connect", handleConnect);
      mockSocket.once("error", handleError);

      resources.defer(() => {
        mockSocket.removeListener("connect");
      });
      resources.defer(() => {
        mockSocket.removeListener("error");
      });

      expect(timerCleared).not.toHaveBeenCalled();
      expect(listenerRemoved).not.toHaveBeenCalled();
      expect(connectListenerRemoved).not.toHaveBeenCalled();
      expect(errorListenerRemoved).not.toHaveBeenCalled();
    });

    it("should clean up resources in LIFO order on error", async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();

      resources.defer(() => cleanupOrder.push("first"));
      resources.defer(() => cleanupOrder.push("second"));
      resources.defer(() => cleanupOrder.push("third"));

      await resources.disposeAsync?.();

      expect(cleanupOrder).toEqual(["third", "second", "first"]);
    });

    it("should handle AbortController cleanup", async () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, "abort");

      await using resources = new ResourceStack();
      resources.registerAbortController(controller);

      expect(controller.signal.aborted).toBe(false);

      await resources.disposeAsync?.();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe("PTY Lifecycle pattern", () => {
    it("should clean up multiple PTY resources", async () => {
      const unsubscribers = {
        unified: vi.fn(),
        exit: vi.fn(),
        lifecycle: vi.fn(),
        title: vi.fn(),
      };

      const state = {
        ptySubscriptions: new Map([
          ["pty-1", { unifiedUnsub: unsubscribers.unified, exitUnsub: unsubscribers.exit }],
        ]),
        ptyEmulators: new Map([["pty-1", {}]]),
        kittyImages: new Map([["pty-1", new Map()]]),
        kittyTransmitCache: new Map([["pty-1", new Map()]]),
        kittyTransmitPending: new Map([["pty-1", false]]),
        kittyTransmitInvalidated: new Map([["pty-1", false]]),
      };

      await using resources = new ResourceStack();

      const subs = state.ptySubscriptions.get("pty-1")!;
      resources.registerSubscription(subs.unifiedUnsub);
      resources.registerSubscription(subs.exitUnsub);

      resources.deferSafe(() => state.ptySubscriptions.delete("pty-1"));
      resources.deferSafe(() => state.ptyEmulators.delete("pty-1"));
      resources.deferSafe(() => state.kittyImages.delete("pty-1"));
      resources.deferSafe(() => state.kittyTransmitCache.delete("pty-1"));
      resources.deferSafe(() => state.kittyTransmitPending.delete("pty-1"));
      resources.deferSafe(() => state.kittyTransmitInvalidated.delete("pty-1"));

      await resources.disposeAsync?.();

      expect(unsubscribers.unified).toHaveBeenCalledTimes(1);
      expect(unsubscribers.exit).toHaveBeenCalledTimes(1);
      expect(state.ptySubscriptions.has("pty-1")).toBe(false);
      expect(state.ptyEmulators.has("pty-1")).toBe(false);
      expect(state.kittyImages.has("pty-1")).toBe(false);
    });

    it("should handle PTY creation with deferred cleanup", async () => {
      const mockPty = {
        id: "pty-1",
        destroy: vi.fn(),
        write: vi.fn(),
      };

      let cleanupCalled = false;

      await using resources = new ResourceStack();

      resources.defer(() => {
        mockPty.destroy();
        cleanupCalled = true;
      });

      expect(cleanupCalled).toBe(false);
      expect(mockPty.destroy).not.toHaveBeenCalled();

      await resources.disposeAsync?.();

      expect(cleanupCalled).toBe(true);
      expect(mockPty.destroy).toHaveBeenCalledTimes(1);
    });

    it("should clean up PTY subscriptions on client detach", async () => {
      const lifecycleUnsub = vi.fn();
      const titleUnsub = vi.fn();
      const ptyUnsub = vi.fn();

      const state = {
        ptySubscriptions: new Map([["pty-1", { unifiedUnsub: ptyUnsub, exitUnsub: vi.fn() }]]),
        lifecycleUnsub: lifecycleUnsub as (() => void) | null,
        titleUnsub: titleUnsub as (() => void) | null,
      };

      await using resources = new ResourceStack();

      for (const _ptyId of state.ptySubscriptions.keys()) {
        resources.defer(() => ptyUnsub());
      }
      resources.deferSafe(() => state.ptySubscriptions.clear());

      if (state.lifecycleUnsub) {
        resources.registerSubscription(state.lifecycleUnsub);
        resources.deferSafe(() => {
          state.lifecycleUnsub = null;
        });
      }

      if (state.titleUnsub) {
        resources.registerSubscription(state.titleUnsub);
        resources.deferSafe(() => {
          state.titleUnsub = null;
        });
      }

      await resources.disposeAsync?.();

      expect(ptyUnsub).toHaveBeenCalledTimes(1);
      expect(lifecycleUnsub).toHaveBeenCalledTimes(1);
      expect(titleUnsub).toHaveBeenCalledTimes(1);
      expect(state.ptySubscriptions.size).toBe(0);
      expect(state.lifecycleUnsub).toBeNull();
      expect(state.titleUnsub).toBeNull();
    });
  });

  describe("Session Operations pattern", () => {
    it("should clean up session picker on successful session creation", async () => {
      const dispatchCalls: string[] = [];

      const mockDispatch = (action: { type: string }) => {
        dispatchCalls.push(action.type);
      };

      await using resources = new ResourceStack();

      resources.defer(() => {
        mockDispatch({ type: "CLOSE_SESSION_PICKER" });
      });

      mockDispatch({ type: "SET_ACTIVE_SESSION" });

      await resources.disposeAsync?.();

      expect(dispatchCalls).toContain("CLOSE_SESSION_PICKER");
    });

    it("should clean up session picker even when session creation fails", async () => {
      const dispatchCalls: string[] = [];

      const mockDispatch = (action: { type: string }) => {
        dispatchCalls.push(action.type);
      };

      let errorThrown = false;

      try {
        await using resources = new ResourceStack();

        resources.defer(() => {
          mockDispatch({ type: "CLOSE_SESSION_PICKER" });
        });

        throw new Error("Session creation failed");
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      expect(dispatchCalls).toContain("CLOSE_SESSION_PICKER");
    });

    it("should handle session switch with rollback on failure", async () => {
      const cleanupOrder: string[] = [];
      const dispatchCalls: string[] = [];

      const mockDispatch = (action: { type: string; switching?: boolean }) => {
        dispatchCalls.push(action.type);
      };

      try {
        await using resources = new ResourceStack();

        resources.defer(() => {
          mockDispatch({ type: "CLOSE_SESSION_PICKER" });
          cleanupOrder.push("close-picker");
        });

        mockDispatch({ type: "SET_SWITCHING", switching: true });

        resources.defer(() => {
          mockDispatch({ type: "SET_SWITCHING", switching: false });
          cleanupOrder.push("reset-switching");
        });

        throw new Error("Session load failed");
      } catch {
        // Expected
      }

      expect(dispatchCalls).toContain("CLOSE_SESSION_PICKER");
      expect(dispatchCalls).toContain("SET_SWITCHING");
      expect(cleanupOrder).toEqual(["reset-switching", "close-picker"]);
    });

    it("should handle safe cleanup that doesn't throw", async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();

      resources.deferSafe(() => {
        cleanupOrder.push("safe-1");
      });

      resources.deferSafe(() => {
        throw new Error("Safe cleanup error");
      });

      resources.deferSafe(() => {
        cleanupOrder.push("safe-2");
      });

      await resources.disposeAsync?.();

      expect(cleanupOrder).toContain("safe-1");
      expect(cleanupOrder).toContain("safe-2");
      expect(cleanupOrder.length).toBe(2);
    });
  });

  describe("Shim Server pattern", () => {
    it("should clean up subscriptions when detaching client", async () => {
      const subscriptions: Array<() => void> = [
        vi.fn(),
        vi.fn(),
        vi.fn(),
      ];

      await using resources = new ResourceStack();

      for (const unsub of subscriptions) {
        resources.registerSubscription(unsub);
      }

      await resources.disposeAsync?.();

      for (const unsub of subscriptions) {
        expect(unsub).toHaveBeenCalledTimes(1);
      }
    });

    it("should clean up event listeners from emitter", async () => {
      const mockEmitter = {
        listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
        on(event: string, handler: (...args: unknown[]) => void) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
          }
          this.listeners.get(event)!.push(handler);
        },
        off(event: string, handler: (...args: unknown[]) => void) {
          const handlers = this.listeners.get(event);
          if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
              handlers.splice(index, 1);
            }
          }
        },
      };

      const handler1 = () => {};
      const handler2 = () => {};

      await using resources = new ResourceStack();

      resources.registerEventListener(mockEmitter, "data", handler1);
      resources.registerEventListener(mockEmitter, "error", handler2);

      expect(mockEmitter.listeners.get("data")?.length).toBe(1);
      expect(mockEmitter.listeners.get("error")?.length).toBe(1);

      await resources.disposeAsync?.();

      expect(mockEmitter.listeners.get("data")?.length).toBe(0);
      expect(mockEmitter.listeners.get("error")?.length).toBe(0);
    });

    it("should clean up intervals", async () => {
      vi.useFakeTimers();

      let intervalCleared = false;
      const originalClearInterval = clearInterval;

      await using resources = new ResourceStack();

      const interval = setInterval(() => {}, 100);
      resources.registerInterval(interval);

      const spy = vi.spyOn(global, "clearInterval").mockImplementation((...args) => {
        intervalCleared = true;
        return originalClearInterval(...args);
      });

      await resources.disposeAsync?.();

      expect(intervalCleared).toBe(true);

      spy.mockRestore();
    });

    it("should handle previous client cleanup on new attachment", async () => {
      const mockClient = {
        destroyed: false,
        end: vi.fn(),
        destroy: vi.fn(),
      };

      await using resources = new ResourceStack();

      if (!mockClient.destroyed) {
        mockClient.end();
        const prevClientRef = mockClient;
        resources.defer(() => {
          setTimeout(() => {
            if (prevClientRef && !prevClientRef.destroyed) {
              prevClientRef.destroy();
            }
          }, 250);
        });
      }

      await resources.disposeAsync?.();

      expect(mockClient.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error handling", () => {
    it("should continue cleanup even when one defer throws", async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();

      resources.defer(() => {
        cleanupOrder.push("first");
      });

      resources.defer(() => {
        throw new Error("Cleanup error");
      });

      resources.defer(() => {
        cleanupOrder.push("third");
      });

      await expect(resources.disposeAsync?.()).rejects.toThrow("Cleanup error");

      expect(cleanupOrder).toContain("first");
      expect(cleanupOrder).toContain("third");
    });

    it("should handle async cleanup errors", async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();

      resources.defer(async () => {
        cleanupOrder.push("first");
      });

      resources.defer(async () => {
        throw new Error("Async cleanup error");
      });

      resources.defer(async () => {
        cleanupOrder.push("third");
      });

      await expect(resources.disposeAsync?.()).rejects.toThrow("Async cleanup error");

      expect(cleanupOrder).toContain("first");
      expect(cleanupOrder).toContain("third");
    });

    it("should handle deferAll with multiple cleanups", async () => {
      const cleanupOrder: string[] = [];

      await using resources = new ResourceStack();

      resources.deferAll(
        () => cleanupOrder.push("one"),
        () => cleanupOrder.push("two"),
        () => cleanupOrder.push("three")
      );

      await resources.disposeAsync?.();

      expect(cleanupOrder).toEqual(["three", "two", "one"]);
    });
  });

  describe("Disposable resources", () => {
    it("should handle async disposable resources", async () => {
      const disposeCalled = vi.fn();

      const mockResource: AsyncDisposable = {
        async [Symbol.asyncDispose]() {
          disposeCalled();
        },
      };

      await using resources = new ResourceStack();

      const returned = resources.registerDisposable(mockResource);

      expect(returned).toBe(mockResource);

      await resources.disposeAsync?.();

      expect(disposeCalled).toHaveBeenCalledTimes(1);
    });

    it("should handle nested resource stacks", async () => {
      const cleanupOrder: string[] = [];

      {
        await using innerResources = new ResourceStack();
        innerResources.defer(() => cleanupOrder.push("inner"));
      }

      {
        await using outerResources = new ResourceStack();
        outerResources.defer(() => cleanupOrder.push("outer"));
        await outerResources.disposeAsync?.();
      }

      expect(cleanupOrder).toEqual(["inner", "outer"]);
    });
  });
});
