/**
 * Session storage for CLI commands.
 * Uses errore for type-safe error handling.
 */

import * as errore from 'errore';
import fs from 'fs/promises';
import path from 'path';

import type { SessionMetadata } from '../core/types';
import { makeSessionId } from '../effect/types';
import { FileSystemError } from '../effect/errors';
import { getAutoName } from '../effect/services/session-manager/serialization';

export type SessionIndex = {
  sessions: SessionMetadata[];
  activeSessionId: string | null;
};

const DEFAULT_SESSION_INDEX: SessionIndex = {
  sessions: [],
  activeSessionId: null,
};

function getSessionStoragePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  return path.join(home, '.config', 'openmux', 'sessions');
}

function getIndexPath(storagePath: string): string {
  return path.join(storagePath, 'index.json');
}

function getSessionPath(storagePath: string, sessionId: string): string {
  return path.join(storagePath, `${sessionId}.json`);
}

function normalizeIndex(raw: unknown): SessionIndex {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SESSION_INDEX };
  const index = raw as SessionIndex;
  const sessions = Array.isArray(index.sessions) ? index.sessions : [];
  const activeSessionId = typeof index.activeSessionId === 'string' ? index.activeSessionId : null;
  return { sessions, activeSessionId };
}

/**
 * Load session index from disk.
 * @returns SessionIndex on success, logs warning on failure and returns default
 */
export async function loadSessionIndex(): Promise<SessionIndex> {
  const storagePath = getSessionStoragePath();
  const indexPath = getIndexPath(storagePath);

  // Read file with errore
  const contentResult = await errore.tryAsync<string, FileSystemError>({
    try: () => fs.readFile(indexPath, 'utf8'),
    catch: (e) =>
      new FileSystemError({ operation: 'read', path: indexPath, reason: String(e), cause: e }),
  });
  if (contentResult instanceof FileSystemError) {
    // File may not exist or be unreadable - return default
    return { ...DEFAULT_SESSION_INDEX };
  }

  // Parse JSON with errore (sync operation wrapped in async)
  const parsedResult = errore.try<unknown, FileSystemError>({
    try: () => JSON.parse(contentResult) as unknown,
    catch: (e) =>
      new FileSystemError({
        operation: 'read',
        path: indexPath,
        reason: `Invalid JSON: ${String(e)}`,
        cause: e,
      }),
  });
  if (parsedResult instanceof FileSystemError) {
    console.warn('[session-store] Failed to parse session index:', parsedResult.message);
    return { ...DEFAULT_SESSION_INDEX };
  }

  return normalizeIndex(parsedResult);
}

/**
 * Save session index to disk.
 * @returns void on success, logs error on failure
 */
export async function saveSessionIndex(index: SessionIndex): Promise<void> {
  const storagePath = getSessionStoragePath();
  const indexPath = getIndexPath(storagePath);

  // Ensure directory exists
  const mkdirResult = await errore.tryAsync<void, FileSystemError>({
    try: async () => {
      await fs.mkdir(storagePath, { recursive: true });
    },
    catch: (e) =>
      new FileSystemError({ operation: 'write', path: storagePath, reason: String(e), cause: e }),
  });
  if (mkdirResult instanceof FileSystemError) {
    console.warn('[session-store] Failed to create sessions directory:', mkdirResult.message);
    return;
  }

  // Write file
  const writeResult = await errore.tryAsync<void, FileSystemError>({
    try: async () => {
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
    },
    catch: (e) =>
      new FileSystemError({ operation: 'write', path: indexPath, reason: String(e), cause: e }),
  });
  if (writeResult instanceof FileSystemError) {
    console.warn('[session-store] Failed to save session index:', writeResult.message);
  }
}

/** List all sessions on disk, sorted by last switched time (most recent first) */
export async function listSessionsOnDisk(): Promise<{
  sessions: SessionMetadata[];
  activeSessionId: string | null;
}> {
  const index = await loadSessionIndex();
  const sessions = [...index.sessions].sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt);
  return { sessions, activeSessionId: index.activeSessionId };
}

/**
 * Create a new session on disk.
 * @returns SessionMetadata on success, throws on critical failure
 */
export async function createSessionOnDisk(name?: string): Promise<SessionMetadata> {
  const storagePath = getSessionStoragePath();

  // Ensure directory exists
  const mkdirResult = await errore.tryAsync<void, FileSystemError>({
    try: async () => {
      await fs.mkdir(storagePath, { recursive: true });
    },
    catch: (e) =>
      new FileSystemError({ operation: 'write', path: storagePath, reason: String(e), cause: e }),
  });
  if (mkdirResult instanceof FileSystemError) {
    throw mkdirResult; // Critical failure - can't create session
  }

  const id = makeSessionId();
  const now = Date.now();
  const trimmed = name?.trim() ?? '';
  const sessionName = trimmed.length > 0 ? trimmed : getAutoName(process.cwd());

  const metadata: SessionMetadata = {
    id,
    name: sessionName,
    createdAt: now,
    lastSwitchedAt: now,
    autoNamed: trimmed.length === 0,
  };

  const sessionPayload = {
    metadata,
    workspaces: [],
    activeWorkspaceId: 1,
  };

  const sessionPath = getSessionPath(storagePath, id);

  // Write session file
  const writeResult = await errore.tryAsync<void, FileSystemError>({
    try: async () => {
      await fs.writeFile(sessionPath, JSON.stringify(sessionPayload, null, 2), 'utf8');
    },
    catch: (e) =>
      new FileSystemError({ operation: 'write', path: sessionPath, reason: String(e), cause: e }),
  });
  if (writeResult instanceof FileSystemError) {
    throw writeResult; // Critical failure - session file not written
  }

  // Update index
  const index = await loadSessionIndex();
  const sessions = [...index.sessions.filter((s) => s.id !== id), metadata];
  await saveSessionIndex({ sessions, activeSessionId: id });

  return metadata;
}
