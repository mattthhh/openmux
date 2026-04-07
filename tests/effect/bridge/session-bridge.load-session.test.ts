import { afterEach, describe, expect, it, mock } from 'bun:test';

describe('loadSessionData', () => {
  afterEach(() => {
    mock.restore();
  });

  it('repairs persisted cwd values with an accidental trailing percent', async () => {
    mock.module('../../../src/effect/bridge/services-instance', () => ({
      getSessionManager: () => ({
        loadSession: async () => ({
          metadata: {
            id: 'session-1',
            name: 'Session 1',
            createdAt: 1,
            lastSwitchedAt: 1,
            autoNamed: false,
          },
          activeWorkspaceId: 1,
          workspaces: [
            {
              id: 1,
              label: null,
              layoutMode: 'stacked',
              focusedPaneId: 'pane-1',
              activeStackIndex: 0,
              lastFocusedPaneIds: [],
              zoomed: false,
              mainPane: { id: 'pane-1', cwd: '/tmp%', title: 'shell' },
              stackPanes: [],
            },
          ],
        }),
      }),
    }));

    const { loadSessionData } =
      await import('../../../src/effect/bridge/session-bridge.ts?repair-trailing-percent-cwd');
    const result = await loadSessionData('session-1');

    expect(result instanceof Error).toBe(false);
    if (result instanceof Error) return;

    expect(result.cwdMap.get('pane-1')).toBe('/tmp');
    expect(result.workspaces[1]?.mainPane?.cwd).toBe('/tmp');
  });
});
