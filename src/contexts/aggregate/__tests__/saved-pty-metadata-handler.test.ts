/**
 * Tests for metadata change handler fallback to saved: PTY entries.
 *
 * When the suspended PTY cache misses (e.g., expired TTL), non-active session
 * PTYs in the aggregate view have synthetic 'saved:' ptyIds instead of real
 * ones. Metadata change events carry the real ptyId, so the primary lookup
 * fails. The handler falls back to the session-PTY mapping to find the
 * matching saved: entry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createMetadataChangeHandler } from '../subscriptions';
import type { AggregateViewState } from '../../aggregate-view-types';
import { createStore } from 'solid-js/store';
import { aggregateSessionMappings } from '../../../effect/bridge/aggregate/cache/session-pty-cache';

function makeSavedPty(
  overrides: Partial<{
    ptyId: string;
    sessionId: string;
    paneId: string;
    cwd: string;
    foregroundProcess: string | undefined;
    title: string | undefined;
  }> = {}
) {
  return {
    ptyId: overrides.ptyId ?? 'saved:session-1:pane-1',
    cwd: overrides.cwd ?? '/home/user/project',
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
    foregroundProcess: overrides.foregroundProcess ?? undefined,
    shell: '/bin/zsh',
    title: overrides.title ?? undefined,
    workspaceId: 1,
    paneId: overrides.paneId ?? 'pane-1',
    sessionId: overrides.sessionId ?? 'session-1',
    sessionMetadata: undefined,
  };
}

function makeState(ptys: ReturnType<typeof makeSavedPty>[]) {
  const allPtysIndex = new Map<string, number>();
  const matchedPtysIndex = new Map<string, number>();
  ptys.forEach((pty, i) => {
    allPtysIndex.set(pty.ptyId, i);
    matchedPtysIndex.set(pty.ptyId, i);
  });

  return createStore<AggregateViewState>({
    showAggregateView: false,
    showInactive: true,
    allPtys: ptys,
    matchedPtys: ptys,
    selectedIndex: 0,
    selectedPtyId: null,
    isLoading: false,
    previewMode: false,
    previewZoomed: false,
    allPtysIndex,
    matchedPtysIndex,
    treeRoot: [],
    flattenedTree: [],
    flattenedTreeIndex: new Map(),
    expandedSessionIds: new Set(),
    selectedSessionId: null,
    sessionLoadStates: new Map(),
    sessionPaneOrders: new Map(),
    sessionPaneOrderIndex: new Map(),
    manualSessionOrder: [],
    loadingSessionIds: new Set(),
    loadAttemptedSessionIds: new Set(),
    allSessions: new Map(),
    pendingPtyIds: new Set(),
    recentlyAddedPtyIds: new Set(),
    deletedPtyIds: new Set(),
    pendingPaneCreations: [],
    listScrollOffset: 0,
  });
}

describe('metadata handler saved: ptyId fallback', () => {
  beforeEach(() => {
    aggregateSessionMappings.clear();
  });

  afterEach(() => {
    aggregateSessionMappings.clear();
  });

  it('updates foregroundProcess via saved: ptyId fallback', () => {
    const pty = makeSavedPty();
    const [state, setState] = makeState([pty]);

    // Register the mapping so the handler can find it
    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'real-pty-123']]));

    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'real-pty-123', foregroundProcess: 'nvim' });

    expect(state.allPtys[0].foregroundProcess).toBe('nvim');
    expect(state.matchedPtys[0].foregroundProcess).toBe('nvim');
  });

  it('updates title via saved: ptyId fallback', () => {
    const pty = makeSavedPty({ title: 'old-title' });
    const [state, setState] = makeState([pty]);

    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'real-pty-456']]));

    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'real-pty-456', title: 'new-title' });

    expect(state.allPtys[0].title).toBe('new-title');
    expect(state.matchedPtys[0].title).toBe('new-title');
  });

  it('updates cwd via saved: ptyId fallback', () => {
    const pty = makeSavedPty({ cwd: '/old/path' });
    const [state, setState] = makeState([pty]);

    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'real-pty-789']]));

    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'real-pty-789', cwd: '/new/path' });

    expect(state.allPtys[0].cwd).toBe('/new/path');
    expect(state.matchedPtys[0].cwd).toBe('/new/path');
  });

  it('does not update when no mapping exists for real ptyId', () => {
    const pty = makeSavedPty({ foregroundProcess: 'bash' });
    const [state, setState] = makeState([pty]);

    // No mapping registered — fallback should not find anything
    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'real-pty-unknown', foregroundProcess: 'nvim' });

    // The saved: entry should be unchanged because the fallback
    // found no mapping for this ptyId
    expect(state.allPtys[0].foregroundProcess).toBe('bash');
  });

  it('prefers direct ptyId lookup over saved: fallback', () => {
    // If the same real ptyId exists directly in the index (suspended
    // cache hit), the primary lookup should succeed without fallback
    const pty = {
      ptyId: 'real-pty-direct',
      cwd: '/home',
      foregroundProcess: 'bash',
      shell: '/bin/zsh',
      title: 'direct-title',
    } as any;

    const [state, setState] = makeState([pty]);

    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'real-pty-direct']]));

    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'real-pty-direct', foregroundProcess: 'python' });

    expect(state.allPtys[0].foregroundProcess).toBe('python');
  });
});
