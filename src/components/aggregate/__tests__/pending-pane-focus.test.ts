import { describe, expect, it } from 'bun:test';
import type { PtyInfo } from '../../../contexts/aggregate-view-types';
import {
  resolvePendingAggregatePaneFocus,
  type PendingAggregatePaneFocus,
} from '../pending-pane-focus';

const createPty = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
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
  gitIsWorktree: false,
  gitCommonDir: null,
  foregroundProcess: 'zsh',
  shell: '/bin/zsh',
  title: 'shell',
  workspaceId: 1,
  paneId: 'pane-1',
  sessionId: 'session-1',
  sessionMetadata: undefined,
  ...overrides,
});

const createPending = (
  overrides: Partial<PendingAggregatePaneFocus> = {}
): PendingAggregatePaneFocus => ({
  sessionId: 'session-1',
  paneId: 'pane-1',
  ...overrides,
});

describe('resolvePendingAggregatePaneFocus', () => {
  it('waits until the new pane appears in allPtys (not placeholders)', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending(),
      allPtys: [],
      flattenedTreeIndex: new Map(),
      expandedSessionIds: new Set(['session-1']),
      filterQuery: '',
    });

    expect(result).toEqual({ type: 'wait' });
  });

  it('waits when only a placeholder exists in matchedPtys but not in allPtys', () => {
    // Placeholders live in matchedPtys but NOT allPtys. We intentionally
    // search allPtys so the cursor doesn't jump to a '...' placeholder —
    // this naturally serializes rapid creations and prevents anchoring
    // a second creation off a transient placeholder.
    const placeholder: PtyInfo = {
      ...createPty({ ptyId: 'pty-new', paneId: 'pane-new', sessionId: 'session-1' }),
      title: '...',
      cwd: '',
    };

    const result = resolvePendingAggregatePaneFocus({
      pending: createPending({ paneId: 'pane-new' }),
      allPtys: [],
      flattenedTreeIndex: new Map([['pty-new', 5]]),
      expandedSessionIds: new Set(['session-1']),
      filterQuery: '',
    });

    expect(result).toEqual({ type: 'wait' });
  });

  it('clears the filter before focusing a hidden new pane', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending(),
      allPtys: [createPty()],
      flattenedTreeIndex: new Map(),
      expandedSessionIds: new Set(['session-1']),
      filterQuery: 'vim',
    });

    expect(result).toEqual({ type: 'clear-filter' });
  });

  it('expands the session before touching the filter', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending(),
      allPtys: [createPty()],
      flattenedTreeIndex: new Map(),
      expandedSessionIds: new Set(),
      filterQuery: 'vim',
    });

    expect(result).toEqual({ type: 'expand-session', sessionId: 'session-1' });
  });

  it('expands the session before selecting the new pane', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending(),
      allPtys: [createPty()],
      flattenedTreeIndex: new Map(),
      expandedSessionIds: new Set(),
      filterQuery: '',
    });

    expect(result).toEqual({ type: 'expand-session', sessionId: 'session-1' });
  });

  it('selects the matching PTY once it is in allPtys and visible', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending(),
      allPtys: [createPty()],
      flattenedTreeIndex: new Map([['pty-1', 3]]),
      expandedSessionIds: new Set(['session-1']),
      filterQuery: '',
    });

    expect(result).toEqual({ type: 'select-pty', ptyId: 'pty-1' });
  });

  it('matches by session and pane to avoid selecting the wrong PTY', () => {
    const result = resolvePendingAggregatePaneFocus({
      pending: createPending({ sessionId: 'session-2', paneId: 'pane-2' }),
      allPtys: [
        createPty({ ptyId: 'pty-1', sessionId: 'session-1', paneId: 'pane-2' }),
        createPty({ ptyId: 'pty-2', sessionId: 'session-2', paneId: 'pane-2' }),
      ],
      flattenedTreeIndex: new Map([['pty-2', 4]]),
      expandedSessionIds: new Set(['session-2']),
      filterQuery: '',
    });

    expect(result).toEqual({ type: 'select-pty', ptyId: 'pty-2' });
  });
});
