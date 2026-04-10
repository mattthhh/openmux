/**
 * Test setup - global mocks for safety and vi polyfills
 */
import { mock, vi } from 'bun:test';
import * as solidJsxRuntime from 'solid-js/h/jsx-runtime';
import { effectBridgeMocks } from './mocks/effect-bridge';
import { mockGhostty } from './mocks/ghostty-ffi';

// Polyfill vi methods for Bun compatibility
type ViCompat = typeof vi & {
  advanceTimersByTimeAsync?: (ms: number) => Promise<void>;
  runAllTimersAsync?: () => Promise<void>;
  mocked?: <T>(value: T) => T;
  hoisted?: <T>(factory: () => T) => T;
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

// Mock JSX runtime for SolidJS
mock.module('@opentui/solid/jsx-runtime', () => solidJsxRuntime);
mock.module('@opentui/solid/jsx-dev-runtime', () => solidJsxRuntime);

// Mock effect bridge for isolation
mock.module('../src/effect/bridge', () => effectBridgeMocks);

// Mock ghostty FFI to prevent native calls in tests
mock.module('../src/terminal/ghostty-vt/ffi', () => ({ ghostty: mockGhostty }));

// Mock shim-bridge to prevent accidental shim client connections
mock.module('../src/effect/bridge/shim-bridge', () => ({
  registerPtyPane: async () => {},
  getSessionPtyMapping: async () => undefined,
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  waitForShimClient: async () => {},
}));

// Mock shim/client/connection to prevent any real socket connections during tests
// This is critical - without this, tests could connect to the real shim socket and detach the user
mock.module('../src/shim/client/connection', () => ({
  sendRequest: async () => ({ header: { ok: true, result: {} }, payloads: [] }),
  sendRequestDirect: async () => ({ header: { ok: true, result: {} }, payloads: [] }),
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  waitForShim: async () => {},
  // handlePtyNotification is a pure function - we implement it properly for tests that need it
  handlePtyNotification: (params: any, deps: any) => {
    const { notification, subtitle, ptyId, hostFocused, focusedPtyId, allowFocusedPaneOsc } =
      params;
    const isUnfocusedPane = Boolean(ptyId && focusedPtyId && ptyId !== focusedPtyId);
    const shouldUseMacOs = hostFocused === true && (isUnfocusedPane || !allowFocusedPaneOsc);

    if (shouldUseMacOs) {
      const sent = deps.sendMacOsNotification({
        title: notification.title,
        subtitle,
        body: notification.body,
      });
      if (sent) {
        return;
      }
    }

    deps.sendDesktopNotification({ notification, subtitle });
  },
}));

// Note: We intentionally do NOT mock shim/client or shim/client/connection here.
// Bun's module mocking doesn't properly handle namespace imports (`import * as X`)
// when combined with test file-level mocks. Tests that need to mock these modules
// should do so in their own vi.mock() calls, and tests that need the real
// implementation (like connection-notification.test.ts) can import it directly.
