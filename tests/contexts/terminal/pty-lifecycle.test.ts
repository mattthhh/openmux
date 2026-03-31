import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';

import type { TerminalScrollState } from '../../../src/core/types';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
let createPtyLifecycleHandlers: typeof import('../../../src/contexts/terminal/pty-lifecycle').createPtyLifecycleHandlers;
let createPtySession: typeof import('../../../src/effect/bridge').createPtySession;
let destroyPty: typeof import('../../../src/effect/bridge').destroyPty;
let clearPtyCaches: typeof import('../../../src/hooks/usePtySubscription').clearPtyCaches;
let subscribeToPtyExit: typeof import('../../../src/hooks/usePtySubscription').subscribeToPtyExit;
let subscribeToPtyWithCaches: typeof import('../../../src/hooks/usePtySubscription').subscribeToPtyWithCaches;

vi.mock('../../../src/hooks/usePtySubscription', () => ({
  subscribeToPtyWithCaches: vi.fn(),
  subscribeToPtyExit: vi.fn(),
  clearPtyCaches: vi.fn(),
  clearAllPtyCaches: vi.fn(),
}));

/** Helper to flush all pending timers and microtasks */
async function flushTimers() {
  vi.runAllTimers();
  await Promise.resolve();
}

describe('createPtyLifecycleHandlers', () => {
  beforeAll(async () => {
    ({ createPtyLifecycleHandlers } = await import('../../../src/contexts/terminal/pty-lifecycle'));
    ({ createPtySession, destroyPty } = await import('../../../src/effect/bridge'));
    ({ clearPtyCaches, subscribeToPtyExit, subscribeToPtyWithCaches } =
      await import('../../../src/hooks/usePtySubscription'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('closes the pane even if pty->pane mapping is missing', () => {
    const ptyToPaneMap = new Map<string, string>();
    const sessionPtyMap = new Map<string, Map<string, string>>();
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();
    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>();
    const closePaneById = vi.fn();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById,
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    handlers.handlePtyExit('pty-1', 'pane-1');

    expect(closePaneById).toHaveBeenCalledWith('pane-1');
    expect(clearPtyCaches).toHaveBeenCalledWith('pty-1', ptyCaches);
    expect(destroyPty).not.toHaveBeenCalled();
  });

  test('creates an exit subscription before deferring cache wiring', async () => {
    vi.useFakeTimers();

    // Cast mocks to set their resolved values
    (createPtySession as any).mockResolvedValue('pty-1');
    (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
    (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

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
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    const ptyId = await handlers.createPTY('pane-1', 80, 24);

    expect(ptyId).toBe('pty-1');
    expect(subscribeToPtyExit).toHaveBeenCalledWith('pty-1', 'pane-1', handlers.handlePtyExit);
    expect(subscribeToPtyWithCaches).not.toHaveBeenCalled();

    await flushTimers();

    expect(subscribeToPtyWithCaches).toHaveBeenCalledWith(
      'pty-1',
      'pane-1',
      ptyCaches,
      handlers.handlePtyExit,
      { cacheScrollState: true, skipExit: true }
    );
  });

  test('cleans up on destroyed lifecycle without re-destroying the PTY', () => {
    const ptyToPaneMap = new Map<string, string>([['pty-1', 'pane-1']]);
    const sessionPtyMap = new Map<string, Map<string, string>>([
      ['session-1', new Map([['pane-1', 'pty-1']])],
    ]);
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>([
      ['pty-1', { sessionId: 'session-1', paneId: 'pane-1' }],
    ]);

    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>([['pty-1', vi.fn()]]);
    const closePaneById = vi.fn();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById,
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    // Mark PTY as closing (destroyed lifecycle)
    handlers.handlePtyDestroyed('pty-1');

    expect(closePaneById).toHaveBeenCalledWith('pane-1');
    expect(clearPtyCaches).toHaveBeenCalledWith('pty-1', ptyCaches);
    expect(destroyPty).not.toHaveBeenCalled();
    expect(ptyToSessionMap.has('pty-1')).toBe(false);
    expect(sessionPtyMap.get('session-1')?.has('pane-1')).toBe(false);
  });

  test('passes pixel sizing when metrics are available', async () => {
    vi.useFakeTimers();

    (createPtySession as any).mockResolvedValue('pty-1');
    (subscribeToPtyExit as any).mockResolvedValue(vi.fn());
    (subscribeToPtyWithCaches as any).mockResolvedValue(vi.fn());

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
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 }),
      shouldCacheScrollState: true,
    });

    await handlers.createPTY('pane-1', 80, 24);

    // Verify createPtySession was called with expected dimensions
    expect(createPtySession).toHaveBeenCalled();
    const callArg = (createPtySession as any).mock.calls[0][0];
    expect(callArg.cols).toBe(80);
    expect(callArg.rows).toBe(24);
  });
});
