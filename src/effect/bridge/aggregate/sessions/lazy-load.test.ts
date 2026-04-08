import { afterEach, describe, expect, it, mock } from 'bun:test';
import { ServicesNotInitializedError } from '../../../errors';
import { aggregateSessionMappings, sessionPtyCache } from '../cache/session-pty-cache';

describe('loadSessionPtysOnDemand (litmus)', () => {
  afterEach(() => {
    aggregateSessionMappings.clear();
    sessionPtyCache.clear();
    mock.restore();
  });

  it('should return error when services not initialized', async () => {
    mock.module('../../services-instance', () => ({
      hasServices: () => false,
      getPtyService: () => {
        throw new Error('getPtyService should not be called when services are missing');
      },
      getSessionManager: () => {
        throw new Error('getSessionManager should not be called when services are missing');
      },
    }));

    const { loadSessionPtysOnDemand } = await import('./lazy-load.ts?litmus-services-missing');
    const result = await loadSessionPtysOnDemand('session-1');

    expect(result).toBeInstanceOf(ServicesNotInitializedError);
  });

  it('should not create PTYs when aggregate view only peeks an unloaded session', async () => {
    const createSpy = mock(async () => 'pty-created');

    mock.module('../../services-instance', () => ({
      hasServices: () => true,
      getPtyService: () => ({ create: createSpy }),
      getSessionManager: () => ({
        loadSession: async () => ({
          id: 'session-1',
          name: 'Session 1',
          activeWorkspaceId: 1,
          workspaces: [
            {
              id: 1,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-1',
              mainPane: { id: 'pane-1', cwd: '/tmp', title: 'shell' },
              stackPanes: [],
              activeStackIndex: 0,
            },
          ],
          cwdMap: new Map([['pane-1', '/tmp']]),
          paneToPtyMap: new Map(),
        }),
      }),
    }));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => undefined,
      registerPtyPane: async () => {},
    }));

    mock.module('../metadata/fetch', () => ({
      batchFetchPtyMetadata: async function* () {},
    }));

    const { loadSessionPtysOnDemand } = await import('./lazy-load.ts?litmus-no-create-if-missing');
    const result = await loadSessionPtysOnDemand('session-1', { createIfMissing: false });

    expect(result instanceof Error).toBe(false);
    if (result instanceof Error) return;

    expect(result.ptys).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('should create PTYs by default when materializing an unloaded session', async () => {
    const createSpy = mock(async () => 'pty-created');
    const registerSpy = mock(async () => {});

    mock.module('../../services-instance', () => ({
      hasServices: () => true,
      getPtyService: () => ({ create: createSpy }),
      getSessionManager: () => ({
        loadSession: async () => ({
          id: 'session-1',
          name: 'Session 1',
          activeWorkspaceId: 1,
          workspaces: [
            {
              id: 1,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-1',
              mainPane: { id: 'pane-1', cwd: '/tmp', title: 'shell' },
              stackPanes: [],
              activeStackIndex: 0,
            },
          ],
          cwdMap: new Map([['pane-1', '/tmp']]),
          paneToPtyMap: new Map(),
        }),
      }),
    }));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => undefined,
      registerPtyPane: registerSpy,
    }));

    mock.module('../metadata/fetch', () => ({
      batchFetchPtyMetadata: async function* (_pty: unknown, ids: Iterable<string>) {
        for (const id of ids) {
          yield {
            ptyId: String(id),
            cwd: '/tmp',
            foregroundProcess: 'bash',
            shell: '/bin/bash',
            title: 'shell',
            workspaceId: 1,
            paneId: undefined,
            gitBranch: undefined,
            gitDiffStats: undefined,
            gitDirty: false,
            gitStaged: 0,
            gitUnstaged: 0,
            gitUntracked: 0,
            gitConflicted: 0,
            gitAhead: undefined,
            gitBehind: undefined,
            gitStashCount: undefined,
            gitState: undefined,
            gitDetached: false,
            gitRepoKey: undefined,
            gitIsWorktree: false,
            gitCommonDir: null,
          };
        }
      },
    }));

    const { loadSessionPtysOnDemand } = await import('./lazy-load.ts?litmus-create-if-missing');
    const result = await loadSessionPtysOnDemand('session-1');

    expect(result instanceof Error).toBe(false);
    if (result instanceof Error) return;

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(result.ptys).toHaveLength(1);
    expect(result.ptys[0]?.ptyId).toBe('pty-created');
  });

  it('should create PTYs for all workspaces, not just the active workspace', async () => {
    const createSpy = mock(async () => 'pty-created');
    const registerSpy = mock(async () => {});

    mock.module('../../services-instance', () => ({
      hasServices: () => true,
      getPtyService: () => ({ create: createSpy }),
      getSessionManager: () => ({
        loadSession: async () => ({
          id: 'session-1',
          name: 'Session 1',
          activeWorkspaceId: 1, // Workspace 1 is active
          workspaces: [
            {
              id: 1,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-1',
              mainPane: { id: 'pane-1', cwd: '/workspace1', title: 'shell1' },
              stackPanes: [],
              activeStackIndex: 0,
            },
            {
              id: 2,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-2',
              mainPane: { id: 'pane-2', cwd: '/workspace2', title: 'shell2' },
              stackPanes: [{ id: 'pane-3', cwd: '/workspace2/stack', title: 'shell3' }],
              activeStackIndex: 0,
            },
            {
              id: 3,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-4',
              mainPane: { id: 'pane-4', cwd: '/workspace3', title: 'shell4' },
              stackPanes: [],
              activeStackIndex: 0,
            },
          ],
          cwdMap: new Map([
            ['pane-1', '/workspace1'],
            ['pane-2', '/workspace2'],
            ['pane-3', '/workspace2/stack'],
            ['pane-4', '/workspace3'],
          ]),
          paneToPtyMap: new Map(),
        }),
      }),
    }));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => undefined,
      registerPtyPane: registerSpy,
    }));

    mock.module('../metadata/fetch', () => ({
      batchFetchPtyMetadata: async function* (_pty: unknown, ids: Iterable<string>) {
        for (const id of ids) {
          yield {
            ptyId: String(id),
            cwd: '/any',
            foregroundProcess: 'bash',
            shell: '/bin/bash',
            title: 'shell',
            workspaceId: 1,
            paneId: undefined,
            gitBranch: undefined,
            gitDiffStats: undefined,
            gitDirty: false,
            gitStaged: 0,
            gitUnstaged: 0,
            gitUntracked: 0,
            gitConflicted: 0,
            gitAhead: undefined,
            gitBehind: undefined,
            gitStashCount: undefined,
            gitState: undefined,
            gitDetached: false,
            gitRepoKey: undefined,
            gitIsWorktree: false,
            gitCommonDir: null,
          };
        }
      },
    }));

    const { loadSessionPtysOnDemand } = await import('./lazy-load.ts?litmus-all-workspaces');
    const result = await loadSessionPtysOnDemand('session-1');

    expect(result instanceof Error).toBe(false);
    if (result instanceof Error) return;

    // Should create PTYs for all 4 panes across all 3 workspaces, not just workspace 1
    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(registerSpy).toHaveBeenCalledTimes(4);
    expect(result.ptys).toHaveLength(4);

    // Verify PTYs were created for non-active workspaces too
    const calls = createSpy.mock.calls;
    const cwdArgs = calls.map((call) => call[0]?.cwd);
    expect(cwdArgs).toContain('/workspace2'); // Workspace 2 main pane
    expect(cwdArgs).toContain('/workspace2/stack'); // Workspace 2 stack pane
    expect(cwdArgs).toContain('/workspace3'); // Workspace 3 main pane
  });

  it('should repair saved trailing-percent cwd values before creating PTYs', async () => {
    const createSpy = mock(async () => 'pty-created');

    mock.module('../../services-instance', () => ({
      hasServices: () => true,
      getPtyService: () => ({ create: createSpy }),
      getSessionManager: () => ({
        loadSession: async () => ({
          id: 'session-1',
          name: 'Session 1',
          activeWorkspaceId: 1,
          workspaces: [
            {
              id: 1,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-1',
              mainPane: { id: 'pane-1', cwd: '/tmp%', title: 'shell1' },
              stackPanes: [],
              activeStackIndex: 0,
            },
          ],
          cwdMap: new Map([['pane-1', '/tmp%']]),
          paneToPtyMap: new Map(),
        }),
      }),
    }));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => undefined,
      registerPtyPane: async () => {},
    }));

    mock.module('../metadata/fetch', () => ({
      batchFetchPtyMetadata: async function* (_pty: unknown, ids: Iterable<string>) {
        for (const id of ids) {
          yield {
            ptyId: String(id),
            cwd: '/tmp',
            foregroundProcess: 'bash',
            shell: '/bin/bash',
            title: 'shell',
            workspaceId: 1,
            paneId: undefined,
            gitBranch: undefined,
            gitDiffStats: undefined,
            gitDirty: false,
            gitStaged: 0,
            gitUnstaged: 0,
            gitUntracked: 0,
            gitConflicted: 0,
            gitAhead: undefined,
            gitBehind: undefined,
            gitStashCount: undefined,
            gitState: undefined,
            gitDetached: false,
            gitRepoKey: undefined,
            gitIsWorktree: false,
            gitCommonDir: null,
          };
        }
      },
    }));

    const { loadSessionPtysOnDemand } =
      await import('./lazy-load.ts?litmus-repair-trailing-percent-cwd');
    const result = await loadSessionPtysOnDemand('session-1');

    expect(result instanceof Error).toBe(false);
    if (result instanceof Error) return;

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]?.cwd).toBe('/tmp');
    expect(result.ptys).toHaveLength(1);
  });

  it('should keep shim mappings authoritative over stale aggregate-local mappings', async () => {
    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'pty-stale']]));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => ({
        mapping: new Map([['pane-1', 'pty-live']]),
        stalePaneIds: [],
      }),
      registerPtyPane: async () => {},
    }));

    const { getAggregateSessionPtyMapping } = await import('./lazy-load.ts?litmus-shim-authority');
    const result = await getAggregateSessionPtyMapping('session-1');

    expect(result?.mapping.get('pane-1')).toBe('pty-live');
    expect(aggregateSessionMappings.has('session-1')).toBe(false);
  });

  it('should prune stale aggregate-local mappings reported by the shim', async () => {
    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'pty-dead']]));

    mock.module('../../shim-bridge', () => ({
      getSessionPtyMapping: async () => ({
        mapping: new Map<string, string>(),
        stalePaneIds: ['pane-1'],
      }),
      registerPtyPane: async () => {},
    }));

    const { getAggregateSessionPtyMapping } =
      await import('./lazy-load.ts?litmus-prune-stale-local');
    const result = await getAggregateSessionPtyMapping('session-1');

    expect(result?.mapping.size).toBe(0);
    expect(aggregateSessionMappings.has('session-1')).toBe(false);
  });
});
