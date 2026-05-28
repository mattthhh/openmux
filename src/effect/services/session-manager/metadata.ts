/**
 * Session metadata operations for SessionManager.
 * Handles rename, auto-name updates, summary derivation, and aggregate ordering.
 */

import type { SerializedSession, SessionMetadata, SerializedLayoutNode } from '../../models';
import type { SessionId } from '../../types';
import type { SessionStorage } from '../SessionStorage';
import {
  SessionStorageError,
  SessionNotFoundError,
  SessionCorruptedError,
  type SessionError,
} from '../../errors';
import { getAutoName } from './serialization';

export interface MetadataDeps {
  storage: SessionStorage;
}

export interface SessionSummary {
  workspaceCount: number;
  paneCount: number;
}

export interface SessionInfo {
  metadata: SessionMetadata;
  summary: SessionSummary;
}

function countPanes(node: SerializedLayoutNode | null): number {
  if (!node) return 0;
  if ((node as { type?: string }).type === 'split') {
    const split = node as SerializedLayoutNode & {
      first: SerializedLayoutNode;
      second: SerializedLayoutNode;
    };
    return countPanes(split.first) + countPanes(split.second);
  }
  return 1;
}

function buildSessionSummary(session: SerializedSession): SessionSummary {
  let paneCount = 0;
  let workspaceCount = 0;

  for (const workspace of session.workspaces) {
    if (!workspace.mainPane && workspace.stackPanes.length === 0) {
      continue;
    }

    workspaceCount += 1;
    paneCount += countPanes(workspace.mainPane);
    for (const pane of workspace.stackPanes) {
      paneCount += countPanes(pane);
    }
  }

  return { workspaceCount, paneCount };
}

/**
 * Rename a session.
 */
export async function renameSession(
  deps: MetadataDeps,
  id: SessionId,
  newName: string
): Promise<SessionError | void> {
  const { storage } = deps;

  const session = await storage.loadSession(id);
  if (
    session instanceof SessionNotFoundError ||
    session instanceof SessionStorageError ||
    session instanceof SessionCorruptedError
  ) {
    return session;
  }

  const updatedMetadata: SessionMetadata = {
    ...session.metadata,
    name: newName,
    autoNamed: false,
  };

  const updated: SerializedSession = {
    ...session,
    metadata: updatedMetadata,
  };

  const saveResult = await storage.saveSession(updated);
  if (saveResult instanceof SessionStorageError) {
    return saveResult;
  }

  const currentIndex = await storage.loadIndex();
  if (currentIndex instanceof SessionStorageError) {
    return currentIndex;
  }

  const updatedSessions = currentIndex.sessions.map((sessionMetadata) =>
    sessionMetadata.id === id ? updatedMetadata : sessionMetadata
  );

  return storage.saveIndex({
    sessions: updatedSessions,
    activeSessionId: currentIndex.activeSessionId,
    aggregateSessionOrder: currentIndex.aggregateSessionOrder,
    aggregateHiddenSessionGroups: currentIndex.aggregateHiddenSessionGroups,
  });
}

/**
 * Get lightweight metadata for a session from the index.
 */
export async function getSessionMetadata(
  storage: SessionStorage,
  id: SessionId
): Promise<SessionStorageError | SessionMetadata | null> {
  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  return index.sessions.find((session) => session.id === id) ?? null;
}

/**
 * Get metadata + derived summary in a single lookup.
 */
export async function getSessionInfo(
  storage: SessionStorage,
  id: SessionId
): Promise<SessionError | SessionInfo | null> {
  const metadata = await getSessionMetadata(storage, id);
  if (metadata instanceof SessionStorageError) {
    return metadata;
  }
  if (metadata === null) {
    return null;
  }

  const session = await storage.loadSession(id);
  if (session instanceof SessionStorageError || session instanceof SessionCorruptedError) {
    return session;
  }
  if (session instanceof SessionNotFoundError) {
    return new SessionCorruptedError({
      sessionId: id,
      reason: 'session index entry is missing backing session data',
      cause: session,
    });
  }

  return {
    metadata,
    summary: buildSessionSummary(session),
  };
}

/**
 * Update auto-name for a session based on cwd.
 */
export async function updateAutoName(
  deps: MetadataDeps,
  id: SessionId,
  cwd: string
): Promise<SessionError | void> {
  const { storage } = deps;

  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  const session = index.sessions.find((candidate) => candidate.id === id);
  if (!session || !session.autoNamed) {
    return;
  }

  const newName = getAutoName(cwd);
  if (newName === session.name) {
    return;
  }

  const updated: SessionMetadata = { ...session, name: newName };
  const updatedSessions = index.sessions.map((candidate) =>
    candidate.id === id ? updated : candidate
  );

  return storage.saveIndex({
    sessions: updatedSessions,
    activeSessionId: index.activeSessionId,
    aggregateSessionOrder: index.aggregateSessionOrder,
    aggregateHiddenSessionGroups: index.aggregateHiddenSessionGroups,
  });
}

export async function getAggregateSessionOrder(
  storage: SessionStorage
): Promise<SessionStorageError | string[]> {
  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  return [...(index.aggregateSessionOrder ?? [])].map((id) => String(id));
}

export async function setAggregateSessionOrder(
  storage: SessionStorage,
  order: string[]
): Promise<SessionStorageError | void> {
  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  const existingIds = new Set(index.sessions.map((session) => String(session.id)));
  const nextOrder = order.filter(
    (id, indexPosition) => order.indexOf(id) === indexPosition && existingIds.has(id)
  );
  const missingIds = index.sessions
    .map((session) => String(session.id))
    .filter((id) => !nextOrder.includes(id));

  return storage.saveIndex({
    sessions: index.sessions,
    activeSessionId: index.activeSessionId,
    aggregateSessionOrder: [...nextOrder, ...missingIds].map((id) => id as SessionId),
    aggregateHiddenSessionGroups: index.aggregateHiddenSessionGroups,
  });
}

export async function getAggregateHiddenSessionGroups(
  storage: SessionStorage
): Promise<SessionStorageError | string[]> {
  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  return [...(index.aggregateHiddenSessionGroups ?? [])].map((id) => String(id));
}

export async function setAggregateHiddenSessionGroups(
  storage: SessionStorage,
  hiddenGroupIds: string[]
): Promise<SessionStorageError | void> {
  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  // Only keep IDs that correspond to existing sessions
  const existingIds = new Set(index.sessions.map((session) => String(session.id)));
  const nextHidden = hiddenGroupIds.filter((id) => existingIds.has(id));

  return storage.saveIndex({
    sessions: index.sessions,
    activeSessionId: index.activeSessionId,
    aggregateSessionOrder: index.aggregateSessionOrder,
    aggregateHiddenSessionGroups: nextHidden.map((id) => id as SessionId),
  });
}
