/**
 * Session metadata operations for SessionManager
 * Handles rename, auto-name updates, and metadata queries
 * Migrated from Effect to errore - uses promises and direct dependency passing
 */

import type { SessionStorage } from "../SessionStorage"
import type {
  SerializedSession,
  SessionMetadata,
  SerializedLayoutNode,
} from "../../models"
import type { SessionId } from "../../types"
import { SessionStorageError, SessionNotFoundError, SessionCorruptedError, type SessionError } from "../../errors"
import { getAutoName } from "./serialization"

export interface MetadataDeps {
  storage: SessionStorage
}

function countPanes(node: SerializedLayoutNode | null): number {
  if (!node) return 0
  if ((node as { type?: string }).type === "split") {
    const split = node as SerializedLayoutNode & { first: SerializedLayoutNode; second: SerializedLayoutNode }
    return countPanes(split.first) + countPanes(split.second)
  }
  return 1
}

/**
 * Rename a session
 */
export async function renameSession(
  deps: MetadataDeps,
  id: SessionId,
  newName: string
): Promise<SessionError | void> {
  const { storage } = deps

  // Load session
  const session = await storage.loadSession(id)
  if (session instanceof SessionNotFoundError || session instanceof SessionStorageError || session instanceof SessionCorruptedError) {
    return session
  }

  const updatedMetadata: SessionMetadata = {
    ...session.metadata,
    name: newName,
    autoNamed: false,
  }

  const updated: SerializedSession = {
    ...session,
    metadata: updatedMetadata,
  }

  const saveResult = await storage.saveSession(updated)
  if (saveResult instanceof SessionStorageError) {
    return saveResult
  }

  // Update index
  const currentIndex = await storage.loadIndex()
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex
  }

  const updatedSessions = currentIndex.sessions.map((s) =>
    s.id === id ? updatedMetadata : s
  )

  return await storage.saveIndex({
    sessions: updatedSessions,
    activeSessionId: currentIndex.activeSessionId,
    aggregateSessionOrder: currentIndex.aggregateSessionOrder,
  })
}

/**
 * Get session metadata by ID
 */
export async function getSessionMetadata(
  storage: SessionStorage,
  id: SessionId
): Promise<SessionStorageError | SessionMetadata | null> {
  const index = await storage.loadIndex()
  if (index instanceof SessionStorageError) {
    return index
  }

  return index.sessions.find((s) => s.id === id) ?? null
}

/**
 * Update auto-name for a session based on cwd
 */
export async function updateAutoName(
  deps: MetadataDeps,
  id: SessionId,
  cwd: string
): Promise<SessionError | void> {
  const { storage } = deps

  const index = await storage.loadIndex()
  if (index instanceof SessionStorageError) {
    return index
  }

  const session = index.sessions.find((s) => s.id === id)

  if (session && session.autoNamed) {
    const newName = getAutoName(cwd)
    if (newName !== session.name) {
      const updated: SessionMetadata = { ...session, name: newName }
      const updatedSessions = index.sessions.map((s) =>
        s.id === id ? updated : s
      )
      return await storage.saveIndex({
        sessions: updatedSessions,
        activeSessionId: index.activeSessionId,
        aggregateSessionOrder: index.aggregateSessionOrder,
      })
    }
  }
}

/**
 * Get session summary (workspace/pane counts)
 */
export async function getAggregateSessionOrder(
  storage: SessionStorage
): Promise<SessionStorageError | string[]> {
  const index = await storage.loadIndex()
  if (index instanceof SessionStorageError) {
    return index
  }
  return [...(index.aggregateSessionOrder ?? [])].map((id) => String(id))
}

export async function setAggregateSessionOrder(
  storage: SessionStorage,
  order: string[]
): Promise<SessionStorageError | void> {
  const index = await storage.loadIndex()
  if (index instanceof SessionStorageError) {
    return index
  }

  const existingIds = new Set(index.sessions.map((session) => String(session.id)))
  const nextOrder = order.filter((id, index) => order.indexOf(id) === index && existingIds.has(id))
  const missingIds = index.sessions
    .map((session) => String(session.id))
    .filter((id) => !nextOrder.includes(id))

  return await storage.saveIndex({
    sessions: index.sessions,
    activeSessionId: index.activeSessionId,
    aggregateSessionOrder: [...nextOrder, ...missingIds].map((id) => id as SessionId),
  })
}

export async function getSessionSummary(
  storage: SessionStorage,
  id: SessionId
): Promise<SessionError | { workspaceCount: number; paneCount: number } | null> {
  const exists = await storage.sessionExists(id)
  if (!exists) {
    return null
  }

  const session = await storage.loadSession(id)
  if (session instanceof SessionStorageError || session instanceof SessionCorruptedError) {
    return session as SessionStorageError
  }
  if (session instanceof SessionStorageError || session instanceof Error) {
    return session as SessionStorageError
  }

  let paneCount = 0
  let workspaceCount = 0

  for (const ws of session.workspaces) {
    if (ws.mainPane || ws.stackPanes.length > 0) {
      workspaceCount++
      paneCount += countPanes(ws.mainPane)
      for (const pane of ws.stackPanes) {
        paneCount += countPanes(pane)
      }
    }
  }

  return { workspaceCount, paneCount }
}
