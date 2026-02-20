/**
 * Session storage service for persisting sessions to disk.
 * Migrated from Effect to errore - uses plain promises and Zod schemas.
 */
import type { FileSystem } from "./FileSystem"
import type { AppConfig } from "../Config"
import {
  SessionNotFoundError,
  SessionCorruptedError,
  SessionStorageError,
  FileSystemError,
} from "../errors"
import {
  SerializedSession,
  SerializedSessionSchema,
  SessionIndex,
  SessionIndexSchema,
  SessionMetadata,
} from "../models"
import type { SessionId } from "../types"
import { createEmptySessionIndex } from "../models"

export interface SessionStorage {
  /** Load a session by ID */
  loadSession(
    id: SessionId
  ): Promise<SessionStorageError | SessionNotFoundError | SessionCorruptedError | SerializedSession>

  /** Save a session */
  saveSession(session: SerializedSession): Promise<SessionStorageError | void>

  /** Delete a session */
  deleteSession(id: SessionId): Promise<SessionStorageError | void>

  /** List all session metadata */
  listSessions(): Promise<SessionStorageError | SessionMetadata[]>

  /** Load the session index */
  loadIndex(): Promise<SessionStorageError | SessionIndex>

  /** Save the session index */
  saveIndex(index: SessionIndex): Promise<SessionStorageError | void>

  /** Check if a session exists */
  sessionExists(id: SessionId): Promise<boolean>
}

/**
 * Create a production SessionStorage instance.
 * Takes FileSystem and AppConfig as direct dependencies.
 */
export async function createSessionStorage(
  fs: FileSystem,
  config: AppConfig
): Promise<SessionStorageError | SessionStorage> {
  const storagePath = config.sessionStoragePath
  const indexPath = `${storagePath}/index.json`
  const sessionPath = (id: SessionId) => `${storagePath}/${id}.json`

  // Ensure storage directory exists on initialization
  const ensureDirResult = await fs.ensureDir(storagePath)
  if (ensureDirResult instanceof FileSystemError) {
    return new SessionStorageError({
      operation: "initialize",
      path: storagePath,
      reason: ensureDirResult.reason,
    })
  }

  const loadIndex = async (): Promise<SessionStorageError | SessionIndex> => {
    const existsResult = await fs.exists(indexPath)

    if (existsResult instanceof FileSystemError) {
      return createEmptySessionIndex()
    }

    if (!existsResult) {
      return createEmptySessionIndex()
    }

    const result = await fs.readJson(indexPath, SessionIndexSchema)

    if (result instanceof FileSystemError) {
      // If index is corrupted, return empty index
      return createEmptySessionIndex()
    }

    return result
  }

  const saveIndex = async (
    index: SessionIndex
  ): Promise<SessionStorageError | void> => {
    const result = await fs.writeJson(indexPath, SessionIndexSchema, index)

    if (result instanceof FileSystemError) {
      return new SessionStorageError({
        operation: "saveIndex",
        path: indexPath,
        reason: result.reason,
      })
    }

    return undefined
  }

  const loadSession = async (
    id: SessionId
  ): Promise<SessionStorageError | SessionNotFoundError | SessionCorruptedError | SerializedSession> => {
    const path = sessionPath(id)
    const existsResult = await fs.exists(path)

    if (existsResult instanceof FileSystemError) {
      return new SessionNotFoundError({ sessionId: id })
    }

    if (!existsResult) {
      return new SessionNotFoundError({ sessionId: id })
    }

    const result = await fs.readJson(path, SerializedSessionSchema)

    if (result instanceof FileSystemError) {
      // Map FileSystemError to SessionCorruptedError
      return new SessionCorruptedError({
        sessionId: id,
        reason: result.reason,
      })
    }

    return result
  }

  const saveSession = async (
    session: SerializedSession
  ): Promise<SessionStorageError | void> => {
    const result = await fs.writeJson(
      sessionPath(session.metadata.id),
      SerializedSessionSchema,
      session
    )

    if (result instanceof FileSystemError) {
      return new SessionStorageError({
        operation: "saveSession",
        path: sessionPath(session.metadata.id),
        reason: result.reason,
      })
    }

    return undefined
  }

  const deleteSession = async (
    id: SessionId
  ): Promise<SessionStorageError | void> => {
    const result = await fs.remove(sessionPath(id))

    if (result instanceof FileSystemError) {
      return new SessionStorageError({
        operation: "deleteSession",
        path: sessionPath(id),
        reason: result.reason,
      })
    }

    return undefined
  }

  const listSessions = async (): Promise<SessionStorageError | SessionMetadata[]> => {
    const index = await loadIndex()

    if (index instanceof SessionStorageError) {
      return index
    }

    return index.sessions
  }

  const sessionExists = async (id: SessionId): Promise<boolean> => {
    const result = await fs.exists(sessionPath(id))
    if (result instanceof FileSystemError) return false
    return result
  }

  return {
    loadSession,
    saveSession,
    deleteSession,
    listSessions,
    loadIndex,
    saveIndex,
    sessionExists,
  }
}

/**
 * In-memory session storage for testing.
 * Implements the same interface but stores data in memory.
 */
export interface InMemorySessionStorage extends SessionStorage {
  /** Clear all stored sessions */
  clear(): void
  /** Get all stored session IDs */
  getSessionIds(): SessionId[]
}

/**
 * Create an in-memory SessionStorage for testing.
 */
export function createTestSessionStorage(): InMemorySessionStorage {
  const sessions = new Map<SessionId, SerializedSession>()
  let index: SessionIndex = createEmptySessionIndex()

  const loadIndex = async (): Promise<SessionStorageError | SessionIndex> => {
    return index
  }

  const saveIndex = async (
    newIndex: SessionIndex
  ): Promise<SessionStorageError | void> => {
    index = newIndex
    return undefined
  }

  const loadSession = async (
    id: SessionId
  ): Promise<SessionStorageError | SessionNotFoundError | SessionCorruptedError | SerializedSession> => {
    const session = sessions.get(id)

    if (!session) {
      return new SessionNotFoundError({ sessionId: id })
    }

    return session
  }

  const saveSession = async (
    session: SerializedSession
  ): Promise<SessionStorageError | void> => {
    sessions.set(session.metadata.id, session)

    // Update index if this is a new session
    const existingIndex = index.sessions.findIndex(
      (s) => s.id === session.metadata.id
    )

    if (existingIndex >= 0) {
      index.sessions[existingIndex] = session.metadata
    } else {
      index.sessions.push(session.metadata)
    }

    return undefined
  }

  const deleteSession = async (
    id: SessionId
  ): Promise<SessionStorageError | void> => {
    sessions.delete(id)

    // Update index
    index.sessions = index.sessions.filter((s) => s.id !== id)

    // Clear active session if it was deleted
    if (index.activeSessionId === id) {
      index.activeSessionId = null
    }

    return undefined
  }

  const listSessions = async (): Promise<SessionStorageError | SessionMetadata[]> => {
    return index.sessions
  }

  const sessionExists = async (id: SessionId): Promise<boolean> => {
    return sessions.has(id)
  }

  const clear = (): void => {
    sessions.clear()
    index = createEmptySessionIndex()
  }

  const getSessionIds = (): SessionId[] => {
    return Array.from(sessions.keys())
  }

  return {
    loadSession,
    saveSession,
    deleteSession,
    listSessions,
    loadIndex,
    saveIndex,
    sessionExists,
    clear,
    getSessionIds,
  }
}
