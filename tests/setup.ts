import { mock, vi } from "bun:test";
import * as solidJsxRuntime from "solid-js/h/jsx-runtime";
import { effectBridgeMocks } from "./mocks/effect-bridge";
import { mockGhostty } from "./mocks/ghostty-ffi";

type ViCompat = typeof vi & {
  mocked?: <T>(value: T) => T;
  hoisted?: <T>(factory: () => T) => T;
  advanceTimersByTimeAsync?: (ms: number) => Promise<void>;
  runAllTimersAsync?: () => Promise<void>;
};

const viCompat = vi as ViCompat;

if (!viCompat.mocked) {
  viCompat.mocked = (value) => value;
}

if (!viCompat.hoisted) {
  viCompat.hoisted = (factory) => factory();
}

if (!viCompat.advanceTimersByTimeAsync) {
  viCompat.advanceTimersByTimeAsync = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  };
}

if (!viCompat.runAllTimersAsync) {
  viCompat.runAllTimersAsync = async () => {
    let guard = 25;
    let idleCycles = 0;
    while (guard > 0 && idleCycles < 5) {
      const pending = vi.getTimerCount();
      if (pending > 0) {
        vi.runOnlyPendingTimers();
        await Promise.resolve();
        idleCycles = 0;
      } else {
        await Promise.resolve();
        idleCycles += 1;
      }
      guard -= 1;
    }
  };
}

mock.module("@opentui/solid/jsx-runtime", () => solidJsxRuntime);
mock.module("@opentui/solid/jsx-dev-runtime", () => solidJsxRuntime);
mock.module("../src/effect/bridge", () => effectBridgeMocks);
mock.module("../src/terminal/ghostty-vt/ffi", () => ({ ghostty: mockGhostty }));

// Mock shim-bridge to prevent accidental shim client connections in tests
mock.module("../src/effect/bridge/shim-bridge", () => ({
  registerPtyPane: async () => {},
  getSessionPtyMapping: async () => undefined,
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  waitForShimClient: async () => {},
}));

// Mock shim/client/connection to prevent socket connection attempts in tests
// This specifically mocks waitForShim which tries to connect to the shim socket
// Note: handlePtyNotification is imported from the actual module to preserve test functionality
import { handlePtyNotification } from "../src/shim/client/frame-handler";

mock.module("../src/shim/client/connection", () => ({
  sendRequest: async () => ({ header: { type: 'response', ok: true, result: {} }, payloads: [] }),
  sendRequestDirect: async () => ({ header: { type: 'response', ok: true, result: {} }, payloads: [] }),
  ensureConnected: async () => {},
  waitForShim: async () => {},
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  // Preserve the actual handlePtyNotification for tests that use it
  handlePtyNotification,
}));
