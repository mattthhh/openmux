import { describe, expect, it, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

import { createAggregateViewActions } from '../../src/contexts/aggregate-view-actions';
import { initialState, type AggregateViewState } from '../../src/contexts/aggregate-view-types';

describe('createAggregateViewActions loadSessionPtys', () => {
  it('does not materialize unloaded sessions by creating background PTYs', async () => {
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      allSessions: new Map([
        [
          'session-1',
          {
            id: 'session-1',
            name: 'Session 1',
            createdAt: 1,
            lastSwitchedAt: 1,
            autoNamed: false,
          },
        ],
      ]),
      sessionLoadStates: new Map([
        [
          'session-1',
          {
            status: 'unloaded',
            paneCount: 3,
          },
        ],
      ]),
    });

    const loadSessionPtysOnDemand = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      ptys: [],
      lastActiveWorkspaceId: 1,
    });

    const actions = createAggregateViewActions({
      state,
      setState,
      refreshPtys: async () => {},
      loadSessionPtysOnDemand,
    });

    await actions.loadSessionPtys('session-1');

    expect(loadSessionPtysOnDemand).toHaveBeenCalledWith('session-1', {
      createIfMissing: false,
    });
  });
});
