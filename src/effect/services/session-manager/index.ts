/**
 * Session manager module exports
 * Migrated from Effect to errore
 */

export type { SessionError, WorkspaceState } from "./types"

export {
  getAutoName,
  shouldUpdateAutoName,
  collectCwdMap,
  serializeWorkspace,
  serializeSession,
} from "./serialization"

export {
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  listSessions,
  type LifecycleDeps,
} from "./lifecycle"

export {
  renameSession,
  getSessionMetadata,
  updateAutoName,
  getSessionSummary,
  type MetadataDeps,
} from "./metadata"

export {
  getActiveSessionId,
  setActiveSessionId,
  switchToSession,
  type ActiveSessionDeps,
} from "./active-session"

export {
  serializeWorkspaces,
  quickSave,
  type QuickSaveDeps,
} from "./quick-save"
