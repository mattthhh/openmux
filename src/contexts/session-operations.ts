/**
 * Session CRUD operations.
 */

import type { SessionId, SessionMetadata, WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import type { SessionState, SessionAction } from '../core/operations/session-actions';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  renameSessionLegacy as renameSessionOnDisk,
  deleteSessionLegacy as deleteSessionOnDisk,
  saveCurrentSession,
  loadSessionData,
  switchToSession,
} from '../effect/bridge';
import { SessionStorageError, SessionNotFoundError, SessionCorruptedError } from '../effect/errors';
import { ResourceStack } from '../effect/resources.js';

/** AsyncDisposable guard for switching state */
class SwitchingGuard implements AsyncDisposable {
  constructor(
    private dispatch: (action: SessionAction) => void,
    private isActive: boolean
  ) {}

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.isActive) {
      this.dispatch({ type: 'SET_SWITCHING', switching: false });
    }
  }
}

export interface SessionOperationsParams {
  getState: () => SessionState;
  dispatch: (action: SessionAction) => void;
  getCwd: (ptyId: string) => Promise<string>;
  getWorkspaces: () => Workspaces;
  getActiveWorkspaceId: () => WorkspaceId;
  shouldPersistSession: (workspaces: Workspaces) => boolean;
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => Promise<void>;
  onBeforeSwitch: (currentSessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
}

export function createSessionOperations(params: SessionOperationsParams) {
  const {
    getState,
    dispatch,
    getCwd,
    getWorkspaces,
    getActiveWorkspaceId,
    shouldPersistSession,
    onSessionLoad,
    onBeforeSwitch,
    onDeleteSession,
    refreshSessions,
  } = params;

  let latestSwitchToken = 0;
  let switchQueue = Promise.resolve();

  const refreshSessionsInBackground = () => {
    void refreshSessions().catch((error) => {
      console.warn('[SessionOperations] Failed to refresh sessions:', error);
    });
  };

  const createSession = async (name?: string): Promise<SessionMetadata | SessionStorageError> => {
    const state = getState();

    // Save current session first
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspaces();
      const activeWorkspaceId = getActiveWorkspaceId();
      if (shouldPersistSession(workspaces)) {
        await saveCurrentSession(state.activeSession, workspaces, activeWorkspaceId, getCwd);
      }

      // Suspend PTYs for current session before switching
      await onBeforeSwitch(state.activeSessionId);
    }

    // Guaranteed cleanup: always close session picker when function exits
    await using resources = new ResourceStack();
    resources.defer(() => {
      dispatch({ type: 'CLOSE_SESSION_PICKER' });
    });

    const result = await createSessionOnDisk(name);
    if (result instanceof SessionStorageError) {
      console.error('Failed to create session:', result.message);
      return result;
    }

    const metadata = result;
    await refreshSessions();
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });

    // Load empty workspaces for new session
    await onSessionLoad({}, 1, new Map(), new Map(), metadata.id, { allowPrune: false });

    return metadata;
  };

  const switchSessionInternal = async (
    id: SessionId,
    options: {
      skipSave?: boolean;
      skipBeforeSwitch?: boolean;
      preloadedData?: Awaited<ReturnType<typeof loadSessionData>>;
    } = {},
    switchToken?: number
  ): Promise<void> => {
    const state = getState();
    if (id === state.activeSessionId) return;

    const isStale = () => switchToken !== undefined && switchToken !== latestSwitchToken;

    const dataPromise = options.preloadedData
      ? Promise.resolve(options.preloadedData)
      : loadSessionData(id);

    // Suspend immediately so PTY ownership is stable, but persist the session snapshot
    // in the background so switching is not blocked on disk/CWD collection.
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspaces();
      const activeWorkspaceId = getActiveWorkspaceId();
      if (!options.skipSave && shouldPersistSession(workspaces)) {
        const workspacesSnapshot = structuredClone(workspaces);
        void saveCurrentSession(
          state.activeSession,
          workspacesSnapshot,
          activeWorkspaceId,
          getCwd
        ).then((result) => {
          if (result instanceof Error) {
            console.warn(
              '[SessionOperations] Failed to save session during switch:',
              result.message
            );
          }
        });
      }

      if (!options.skipBeforeSwitch) {
        await onBeforeSwitch(state.activeSessionId);
      }
    }

    if (isStale()) return;

    // Mark switching in progress to prevent "No panes" flash
    dispatch({ type: 'SET_SWITCHING', switching: true });

    // Guaranteed cleanup: always close picker and reset switching state
    await using resources = new ResourceStack();
    resources.defer(() => {
      dispatch({ type: 'CLOSE_SESSION_PICKER' });
    });
    await using _switchGuard = new SwitchingGuard(dispatch, true);
    void _switchGuard;

    const switchResult = await switchToSession(id);
    if (
      switchResult instanceof SessionNotFoundError ||
      switchResult instanceof SessionCorruptedError ||
      switchResult instanceof SessionStorageError
    ) {
      console.error('Failed to switch to session:', switchResult.message);
      return;
    }

    if (isStale()) return;

    // Use preloaded data if available, otherwise consume the in-flight load.
    const data = await dataPromise;

    if (data === null) {
      return;
    }

    if (isStale()) return;

    if (data instanceof SessionNotFoundError || data instanceof SessionCorruptedError) {
      console.error('Failed to load session data:', data.message);
      // Load failure - keep layout consistent by clearing to an empty session.
      // Only publish the new active session after layout/PTY restoration finishes,
      // otherwise aggregate view can observe the new session id with the old layout.
      const fallbackSession = state.sessions.find((session) => session.id === id);
      await onSessionLoad({}, 1, new Map(), new Map(), id, { allowPrune: false });
      if (fallbackSession) {
        dispatch({ type: 'SET_ACTIVE_SESSION', id, session: fallbackSession });
      }
      refreshSessionsInBackground();
      return;
    }

    // IMPORTANT: Await onSessionLoad before publishing the active session change so
    // aggregate view never sees a mismatched session id and previous layout snapshot.
    await onSessionLoad(data.workspaces, data.activeWorkspaceId, data.cwdMap, new Map(), id, {
      allowPrune: true,
    });
    dispatch({
      type: 'SET_ACTIVE_SESSION',
      id,
      session: { ...data.metadata, lastSwitchedAt: Date.now() },
    });

    refreshSessionsInBackground();
  };

  const switchSession = async (
    id: SessionId,
    options?: { preloadedData?: Awaited<ReturnType<typeof loadSessionData>> }
  ): Promise<void> => {
    const switchToken = ++latestSwitchToken;
    const previousSwitch = switchQueue;

    let releaseQueue!: () => void;
    switchQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousSwitch;

    try {
      if (switchToken !== latestSwitchToken) {
        return;
      }

      await switchSessionInternal(id, options, switchToken);
    } finally {
      releaseQueue();
    }
  };

  const renameSession = async (id: SessionId, name: string): Promise<void> => {
    const result = await renameSessionOnDisk(id, name);
    if (
      result instanceof SessionNotFoundError ||
      result instanceof SessionCorruptedError ||
      result instanceof SessionStorageError
    ) {
      console.error('Failed to rename session:', result.message);
      return;
    }
    await refreshSessions();

    const state = getState();
    if (state.activeSessionId === id && state.activeSession) {
      dispatch({
        type: 'SET_ACTIVE_SESSION',
        id,
        session: { ...state.activeSession, name, autoNamed: false },
      });
    }

    dispatch({ type: 'CANCEL_RENAME' });
  };

  const deleteSession = async (id: SessionId): Promise<void> => {
    const state = getState();
    const isActive = state.activeSessionId === id;
    if (isActive) {
      dispatch({ type: 'SET_SWITCHING', switching: true });
    }

    await using _switchGuardDelete = new SwitchingGuard(dispatch, isActive);
    void _switchGuardDelete;

    // If deleting the active session, suspend before cleanup to capture PTYs.
    if (isActive && state.activeSessionId) {
      await onBeforeSwitch(state.activeSessionId);
    }

    // Clean up PTYs for the deleted session
    onDeleteSession(id);

    const deleteResult = await deleteSessionOnDisk(id);
    if (
      deleteResult instanceof SessionNotFoundError ||
      deleteResult instanceof SessionCorruptedError ||
      deleteResult instanceof SessionStorageError
    ) {
      console.error('Failed to delete session:', deleteResult.message);
      return;
    }
    await refreshSessions();

    // If deleting active session, switch to another
    if (isActive) {
      const sessions = await listSessions();
      const nextSession = sessions.find((session) => session.id !== id) ?? null;
      if (nextSession) {
        await switchSessionInternal(nextSession.id, { skipSave: true, skipBeforeSwitch: true });
      } else {
        const createResult = await createSessionOnDisk();
        if (createResult instanceof SessionStorageError) {
          console.error('Failed to create new session:', createResult.message);
          return;
        }
        const metadata = createResult;
        dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
        await onSessionLoad({}, 1, new Map(), new Map(), metadata.id, { allowPrune: false });
        await refreshSessions();
      }
    }
  };

  const saveSession = async (): Promise<void> => {
    const state = getState();
    if (!state.activeSession) return;

    const workspaces = getWorkspaces();
    const activeWorkspaceId = getActiveWorkspaceId();

    if (shouldPersistSession(workspaces)) {
      await saveCurrentSession(state.activeSession, workspaces, activeWorkspaceId, getCwd);
      await refreshSessions();
    }
  };

  return {
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
  };
}
