/**
 * Active session operations for SessionManager
 * Handles getting/setting active session and switching between sessions
 * Migrated from Effect to errore - uses promises and direct dependency passing
 */

import type { SessionStorage } from "../SessionStorage"
import {
  SessionNotFoundError,
  SessionStorageError,
  SessionCorruptedError,
  type SessionError,
} from "../../errors"
import type { SerializedSession, SessionMetadata } from "../../models"
import type { SessionId } from "../../types"

export interface ActiveSessionDeps {
  storage: SessionStorage
  getActiveSessionId: () => SessionId | null
  setActiveSessionId: (id: SessionId | null) => void
}

/**
 * Get the active session ID
 */
export function getActiveSessionId(
  deps: ActiveSessionDeps
): SessionId | null {
  return deps.getActiveSessionId()
}

/**
 * Set the active session ID
 */
export async function setActiveSessionId(
  deps: ActiveSessionDeps,
  id: SessionId | null
): Promise<SessionStorageError | void> {
  const { storage, setActiveSessionId: setLocal } = deps

  setLocal(id)

  // Update index
  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  return await storage.saveIndex({
    sessions: currentIndex.sessions,
    activeSessionId: id,
  })
}

/**
 * Switch to a session (updates lastSwitchedAt)
 */
export async function switchToSession(
  deps: ActiveSessionDeps,
  id: SessionId
): Promise<SessionError | void> {
  const { storage, setActiveSessionId } = deps

  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  const session = currentIndex.sessions.find((s) => s.id === id)

  if (!session) {
    return new SessionNotFoundError({ sessionId: id })
  }

  // Update lastSwitchedAt
  const now = Date.now()
  const updatedMetadata: SessionMetadata = {
    ...session,
    lastSwitchedAt: now,
  }

  const updatedSessions = currentIndex.sessions.map((s) =>
    s.id === id ? updatedMetadata : s
  )

  const saveIndexResult = await storage.saveIndex({
    sessions: updatedSessions,
    activeSessionId: id,
  })
  if (saveIndexResult instanceof SessionStorageError) {
    return saveIndexResult
  }

  // Update session file too
  const sessionData = await storage.loadSession(id)
  if (sessionData instanceof SessionNotFoundError || sessionData instanceof SessionCorruptedError) {
    return sessionData
  }
  if (sessionData instanceof SessionStorageError) {
    return sessionData
  }

  const saveSessionResult = await storage.saveSession({
    ...sessionData,
    metadata: updatedMetadata,
  })
  if (saveSessionResult instanceof SessionStorageError) {
    return saveSessionResult
  }

  setActiveSessionId(id)
}
