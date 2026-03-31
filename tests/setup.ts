/**
 * Test setup - global mocks for safety
 */
import { mock } from 'bun:test';
import * as solidJsxRuntime from 'solid-js/h/jsx-runtime';
import { effectBridgeMocks } from './mocks/effect-bridge';
import { mockGhostty } from './mocks/ghostty-ffi';

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

// Mock shim client connection to prevent actual socket connections
import { handlePtyNotification } from '../src/shim/client/frame-handler';

mock.module('../src/shim/client/connection', () => ({
  sendRequest: async () => ({ header: { type: 'response', ok: true, result: {} }, payloads: [] }),
  sendRequestDirect: async () => ({
    header: { type: 'response', ok: true, result: {} },
    payloads: [],
  }),
  ensureConnected: async () => {},
  waitForShim: async () => {},
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  handlePtyNotification,
}));
