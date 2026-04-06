/**
 * Session manager service for orchestrating session operations.
 *
 * The public API groups related concerns instead of exposing parallel getters
 * and setters at the top level:
 * - getSessionInfo() replaces separate metadata + summary queries
 * - aggregateOrder groups persisted aggregate ordering reads/writes
 * - snapshot groups serialization and quick-save operations
 */
import type { SessionStorage } from './SessionStorage';
import type { PtyService } from './Pty';
import { SessionStorageError, SessionNotFoundError, type SessionError } from '../errors';
import type { SerializedSession, SessionMetadata } from '../models';
import type { SessionId } from '../types';
import type { WorkspaceState } from './session-manager/types';

import {
  createSession as lifecycleCreateSession,
  loadSession as lifecycleLoadSession,
  saveSession as lifecycleSaveSession,
  deleteSession as lifecycleDeleteSession,
  listSessions as lifecycleListSessions,
} from './session-manager/lifecycle';

import {
  renameSession as metadataRenameSession,
  getSessionInfo as metadataGetSessionInfo,
  updateAutoName as metadataUpdateAutoName,
  getAggregateSessionOrder as metadataGetAggregateSessionOrder,
  setAggregateSessionOrder as metadataSetAggregateSessionOrder,
  type SessionInfo,
} from './session-manager/metadata';

import {
  setActiveSessionId as activeSetActiveSessionId,
  switchToSession as activeSwitchToSession,
} from './session-manager/active-session';

import {
  serializeWorkspaces as quickSaveSerializeWorkspaces,
  quickSave as quickSaveQuickSave,
} from './session-manager/quick-save';

import { makeSessionId, makeWorkspaceId } from '../types';

export interface SessionSnapshotInput {
  metadata: SessionMetadata;
  workspaces: ReadonlyMap<number, WorkspaceState>;
  activeWorkspaceId: number;
  getCwd: (ptyId: string) => Promise<string>;
}

export interface SessionAggregateOrderStore {
  get(): Promise<SessionStorageError | string[]>;
  set(order: string[]): Promise<SessionStorageError | void>;
}

export interface SessionSnapshotStore {
  serialize(input: SessionSnapshotInput): Promise<SerializedSession>;
  save(input: SessionSnapshotInput): Promise<SessionStorageError | void>;
}

export interface SessionManager {
  createSession(name?: string): Promise<SessionStorageError | SessionMetadata>;
  loadSession(id: SessionId): Promise<SessionError | SerializedSession>;
  saveSession(session: SerializedSession): Promise<SessionStorageError | void>;
  deleteSession(id: SessionId): Promise<SessionError | void>;
  renameSession(id: SessionId, newName: string): Promise<SessionError | void>;
  listSessions(): Promise<SessionStorageError | SessionMetadata[]>;
  getActiveSessionId(): SessionId | null;
  setActiveSessionId(id: SessionId | null): Promise<SessionStorageError | void>;
  switchToSession(id: SessionId): Promise<SessionError | void>;
  getSessionInfo(id: SessionId): Promise<SessionError | SessionInfo | null>;
  updateAutoName(id: SessionId, cwd: string): Promise<SessionError | void>;
  aggregateOrder: SessionAggregateOrderStore;
  snapshot: SessionSnapshotStore;
}

/**
 * Create a production SessionManager instance.
 */
export async function createSessionManager(
  storage: SessionStorage,
  _pty: PtyService
): Promise<SessionStorageError | SessionManager> {
  let activeSessionId: SessionId | null = null;

  const getActiveSessionId = (): SessionId | null => activeSessionId;
  const setLocalActiveSessionId = (id: SessionId | null): void => {
    activeSessionId = id;
  };

  const index = await storage.loadIndex();
  if (index instanceof SessionStorageError) {
    return index;
  }

  if (index.activeSessionId) {
    activeSessionId = index.activeSessionId;
  }

  const lifecycleDeps = {
    storage,
    getActiveSessionId,
    setActiveSessionId: setLocalActiveSessionId,
  };

  const metadataDeps = {
    storage,
  };

  const activeSessionDeps = {
    storage,
    getActiveSessionId,
    setActiveSessionId: setLocalActiveSessionId,
  };

  const snapshotDeps = {
    saveSession: async (session: SerializedSession) => lifecycleSaveSession(storage, session),
  };

  return {
    createSession: (name?: string) => lifecycleCreateSession(lifecycleDeps, name),
    loadSession: (id: SessionId) => lifecycleLoadSession(storage, id),
    saveSession: (session: SerializedSession) => lifecycleSaveSession(storage, session),
    deleteSession: (id: SessionId) => lifecycleDeleteSession(lifecycleDeps, id),
    renameSession: (id: SessionId, newName: string) =>
      metadataRenameSession(metadataDeps, id, newName),
    listSessions: () => lifecycleListSessions(storage),
    getActiveSessionId,
    setActiveSessionId: (id: SessionId | null) => activeSetActiveSessionId(activeSessionDeps, id),
    switchToSession: (id: SessionId) => activeSwitchToSession(activeSessionDeps, id),
    getSessionInfo: (id: SessionId) => metadataGetSessionInfo(storage, id),
    updateAutoName: (id: SessionId, cwd: string) => metadataUpdateAutoName(metadataDeps, id, cwd),
    aggregateOrder: {
      get: () => metadataGetAggregateSessionOrder(storage),
      set: (order: string[]) => metadataSetAggregateSessionOrder(storage, order),
    },
    snapshot: {
      serialize: (input: SessionSnapshotInput) =>
        quickSaveSerializeWorkspaces(
          input.metadata,
          input.workspaces,
          input.activeWorkspaceId,
          input.getCwd
        ),
      save: (input: SessionSnapshotInput) =>
        quickSaveQuickSave(
          snapshotDeps,
          input.metadata,
          input.workspaces,
          input.activeWorkspaceId,
          input.getCwd
        ),
    },
  };
}

/**
 * Create test SessionManager - in-memory session storage for testing.
 */
export function createTestSessionManager(): SessionManager {
  const sessions = new Map<SessionId, SerializedSession>();
  let activeId: SessionId | null = null;
  let aggregateSessionOrder: string[] = [];

  const getActiveSessionId = (): SessionId | null => activeId;

  return {
    createSession: async (name?: string) => {
      const id = makeSessionId();
      const now = Date.now();

      const metadata: SessionMetadata = {
        id,
        name: name ?? 'test-session',
        createdAt: now,
        lastSwitchedAt: now,
        autoNamed: !name,
      };

      const session: SerializedSession = {
        metadata,
        workspaces: [],
        activeWorkspaceId: makeWorkspaceId(1),
      };

      sessions.set(id, session);
      activeId = id;

      return metadata;
    },

    loadSession: async (id: SessionId) => {
      const session = sessions.get(id);
      if (!session) {
        return new SessionNotFoundError({ sessionId: id });
      }
      return session;
    },

    saveSession: async (session: SerializedSession) => {
      sessions.set(session.metadata.id, session);
    },

    deleteSession: async (id: SessionId) => {
      if (!sessions.has(id)) {
        return new SessionNotFoundError({ sessionId: id });
      }
      sessions.delete(id);
      if (activeId === id) {
        activeId = null;
      }
    },

    renameSession: async (id: SessionId, newName: string) => {
      const session = sessions.get(id);
      if (!session) {
        return new SessionNotFoundError({ sessionId: id });
      }

      const updated: SerializedSession = {
        ...session,
        metadata: {
          ...session.metadata,
          name: newName,
          autoNamed: false,
        },
      };

      sessions.set(id, updated);
    },

    listSessions: async () => {
      return Array.from(sessions.values())
        .map((session) => session.metadata)
        .sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt);
    },

    getActiveSessionId,

    setActiveSessionId: async (id: SessionId | null) => {
      activeId = id;
    },

    switchToSession: async (id: SessionId) => {
      if (!sessions.has(id)) {
        return new SessionNotFoundError({ sessionId: id });
      }
      activeId = id;
    },

    getSessionInfo: async (id: SessionId) => {
      const session = sessions.get(id);
      if (!session) return null;
      return {
        metadata: session.metadata,
        summary: {
          workspaceCount: session.workspaces.length,
          paneCount: 0,
        },
      };
    },

    updateAutoName: async (id: SessionId, cwd: string) => {
      const session = sessions.get(id);
      if (!session) {
        return new SessionNotFoundError({ sessionId: id });
      }

      if (session.metadata.autoNamed) {
        const parts = cwd.split('/').filter(Boolean);
        const newName = parts[parts.length - 1] ?? 'untitled';

        if (newName !== session.metadata.name) {
          const updated: SerializedSession = {
            ...session,
            metadata: {
              ...session.metadata,
              name: newName,
            },
          };
          sessions.set(id, updated);
        }
      }
    },

    aggregateOrder: {
      get: async () => aggregateSessionOrder,
      set: async (order: string[]) => {
        const existingIds = new Set(Array.from(sessions.keys()));
        const nextOrder = order.filter(
          (id, index) => order.indexOf(id) === index && existingIds.has(id as SessionId)
        );
        const missing = Array.from(sessions.keys()).filter((id) => !nextOrder.includes(id));
        aggregateSessionOrder = [...nextOrder, ...missing];
      },
    },

    snapshot: {
      serialize: async (input: SessionSnapshotInput) => ({
        metadata: input.metadata,
        workspaces: [],
        activeWorkspaceId: makeWorkspaceId(1),
      }),
      save: async () => {
        // No-op in test mode.
      },
    },
  };
}
