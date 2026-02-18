/**
 * Bridge module for gradual migration to Effect services.
 * Provides simple async functions backed by Effect services.
 *
 * Use these functions in existing code to migrate to Effect
 * without changing the entire callsite at once.
 */

export { copyToClipboard, readFromClipboard } from "./clipboard-bridge"

export {
  createPtySession,
  writeToPty,
  sendPtyFocusEvent,
  resizePty,
  getPtyCwd,
  getPtyForegroundProcess,
  getPtyLastCommand,
  destroyPty,
  destroyAllPtys,
  getTerminalState,
  onPtyExit,
  getScrollState,
  capturePty,
  setScrollOffset,
  scrollToBottom,
  subscribeUnifiedToPty,
  getEmulator,
  setPtyUpdateEnabled,
  applyHostColors,
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  getPtyTitle,
  type PtyLifecycleEvent,
  type PtyTitleChangeEvent,
} from "./pty-bridge"

export {
  listSessions,
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  renameSession,
  getActiveSessionId,
  setActiveSessionId,
  switchToSession,
  getSessionMetadata,
  updateAutoName,
  getSessionSummary,
  createSessionLegacy,
  listSessionsLegacy,
  getActiveSessionIdLegacy,
  renameSessionLegacy,
  deleteSessionLegacy,
  saveCurrentSession,
  loadSessionData,
} from "./session-bridge"

export {
  listTemplates,
  loadTemplate,
  saveTemplate,
  deleteTemplate,
  buildLayoutFromTemplate,
} from "./template-bridge"

export { listAllPtysWithMetadata, getPtyMetadata, type ListAllPtysOptions } from "./aggregate-bridge"

export { getHostBackgroundColor, getHostForegroundColor } from "./color-bridge"
export {
  registerPtyPane,
  getSessionPtyMapping,
  type SessionPtyMapping,
  onShimDetached,
  shutdownShim,
  waitForShimClient,
} from "./shim-bridge"

export {
  type KeyEvent,
  type KeyboardEvent,
  type KeyHandler,
  type OverlayType,
  registerKeyboardHandler,
  routeKeyboardEvent,
  routeKeyboardEventSync,
  getActiveOverlay,
  hasKeyboardHandler,
} from "./keyboard-router-bridge"

export {
  clearPtyTracking,
  markPtyCreated,
  isPtyCreated,
  setSessionCwdMap,
  getSessionCwd,
  clearSessionCwdMap,
  setSessionCommandMap,
  getSessionCommand,
  clearSessionCommandMap,
  setActiveSessionIdForShim,
  getActiveSessionIdForShim,
} from "./app-coordinator-bridge"
