/**
 * Tests for the synchronous aggregateSessionMappings update in pty-lifecycle.
 *
 * Root cause: When a new PTY is created for a session switch, the lifecycle
 * stream callback (handlePtyCreated) can race ahead of the async
 * registerPtyPane call. Without a synchronous mapping update, the
 * resolveAggregatePtyOwnership fallback attributes the PTY to the wrong
 * session (via activeSessionId), causing PTYs to "bleed" into other session
 * groups in the aggregate view.
 *
 * The fix: createPTY and createPaneWithPTY synchronously write to
 * aggregateSessionMappings BEFORE the lifecycle event fires, so that
 * getAggregateSessionForPty can find the PTY immediately.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';

import type { TerminalScrollState } from '../../../src/core/types';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';

// Import the real module-level functions — these are what pty-lifecycle
// ultimately uses through the barrel re-export.
import {
  setActiveSessionIdForShim,
  getActiveSessionIdForShim,
} from '../../../src/effect/bridge/app-coordinator-bridge';
import {
  aggregateSessionMappings,
  getAggregateSessionForPty,
} from '../../../src/effect/bridge/aggregate/cache/session-pty-cache';

vi.mock('../../../src/hooks/usePtySubscription', () => ({
  subscribeToPtyWithCaches: vi.fn(),
  subscribeToPtyExit: vi.fn(),
  clearPtyCaches: vi.fn(),
  clearAllPtyCaches: vi.fn(),
}));

// Mock the barrel module. pty-lifecycle imports from this barrel, so we must
// mock it. Include the real setActiveSessionIdForShim / getActiveSessionIdForShim
// by re-exporting from the real app-coordinator-bridge module.
vi.mock('../../../src/effect/bridge', () => {
  const actualAppCoordinator = require('../../../src/effect/bridge/app-coordinator-bridge');
  return {
    createPtySession: vi.fn(),
    destroyPty: vi.fn(),
    destroyAllPtys: vi.fn(),
    writeToPty: vi.fn(),
    sendPtyFocusEvent: vi.fn(),
    resizePty: vi.fn(),
    getPtyCwd: vi.fn().mockResolvedValue(''),
    getPtyForegroundProcess: vi.fn().mockResolvedValue(undefined),
    getPtyLastCommand: vi.fn().mockResolvedValue(undefined),
    getTerminalState: vi.fn(),
    onPtyExit: vi.fn(),
    getScrollState: vi.fn(),
    capturePty: vi.fn(),
    getScrollbackLines: vi.fn(),
    setScrollOffset: vi.fn(),
    subscribeUnifiedToPty: vi.fn().mockResolvedValue(() => {}),
    getEmulator: vi.fn().mockResolvedValue(null),
    getEmulatorSync: vi.fn().mockReturnValue(null),
    setPtyUpdateEnabled: vi.fn(),
    refreshPty: vi.fn(),
    applyHostColors: vi.fn(),
    subscribeToPtyLifecycle: vi.fn().mockResolvedValue(() => {}),
    subscribeToAllTitleChanges: vi.fn().mockResolvedValue(() => {}),
    subscribeToAllPtyActivity: vi.fn().mockResolvedValue(() => {}),
    getPtyTitle: vi.fn(),
    // Use real implementations for session ID management
    setActiveSessionIdForShim: actualAppCoordinator.setActiveSessionIdForShim,
    getActiveSessionIdForShim: actualAppCoordinator.getActiveSessionIdForShim,
    registerPtyPane: vi.fn().mockResolvedValue(undefined),
    // Stub remaining session/template/aggregate/keyboard/color exports
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    loadSession: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    getActiveSessionId: vi.fn().mockResolvedValue(null),
    setActiveSessionId: vi.fn(),
    switchToSession: vi.fn().mockResolvedValue(undefined),
    getSessionMetadata: vi.fn(),
    getSessionInfoResult: vi.fn(),
    updateAutoName: vi.fn(),
    getSessionSummary: vi.fn(),
    getAggregateSessionOrder: vi.fn().mockResolvedValue([]),
    setAggregateSessionOrder: vi.fn().mockResolvedValue(undefined),
    createSessionLegacy: vi.fn(),
    listSessionsLegacy: vi.fn().mockResolvedValue([]),
    getActiveSessionIdLegacy: vi.fn().mockResolvedValue(null),
    renameSessionLegacy: vi.fn(),
    deleteSessionLegacy: vi.fn(),
    saveCurrentSession: vi.fn(),
    loadSessionData: vi.fn(),
    listTemplates: vi.fn().mockResolvedValue([]),
    loadTemplate: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    buildLayoutFromTemplate: vi.fn(),
    createAggregateService: vi.fn(),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    readFromClipboard: vi.fn().mockResolvedValue(''),
    getHostBackgroundColor: vi.fn().mockReturnValue('#000000'),
    getHostForegroundColor: vi.fn().mockReturnValue('#ffffff'),
    clearPtyTracking: vi.fn(),
    markPtyCreated: vi.fn(),
    isPtyCreated: vi.fn().mockReturnValue(false),
    setSessionCwdMap: vi.fn(),
    getSessionCwd: vi.fn().mockReturnValue(undefined),
    clearSessionCwdMap: vi.fn(),
    setSessionCommandMap: vi.fn(),
    getSessionCommand: vi.fn().mockReturnValue(undefined),
    clearSessionCommandMap: vi.fn(),
    getSessionPtyMapping: vi.fn().mockResolvedValue(undefined),
    onShimDetached: vi.fn().mockReturnValue(() => {}),
    shutdownShim: vi.fn().mockResolvedValue(undefined),
    waitForShimClient: vi.fn().mockResolvedValue(undefined),
    disposeRuntime: vi.fn(),
    registerKeyboardHandler: vi.fn(),
    routeKeyboardEvent: vi.fn().mockReturnValue(false),
    routeKeyboardEventSync: vi.fn().mockReturnValue(false),
    getActiveOverlay: vi.fn().mockReturnValue(null),
    hasKeyboardHandler: vi.fn().mockReturnValue(false),
  };
});

let createPtyLifecycleHandlers: typeof import('../../../src/contexts/terminal/pty-lifecycle').createPtyLifecycleHandlers;
let createPtySession: ReturnType<typeof import('../../../src/effect/bridge').createPtySession>;
let subscribeToPtyExit: ReturnType<
  typeof import('../../../src/hooks/usePtySubscription').subscribeToPtyExit
>;
let subscribeToPtyWithCaches: ReturnType<
  typeof import('../../../src/hooks/usePtySubscription').subscribeToPtyWithCaches
>;

async function flushTimers() {
  vi.runAllTimers();
  await Promise.resolve();
}

describe('aggregateSessionMappings synchronous update in pty-lifecycle', () => {
  beforeAll(async () => {
    ({ createPtyLifecycleHandlers } = await import('../../../src/contexts/terminal/pty-lifecycle'));
    ({ createPtySession } = await import('../../../src/effect/bridge'));
    ({ subscribeToPtyExit, subscribeToPtyWithCaches } =
      await import('../../../src/hooks/usePtySubscription'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    aggregateSessionMappings.clear();
    setActiveSessionIdForShim(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createHarness = () => {
    const ptyToPaneMap = new Map<string, string>();
    const sessionPtyMap = new Map<string, Map<string, string>>();
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();
    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById: vi.fn(),
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(() => `pane-${Date.now()}`),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    return { handlers, ptyToPaneMap, sessionPtyMap, ptyToSessionMap, ptyCaches, unsubscribeFns };
  };

  describe('createPTY', () => {
    test('writes to aggregateSessionMappings synchronously before lifecycle events fire', async () => {
      setActiveSessionIdForShim('session-B');

      (createPtySession as any).mockResolvedValue('pty-new');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      expect(getAggregateSessionForPty('pty-new')).toBeNull();

      const ptyId = await handlers.createPTY('pane-B1', 80, 24);
      expect(ptyId).toBe('pty-new');

      // IMMEDIATELY after createPTY resolves, aggregateSessionMappings is populated
      const ownership = getAggregateSessionForPty('pty-new');
      expect(ownership).not.toBeNull();
      expect(ownership!.sessionId).toBe('session-B');
      expect(ownership!.paneId).toBe('pane-B1');
    });

    test('does not corrupt existing mappings for other sessions when creating a new PTY', async () => {
      aggregateSessionMappings.set(
        'session-A',
        new Map([
          ['pane-A1', 'pty-A1'],
          ['pane-A2', 'pty-A2'],
        ])
      );

      setActiveSessionIdForShim('session-B');

      (createPtySession as any).mockResolvedValue('pty-B1');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      const ptyId = await handlers.createPTY('pane-B1', 80, 24);
      expect(ptyId).toBe('pty-B1');

      const sessionAMapping = aggregateSessionMappings.get('session-A');
      expect(sessionAMapping).toBeDefined();
      expect(sessionAMapping!.get('pane-A1')).toBe('pty-A1');
      expect(sessionAMapping!.get('pane-A2')).toBe('pty-A2');

      const sessionBMapping = aggregateSessionMappings.get('session-B');
      expect(sessionBMapping).toBeDefined();
      expect(sessionBMapping!.get('pane-B1')).toBe('pty-B1');
    });

    test('does not write to aggregateSessionMappings when no active session is set', async () => {
      setActiveSessionIdForShim(null);

      (createPtySession as any).mockResolvedValue('pty-orphan');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      const ptyId = await handlers.createPTY('pane-orphan', 80, 24);
      expect(ptyId).toBe('pty-orphan');

      expect(getAggregateSessionForPty('pty-orphan')).toBeNull();
    });
  });

  describe('createPaneWithPTY', () => {
    test('writes to aggregateSessionMappings synchronously before lifecycle events fire', async () => {
      setActiveSessionIdForShim('session-C');

      (createPtySession as any).mockResolvedValue('pty-C1');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      const result = await handlers.createPaneWithPTY('/tmp', 'test-title');
      expect(result).not.toBeNull();
      expect(result!.ptyId).toBe('pty-C1');

      const ownership = getAggregateSessionForPty('pty-C1');
      expect(ownership).not.toBeNull();
      expect(ownership!.sessionId).toBe('session-C');
    });
  });

  describe('session bleed prevention', () => {
    test('prevents PTY from being attributed to the wrong session during rapid switches', async () => {
      setActiveSessionIdForShim('session-A');
      aggregateSessionMappings.set('session-A', new Map([['pane-A1', 'pty-A1']]));

      // Session switch: new session becomes active
      setActiveSessionIdForShim('session-B');

      (createPtySession as any).mockResolvedValue('pty-B-new');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      const ptyId = await handlers.createPTY('pane-B-new', 80, 24);
      expect(ptyId).toBe('pty-B-new');

      const ownership = getAggregateSessionForPty('pty-B-new');
      expect(ownership).not.toBeNull();
      expect(ownership!.sessionId).toBe('session-B');
      expect(ownership!.paneId).toBe('pane-B-new');

      const sessionAOwnership = getAggregateSessionForPty('pty-A1');
      expect(sessionAOwnership).toEqual({
        sessionId: 'session-A',
        paneId: 'pane-A1',
      });
    });

    test('allows resolveAggregatePtyOwnership to find the correct session via aggregateOwner', async () => {
      setActiveSessionIdForShim('session-D');

      (createPtySession as any).mockResolvedValue('pty-D1');
      (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
      (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

      const { handlers } = createHarness();

      const ptyId = await handlers.createPTY('pane-D1', 80, 24);

      const aggregateOwner = getAggregateSessionForPty(ptyId);
      expect(aggregateOwner).toEqual({
        sessionId: 'session-D',
        paneId: 'pane-D1',
      });
    });
  });
});
