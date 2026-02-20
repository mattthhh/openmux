/**
 * Session manager service for orchestrating session operations.
 * Migrated from Effect to errore - uses interfaces + factory functions.
 * Compatible with legacy core/types.ts interfaces.
 */
import type { SessionStorage } from "./SessionStorage"
import type { PtyService } from "./Pty"
import {
  SessionStorageError,
  SessionNotFoundError,
  type SessionError,
} from "../errors"
import type {
  SerializedSession,
  SessionMetadata,
} from "../models"
import type { SessionId } from "../types"
import type { WorkspaceState } from "./session-manager/types"

import {
  createSession as lifecycleCreateSession,
  loadSession as lifecycleLoadSession,
  saveSession as lifecycleSaveSession,
  deleteSession as lifecycleDeleteSession,
  listSessions as lifecycleListSessions,
} from "./session-manager/lifecycle"

import {
  renameSession as metadataRenameSession,
  getSessionMetadata as metadataGetSessionMetadata,
  updateAutoName as metadataUpdateAutoName,
  getSessionSummary as metadataGetSessionSummary,
} from "./session-manager/metadata"

import {
  setActiveSessionId as activeSetActiveSessionId,
  switchToSession as activeSwitchToSession,
} from "./session-manager/active-session"

import {
  serializeWorkspaces as quickSaveSerializeWorkspaces,
  quickSave as quickSaveQuickSave,
} from "./session-manager/quick-save"

import { makeSessionId, makeWorkspaceId } from "../types"

export interface SessionManager {
  createSession(name?: string): Promise<SessionStorageError | SessionMetadata>
  loadSession(id: SessionId): Promise<SessionError | SerializedSession>
  saveSession(session: SerializedSession): Promise<SessionStorageError | void>
  deleteSession(id: SessionId): Promise<SessionError | void>
  renameSession(id: SessionId, newName: string): Promise<SessionError | void>
  listSessions(): Promise<SessionStorageError | SessionMetadata[]>
  getActiveSessionId(): SessionId | null
  setActiveSessionId(id: SessionId | null): Promise<SessionStorageError | void>
  switchToSession(id: SessionId): Promise<SessionError | void>
  getSessionMetadata(id: SessionId): Promise<SessionStorageError | SessionMetadata | null>
  updateAutoName(id: SessionId, cwd: string): Promise<SessionError | void>
  getSessionSummary(id: SessionId): Promise<SessionError | { workspaceCount: number; paneCount: number } | null>
  serializeWorkspaces(
    metadata: SessionMetadata,
    workspaces: ReadonlyMap<number, WorkspaceState>,
    activeWorkspaceId: number,
    getCwd: (ptyId: string) => Promise<string>
  ): Promise<SerializedSession>
  quickSave(
    metadata: SessionMetadata,
    workspaces: ReadonlyMap<number, WorkspaceState>,
    activeWorkspaceId: number,
    getCwd: (ptyId: string) => Promise<string>
  ): Promise<SessionStorageError | void>
}

/**
 * Create a production SessionManager instance
 */
export async function createSessionManager(
  storage: SessionStorage,
  _pty: PtyService
): Promise<SessionStorageError | SessionManager> {
  // Track active session
  let activeSessionId: SessionId | null = null

  const getActiveSessionId = (): SessionId | null => activeSessionId
  const setLocalActiveSessionId = (id: SessionId | null): void => {
    activeSessionId = id
  }

  // Initialize active session from index
  const index = await storage.loadIndex()
  if (index instanceof SessionStorageError) {
    return index
  }

  if (index.activeSessionId) {
    activeSessionId = index.activeSessionId
  }

  const lifecycleDeps = {
    storage,
    getActiveSessionId,
    setActiveSessionId: setLocalActiveSessionId,
  }

  const metadataDeps = {
    storage,
  }

  const activeSessionDeps = {
    storage,
    getActiveSessionId,
    setActiveSessionId: setLocalActiveSessionId,
  }

  const quickSaveDeps = {
    saveSession: async (session: SerializedSession) => {
      return await lifecycleSaveSession(storage, session)
    },
  }

  return {
    createSession: (name?: string) =>
      lifecycleCreateSession(lifecycleDeps, name),
    loadSession: (id: SessionId) => lifecycleLoadSession(storage, id),
    saveSession: (session: SerializedSession) =>
      lifecycleSaveSession(storage, session),
    deleteSession: (id: SessionId) =>
      lifecycleDeleteSession(lifecycleDeps, id),
    renameSession: (id: SessionId, newName: string) =>
      metadataRenameSession(metadataDeps, id, newName),
    listSessions: () => lifecycleListSessions(storage),
    getActiveSessionId,
    setActiveSessionId: (id: SessionId | null) =>
      activeSetActiveSessionId(activeSessionDeps, id),
    switchToSession: (id: SessionId) =>
      activeSwitchToSession(activeSessionDeps, id),
    getSessionMetadata: (id: SessionId) =>
      metadataGetSessionMetadata(storage, id),
    updateAutoName: (id: SessionId, cwd: string) =>
      metadataUpdateAutoName(metadataDeps, id, cwd),
    getSessionSummary: (id: SessionId) =>
      metadataGetSessionSummary(storage, id),
    serializeWorkspaces: (
      metadata: SessionMetadata,
      workspaces: ReadonlyMap<number, WorkspaceState>,
      activeWorkspaceId: number,
      getCwd: (ptyId: string) => Promise<string>
    ) => quickSaveSerializeWorkspaces(metadata, workspaces, activeWorkspaceId, getCwd),
    quickSave: (
      metadata: SessionMetadata,
      workspaces: ReadonlyMap<number, WorkspaceState>,
      activeWorkspaceId: number,
      getCwd: (ptyId: string) => Promise<string>
    ) => quickSaveQuickSave(quickSaveDeps, metadata, workspaces, activeWorkspaceId, getCwd),
  }
}

/**
 * Create test SessionManager - in-memory session storage for testing
 */
export function createTestSessionManager(): SessionManager {
  const sessions = new Map<SessionId, SerializedSession>()
  let activeId: SessionId | null = null

  const getActiveSessionId = (): SessionId | null => activeId

  return {
    createSession: async (name?: string) => {
      const id = makeSessionId()
      const now = Date.now()

      const metadata: SessionMetadata = {
        id,
        name: name ?? "test-session",
        createdAt: now,
        lastSwitchedAt: now,
        autoNamed: !name,
      }

      const session: SerializedSession = {
        metadata,
        workspaces: [],
        activeWorkspaceId: makeWorkspaceId(1),
      }

      sessions.set(id, session)
      activeId = id

      return metadata
    },

    loadSession: async (id: SessionId) => {
      const session = sessions.get(id)
      if (!session) {
        return new SessionNotFoundError({ sessionId: id })
      }
      return session
    },

    saveSession: async (session: SerializedSession) => {
      sessions.set(session.metadata.id, session)
    },

    deleteSession: async (id: SessionId) => {
      if (!sessions.has(id)) {
        return new SessionNotFoundError({ sessionId: id })
      }
      sessions.delete(id)
      if (activeId === id) {
        activeId = null
      }
    },

    renameSession: async (id: SessionId, newName: string) => {
      const session = sessions.get(id)
      if (!session) {
        return new SessionNotFoundError({ sessionId: id })
      }

      const updated: SerializedSession = {
        ...session,
        metadata: {
          ...session.metadata,
          name: newName,
          autoNamed: false,
        },
      }

      sessions.set(id, updated)
    },

    listSessions: async () => {
      return Array.from(sessions.values())
        .map((s) => s.metadata)
        .sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt)
    },

    getActiveSessionId,

    setActiveSessionId: async (id: SessionId | null) => {
      activeId = id
    },

    switchToSession: async (id: SessionId) => {
      if (!sessions.has(id)) {
        return new SessionNotFoundError({ sessionId: id })
      }
      activeId = id
    },

    getSessionMetadata: async (id: SessionId) => {
      return sessions.get(id)?.metadata ?? null
    },

    updateAutoName: async (id: SessionId, cwd: string) => {
      const session = sessions.get(id)
      if (!session) {
        return new SessionNotFoundError({ sessionId: id })
      }

      if (session.metadata.autoNamed) {
        const parts = cwd.split("/").filter(Boolean)
        const newName = parts[parts.length - 1] ?? "untitled"

        if (newName !== session.metadata.name) {
          const updated: SerializedSession = {
            ...session,
            metadata: {
              ...session.metadata,
              name: newName,
            },
          }
          sessions.set(id, updated)
        }
      }
    },

    getSessionSummary: async (id: SessionId) => {
      const session = sessions.get(id)
      if (!session) return null
      return { workspaceCount: session.workspaces.length, paneCount: 0 }
    },

    serializeWorkspaces: async (
      metadata: SessionMetadata,
      _workspaces: ReadonlyMap<number, WorkspaceState>,
      _activeWorkspaceId: number,
      _getCwd: (ptyId: string) => Promise<string>
    ) => {
      return {
        metadata,
        workspaces: [],
        activeWorkspaceId: makeWorkspaceId(1),
      }
    },

    quickSave: async () => {
      // No-op in test mode
    },
  }
}
