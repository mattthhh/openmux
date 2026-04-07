import { describe, expect, it } from 'bun:test';

import type { FlattenedTreeItem, PtyInfo } from '../../../src/contexts/aggregate-view-types';
import {
  resolveAggregatePreviewPtyId,
  resolveAggregatePtyOwnership,
} from '../../../src/components/aggregate/utils';
import { createWorkspaceWithPanes } from '../../contexts/layout-reducer/fixtures';

const createPty = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
  ptyId: 'pty-1',
  sessionId: 'session-1',
  cwd: '/tmp',
  workspaceId: 1,
  paneId: 'pane-1',
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
  foregroundProcess: 'nvim',
  shell: 'zsh',
  title: 'nvim',
  sessionMetadata: undefined,
  ...overrides,
});

const createPtyRow = (pty: PtyInfo): FlattenedTreeItem => ({
  node: {
    type: 'pty',
    ptyInfo: pty,
    parentSessionId: pty.sessionId,
  },
  depth: 1,
  isLast: true,
  prefix: '',
  index: 0,
  parentSessionId: pty.sessionId,
});

describe('resolveAggregatePreviewPtyId', () => {
  it('returns the live PTY for a saved row in the active session', () => {
    const workspace = createWorkspaceWithPanes(1, { id: 'pane-1', ptyId: 'pty-live' }, []);
    const savedRow = createPty({
      ptyId: 'saved:session-1:pane-1',
      sessionId: 'session-1',
      paneId: 'pane-1',
    });

    expect(
      resolveAggregatePreviewPtyId({
        selectedPtyId: savedRow.ptyId,
        selectedIndex: 0,
        flattenedTree: [createPtyRow(savedRow)],
        activeSessionId: 'session-1',
        workspaces: { 1: workspace },
      })
    ).toBe('pty-live');
  });

  it('keeps a live selection unchanged', () => {
    const liveRow = createPty({ ptyId: 'pty-live' });

    expect(
      resolveAggregatePreviewPtyId({
        selectedPtyId: liveRow.ptyId,
        selectedIndex: 0,
        flattenedTree: [createPtyRow(liveRow)],
        activeSessionId: 'session-1',
        workspaces: {},
      })
    ).toBe('pty-live');
  });

  it('returns null for a saved row from a different session', () => {
    const workspace = createWorkspaceWithPanes(1, { id: 'pane-1', ptyId: 'pty-live' }, []);
    const savedRow = createPty({
      ptyId: 'saved:session-2:pane-1',
      sessionId: 'session-2',
      paneId: 'pane-1',
    });

    expect(
      resolveAggregatePreviewPtyId({
        selectedPtyId: savedRow.ptyId,
        selectedIndex: 0,
        flattenedTree: [createPtyRow(savedRow)],
        activeSessionId: 'session-1',
        workspaces: { 1: workspace },
      })
    ).toBeNull();
  });
});

describe('resolveAggregatePtyOwnership', () => {
  it('prefers tracked ownership and derives workspace from the current layout', () => {
    const workspace = createWorkspaceWithPanes(2, { id: 'pane-2', ptyId: 'pty-live' }, []);

    expect(
      resolveAggregatePtyOwnership({
        ptyId: 'pty-live',
        workspaces: { 2: workspace },
        activeSessionId: 'session-active',
        trackedOwner: { sessionId: 'session-tracked', paneId: 'pane-2' },
        aggregateOwner: { sessionId: 'session-aggregate', paneId: 'pane-9' },
      })
    ).toEqual({
      sessionId: 'session-tracked',
      paneId: 'pane-2',
      workspaceId: 2,
    });
  });

  it('falls back to aggregate-local ownership when the PTY is not tracked live', () => {
    expect(
      resolveAggregatePtyOwnership({
        ptyId: 'pty-live',
        workspaces: {},
        activeSessionId: 'session-active',
        trackedOwner: null,
        aggregateOwner: { sessionId: 'session-aggregate', paneId: 'pane-9' },
      })
    ).toEqual({
      sessionId: 'session-aggregate',
      paneId: 'pane-9',
      workspaceId: undefined,
    });
  });

  it('uses the active session plus live layout location as the final fallback', () => {
    const workspace = createWorkspaceWithPanes(3, { id: 'pane-3', ptyId: 'pty-layout' }, []);

    expect(
      resolveAggregatePtyOwnership({
        ptyId: 'pty-layout',
        workspaces: { 3: workspace },
        activeSessionId: 'session-active',
        trackedOwner: null,
        aggregateOwner: null,
      })
    ).toEqual({
      sessionId: 'session-active',
      paneId: 'pane-3',
      workspaceId: 3,
    });
  });
});
