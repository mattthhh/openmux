import { vi } from "bun:test";

export const effectBridgeMocks = {
  createSessionLegacy: vi.fn(),
  listSessionsLegacy: vi.fn(),
  renameSessionLegacy: vi.fn(),
  deleteSessionLegacy: vi.fn(),
  saveCurrentSession: vi.fn(),
  loadSessionData: vi.fn(),
  switchToSession: vi.fn(),
  createPtySession: vi.fn(),
  destroyPty: vi.fn(),
  destroyAllPtys: vi.fn(),
  getActiveSessionIdForShim: vi.fn(),
  registerPtyPane: vi.fn(),
  applyHostColors: vi.fn(),
  getSessionCwd: vi.fn(),
  getSessionCommand: vi.fn(),
  isPtyCreated: vi.fn(),
  markPtyCreated: vi.fn(),
  copyToClipboard: vi.fn(),
  readFromClipboard: vi.fn(),
  // Aggregate view functions
  listAllPtysWithMetadata: vi.fn(),
  getPtyMetadata: vi.fn(),
  subscribeToPtyLifecycle: vi.fn(),
  subscribeToAllTitleChanges: vi.fn(),
};
