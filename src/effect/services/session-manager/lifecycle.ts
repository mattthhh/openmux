/**
 * Session lifecycle operations for SessionManager
 * Handles create, load, save, and delete operations
 * Migrated from Effect to errore - uses promises and direct dependency passing
 */

import type { SessionStorage } from "../SessionStorage"
import type {
  SerializedSession,
  SessionMetadata,
} from "../../models"
import type { SessionId } from "../../types"
import { makeWorkspaceId, makeSessionId } from "../../types"
import { SessionStorageError, SessionNotFoundError, type SessionError } from "../../errors"
import { getAutoName } from "./serialization"

export interface LifecycleDeps {
  storage: SessionStorage
  getActiveSessionId: () => SessionId | null
  setActiveSessionId: (id: SessionId | null) => void
}

/**
 * Create a new session
 */
export async function createSession(
  deps: LifecycleDeps,
  name?: string
): Promise<SessionStorageError | SessionMetadata> {
  const { storage } = deps

  const id = makeSessionId()
  const now = Date.now()

  const metadata: SessionMetadata = {
    id,
    name: name ?? getAutoName(process.cwd()),
    createdAt: now,
    lastSwitchedAt: now,
    autoNamed: !name,
  }

  // Create empty session
  const session: SerializedSession = {
    metadata,
    workspaces: [],
    activeWorkspaceId: makeWorkspaceId(1),
  }

  // Save session file
  const saveResult = await storage.saveSession(session)
  if (saveResult instanceof SessionStorageError) {
    return saveResult
  }

  // Update index
  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  // Check if session already exists in index (some storage implementations add it automatically)
  const existingIndex = currentIndex.sessions.findIndex((s) => s.id === id)
  const updatedSessions =
    existingIndex >= 0
      ? currentIndex.sessions.map((s, i) => (i === existingIndex ? metadata : s))
      : [...currentIndex.sessions, metadata]

  const saveIndexResult = await storage.saveIndex({
    sessions: updatedSessions,
    activeSessionId: id,
  })
  if (saveIndexResult instanceof SessionStorageError) {
    return saveIndexResult
  }

  // Set as active
  deps.setActiveSessionId(id)

  return metadata
}

/**
 * Load a session by ID
 */
export async function loadSession(
  storage: SessionStorage,
  id: SessionId
): Promise<SessionError | SerializedSession> {
  return await storage.loadSession(id)
}

/**
 * Save a session
 */
export async function saveSession(
  storage: SessionStorage,
  session: SerializedSession
): Promise<SessionStorageError | void> {
  const saveResult = await storage.saveSession(session)
  if (saveResult instanceof SessionStorageError) {
    return saveResult
  }

  // Update index
  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  const existingIdx = currentIndex.sessions.findIndex(
    (s) => s.id === session.metadata.id
  )

  const sessions =
    existingIdx >= 0
      ? currentIndex.sessions.map((s, i) =>
          i === existingIdx ? session.metadata : s
        )
      : [...currentIndex.sessions, session.metadata]

  return await storage.saveIndex({
    sessions,
    activeSessionId: currentIndex.activeSessionId,
  })
}

/**
 * Delete a session
 */
export async function deleteSession(
  deps: LifecycleDeps,
  id: SessionId
): Promise<SessionError | void> {
  const { storage, getActiveSessionId, setActiveSessionId } = deps

  // Check if session exists
  const exists = await storage.sessionExists(id)
  if (!exists) {
    return new SessionNotFoundError({ sessionId: id })
  }

  // Delete session file
  const deleteResult = await storage.deleteSession(id)
  if (deleteResult instanceof SessionStorageError) {
    return deleteResult
  }

  // Update index
  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  const filteredSessions = currentIndex.sessions.filter(
    (s) => s.id !== id
  )

  // If deleting active session, switch to another
  const newActiveId =
    currentIndex.activeSessionId === id
      ? filteredSessions[0]?.id ?? null
      : currentIndex.activeSessionId

  const saveIndexResult = await storage.saveIndex({
    sessions: filteredSessions,
    activeSessionId: newActiveId,
  })
  if (saveIndexResult instanceof SessionStorageError) {
    return saveIndexResult
  }

  // Update ref if needed
  const currentActive = getActiveSessionId()
  if (currentActive === id) {
    setActiveSessionId(newActiveId)
  }
}

/**
 * List all sessions sorted by lastSwitchedAt (most recent first)
 */
export async function listSessions(
  storage: SessionStorage
): Promise<SessionStorageError | SessionMetadata[]> {
  const sessions = await storage.listSessions()
  if (sessions instanceof SessionStorageError) {
    return sessions
  }

  // Sort by lastSwitchedAt (most recent first)
  return [...sessions].sort(
    (a, b) => b.lastSwitchedAt - a.lastSwitchedAt
  )
}
