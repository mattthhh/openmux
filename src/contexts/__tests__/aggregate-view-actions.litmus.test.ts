import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createStore } from 'solid-js/store';
import { createAggregateViewActions } from '../aggregate-view-actions';
import { initialState, type AggregateViewState } from '../aggregate-view-types';

vi.mock('../../effect/bridge/aggregate-bridge', () => ({
  loadSessionPtysOnDemand: vi.fn(),
}));

import { loadSessionPtysOnDemand } from '../../effect/bridge/aggregate-bridge';

describe('aggregate-view-actions loadSessionPtys (litmus)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(loadSessionPtysOnDemand).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createActionHarness = () => {
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      allSessions: new Map([
        ['session-1', { id: 'session-1', name: 'Session 1' } as AggregateViewState['allSessions'] extends Map<string, infer T> ? T : never],
      ]),
      sessionLoadStates: new Map([
        ['session-1', { status: 'unloaded', paneCount: 2 }],
      ]),
    });

    const refreshPtys = vi.fn(async () => {});
    const actions = createAggregateViewActions({
      state,
      setState,
      refreshPtys,
    });

    return { state, actions, refreshPtys };
  };

  it('protects on-demand PTYs and queues a follow-up refresh', async () => {
    vi.mocked(loadSessionPtysOnDemand).mockResolvedValue({
      sessionId: 'session-1',
      lastActiveWorkspaceId: 1,
      ptys: [
        {
          ptyId: 'pty-1',
          cwd: '/tmp/openmux',
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
          foregroundProcess: 'bun',
          shell: 'zsh',
          title: 'shell',
          workspaceId: 1,
          paneId: 'pane-1',
        },
      ],
    } as Awaited<ReturnType<typeof loadSessionPtysOnDemand>>);

    const { state, actions, refreshPtys } = createActionHarness();

    await actions.loadSessionPtys('session-1');

    expect(state.sessionLoadStates.get('session-1')?.status).toBe('loaded');
    expect(state.recentlyAddedPtyIds.has('pty-1')).toBe(true);
    expect(refreshPtys).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(state.recentlyAddedPtyIds.has('pty-1')).toBe(false);
  });

  it('allows retry when an on-demand load finds no PTYs', async () => {
    vi.mocked(loadSessionPtysOnDemand).mockResolvedValue({
      sessionId: 'session-1',
      lastActiveWorkspaceId: 1,
      ptys: [],
    } as Awaited<ReturnType<typeof loadSessionPtysOnDemand>>);

    const { state, actions, refreshPtys } = createActionHarness();

    await actions.loadSessionPtys('session-1');

    expect(state.sessionLoadStates.get('session-1')?.status).toBe('unloaded');
    expect(state.loadAttemptedSessionIds.has('session-1')).toBe(false);
    expect(refreshPtys).not.toHaveBeenCalled();
  });
});
