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
  gitIsWorktree: false,
  gitCommonDir: null,
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

  /**
   * Regression: PTYs bleeding into wrong session groups during rapid switching.
   *
   * When a new PTY is created during a session switch, the lifecycle event
   * (handlePtyCreated) can fire before ptyToSessionMap is updated. If
   * aggregateOwner is also null (because createPTY hadn't yet populated
   * aggregateSessionMappings), the PTY gets attributed to activeSessionId
   * — which may be the PREVIOUS session if the switch is in progress.
   *
   * The fix: createPTY/createPaneWithPTY now synchronously writes to
   * aggregateSessionMappings, so aggregateOwner is available immediately.
   */
  it('prefers aggregateOwner over the activeSessionId fallback to prevent session bleed', () => {
    // Simulate: PTY was just created for session-B, but trackedOwner is null
    // (ptyToSessionMap hasn't been updated yet due to microtask ordering).
    // activeSessionId is still session-A (old session during switch).
    // aggregateOwner correctly points to session-B because createPTY
    // synchronously wrote to aggregateSessionMappings.
    expect(
      resolveAggregatePtyOwnership({
        ptyId: 'pty-new-for-B',
        workspaces: {}, // Not in layout yet
        activeSessionId: 'session-A', // Old session!
        trackedOwner: null, // Not tracked yet
        aggregateOwner: { sessionId: 'session-B', paneId: 'pane-B1' }, // Correct!
      })
    ).toEqual({
      sessionId: 'session-B', // Correctly resolved to B, not A
      paneId: 'pane-B1',
      workspaceId: undefined,
    });
  });

  it('would misattribute PTY to wrong session without aggregateOwner (the bug)', () => {
    // This test documents the bug: WITHOUT aggregateOwner, the PTY
    // falls through to the activeSessionId + findPtyLocation path.
    // If the PTY happens to be in the current layout (e.g., during a
    // switch where layout is mid-update), it gets attributed to
    // the old session.
    const workspace = createWorkspaceWithPanes(1, { id: 'pane-B1', ptyId: 'pty-new-for-B' }, []);

    // activeSessionId is still session-A (old session during switch)
    const result = resolveAggregatePtyOwnership({
      ptyId: 'pty-new-for-B',
      workspaces: { 1: workspace },
      activeSessionId: 'session-A', // WRONG session
      trackedOwner: null,
      aggregateOwner: null, // Bug: no aggregate mapping!
    });

    // Without aggregateOwner, the PTY is attributed to session-A (wrong!)
    expect(result).toEqual({
      sessionId: 'session-A', // BUG: should be session-B
      paneId: 'pane-B1',
      workspaceId: 1,
    });
    // This demonstrates why the synchronous aggregateSessionMappings
    // update in createPTY is critical.
  });
});
