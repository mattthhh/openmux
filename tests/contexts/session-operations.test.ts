import { beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';

import type { Workspaces } from '../../src/core/operations/layout-actions';
import type { SessionState } from '../../src/core/operations/session-actions';
import type { SessionMetadata, WorkspaceId } from '../../src/core/types';
let createSessionOperations: typeof import('../../src/contexts/session-operations').createSessionOperations;
let createSessionLegacy: typeof import('../../src/effect/bridge').createSessionLegacy;
let deleteSessionLegacy: typeof import('../../src/effect/bridge').deleteSessionLegacy;
let listSessionsLegacy: typeof import('../../src/effect/bridge').listSessionsLegacy;
let loadSessionData: typeof import('../../src/effect/bridge').loadSessionData;
let saveCurrentSession: typeof import('../../src/effect/bridge').saveCurrentSession;
let switchToSession: typeof import('../../src/effect/bridge').switchToSession;

const createMetadata = (id: string, name = id): SessionMetadata => ({
  id,
  name,
  createdAt: 1,
  lastSwitchedAt: 1,
  autoNamed: false,
});

const createState = (overrides: Partial<SessionState> = {}): SessionState => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  showSessionPicker: false,
  searchQuery: '',
  selectedIndex: 0,
  isRenaming: false,
  renameValue: '',
  renamingSessionId: null,
  summaries: new Map(),
  initialized: true,
  switching: false,
  ...overrides,
});

describe('createSessionOperations', () => {
  beforeAll(async () => {
    ({ createSessionOperations } = await import('../../src/contexts/session-operations'));
    ({
      createSessionLegacy,
      deleteSessionLegacy,
      listSessionsLegacy,
      loadSessionData,
      saveCurrentSession,
      switchToSession,
    } = await import('../../src/effect/bridge'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips saving and switches to the next session when deleting the active session', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    const onSessionLoad = vi.fn().mockResolvedValue(undefined);
    const onBeforeSwitch = vi.fn().mockResolvedValue(undefined);
    const onDeleteSession = vi.fn();
    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad,
      onBeforeSwitch,
      onDeleteSession,
      refreshSessions,
    });

    const loadedData = {
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    };

    // Cast to any to set mock resolved value
    (listSessionsLegacy as any).mockResolvedValue([sessionB]);
    (loadSessionData as any).mockResolvedValue(loadedData);
    (switchToSession as any).mockResolvedValue(undefined);
    (deleteSessionLegacy as any).mockResolvedValue(undefined);

    await ops.deleteSession(sessionA.id);

    expect(saveCurrentSession).not.toHaveBeenCalled();
    expect(onBeforeSwitch).toHaveBeenCalledWith(sessionA.id);
    expect(onDeleteSession).toHaveBeenCalledWith(sessionA.id);
    expect(deleteSessionLegacy).toHaveBeenCalledWith(sessionA.id);
    expect(switchToSession).toHaveBeenCalledWith(sessionB.id);
    expect(onSessionLoad).toHaveBeenCalledWith(
      loadedData.workspaces,
      loadedData.activeWorkspaceId,
      loadedData.cwdMap,
      expect.any(Map),
      sessionB.id,
      { allowPrune: true }
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      id: sessionB.id,
      session: {
        ...sessionB,
        lastSwitchedAt: expect.any(Number),
      },
    });
  });

  it('creates a new session when deleting the last active session', async () => {
    const sessionA = createMetadata('session-a');
    const newSession = createMetadata('session-new');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    const onSessionLoad = vi.fn().mockResolvedValue(undefined);
    const onBeforeSwitch = vi.fn().mockResolvedValue(undefined);
    const onDeleteSession = vi.fn();
    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad,
      onBeforeSwitch,
      onDeleteSession,
      refreshSessions,
    });

    (listSessionsLegacy as any).mockResolvedValue([]);
    (deleteSessionLegacy as any).mockResolvedValue(undefined);
    (createSessionLegacy as any).mockResolvedValue(newSession);

    await ops.deleteSession(sessionA.id);

    expect(saveCurrentSession).not.toHaveBeenCalled();
    expect(onBeforeSwitch).toHaveBeenCalledWith(sessionA.id);
    expect(onDeleteSession).toHaveBeenCalledWith(sessionA.id);
    expect(createSessionLegacy).toHaveBeenCalled();
    expect(onSessionLoad).toHaveBeenCalledWith(
      {},
      1,
      expect.any(Map),
      expect.any(Map),
      newSession.id,
      { allowPrune: false }
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      id: newSession.id,
      session: newSession,
    });
  });

  it('avoids saving when shouldPersistSession is false', async () => {
    const sessionA = createMetadata('session-a');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions,
    });

    await ops.saveSession();

    expect(saveCurrentSession).not.toHaveBeenCalled();
    expect(refreshSessions).not.toHaveBeenCalled();
  });

  it('saves when shouldPersistSession is true', async () => {
    const sessionA = createMetadata('session-a');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions,
    });

    (saveCurrentSession as any).mockResolvedValue(undefined);

    await ops.saveSession();

    expect(saveCurrentSession).toHaveBeenCalledWith(sessionA, {}, 1, expect.any(Function));
    expect(refreshSessions).toHaveBeenCalled();
  });

  it('does not block session switching on session list refresh', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    const onSessionLoad = vi.fn().mockResolvedValue(undefined);
    const refreshSessions = vi.fn(
      () =>
        new Promise<void>(() => {
          // Intentionally never resolves. Switching should still finish.
        })
    );

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad,
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions,
    });

    (switchToSession as any).mockResolvedValue(undefined);
    (loadSessionData as any).mockResolvedValue({
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    });

    const outcome = await Promise.race([
      ops.switchSession(sessionB.id).then(() => 'resolved' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);

    expect(outcome).toBe('resolved');
    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(onSessionLoad).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SWITCHING', switching: false });
  });

  it('does not block session switching on session save', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}) as Workspaces,
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
    });

    (saveCurrentSession as any).mockImplementation(
      () =>
        new Promise<void>(() => {
          // Intentionally never resolves. Switching should still finish.
        })
    );
    (switchToSession as any).mockResolvedValue(undefined);
    (loadSessionData as any).mockResolvedValue({
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    });

    const outcome = await Promise.race([
      ops.switchSession(sessionB.id).then(() => 'resolved' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);

    expect(outcome).toBe('resolved');
    expect(saveCurrentSession).toHaveBeenCalledTimes(1);
  });

  it('still updates the active session on disk when preloaded data is supplied', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const onSessionLoad = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad,
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
    });

    (switchToSession as any).mockResolvedValue(undefined);

    const preloadedData = {
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    };

    await ops.switchSession(sessionB.id, { preloadedData });

    expect(switchToSession).toHaveBeenCalledWith(sessionB.id);
    expect(loadSessionData).not.toHaveBeenCalled();
    expect(onSessionLoad).toHaveBeenCalledWith(
      preloadedData.workspaces,
      preloadedData.activeWorkspaceId,
      preloadedData.cwdMap,
      expect.any(Map),
      sessionB.id,
      { allowPrune: true }
    );
  });

  it('drops stale earlier switch requests when a newer target arrives', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const sessionC = createMetadata('session-c');
    const state = createState({
      sessions: [sessionA, sessionB, sessionC],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    let releaseFirstSuspend!: () => void;
    const firstSuspend = new Promise<void>((resolve) => {
      releaseFirstSuspend = resolve;
    });
    const onBeforeSwitch = vi
      .fn()
      .mockImplementationOnce(() => firstSuspend)
      .mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}) as Workspaces,
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch,
      onDeleteSession: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
    });

    (switchToSession as any).mockResolvedValue(undefined);
    (loadSessionData as any)
      .mockResolvedValueOnce({
        metadata: sessionB,
        workspaces: {} as Workspaces,
        activeWorkspaceId: 1 as WorkspaceId,
        cwdMap: new Map<string, string>(),
      })
      .mockResolvedValueOnce({
        metadata: sessionC,
        workspaces: {} as Workspaces,
        activeWorkspaceId: 1 as WorkspaceId,
        cwdMap: new Map<string, string>(),
      });

    const firstSwitch = ops.switchSession(sessionB.id);
    await Promise.resolve();
    const secondSwitch = ops.switchSession(sessionC.id);
    releaseFirstSuspend();

    await Promise.all([firstSwitch, secondSwitch]);

    expect(switchToSession).not.toHaveBeenCalledWith(sessionB.id);
    expect(switchToSession).toHaveBeenCalledWith(sessionC.id);
  });

  it('waits to publish the active session until after session load completes', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    let resolveSessionLoad!: () => void;
    const onSessionLoad = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSessionLoad = resolve;
        })
    );

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad,
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
    });

    (switchToSession as any).mockResolvedValue(undefined);
    (loadSessionData as any).mockResolvedValue({
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    });

    const switchPromise = ops.switchSession(sessionB.id);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSessionLoad).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'SET_ACTIVE_SESSION' && action.id === sessionB.id
      )
    ).toBe(false);

    resolveSessionLoad();
    await switchPromise;

    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'SET_ACTIVE_SESSION' && action.id === sessionB.id
      )
    ).toBe(true);
  });
});
