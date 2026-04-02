import { afterEach, describe, expect, it, mock } from 'bun:test';
import { ServicesNotInitializedError } from '../../../errors';
import { aggregateSessionMappings } from '../cache/session-pty-cache';

describe('loadSessionPtysOnDemand (litmus)', () => {
  afterEach(() => {
    aggregateSessionMappings.clear();
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
