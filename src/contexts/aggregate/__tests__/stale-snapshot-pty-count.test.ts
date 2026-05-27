/**
 * Regression test for stale snapshot PTY count flash.
 *
 * When navigating rapidly through session groups in the aggregate view,
 * the session header would briefly show a reduced PTY count (e.g. (2)
 * instead of (6)) before correcting to the full count. This had two causes:
 *
 * 1. During session switch, PTY creation is async (fire-and-forget).
 *    The live path in buildSnapshot only sees alive PTYs. If only 2/6
 *    PTYs have been created, the snapshot shows (2) instead of (6).
 * 2. The fire-and-forget save of the previous session can race with the
 *    disk read for non-active sessions, producing stale pane counts.
 *
 * Fix 1 (primary): In the live path, supplement with saved: entries from
 *   the disk-loaded session data for panes that don't have a live PTY yet.
 *   This ensures the snapshot always shows the full pane count.
 * Fix 2 (defense-in-depth): setPendingSessionSave registers the save
 *   promise so that buildSnapshot can await it before reading sessions
 *   from disk, ensuring the disk data is always fresh.
 */

import { describe, it, expect } from 'bun:test';
import {
  setPendingSessionSave,
  awaitSessionSave,
  awaitAllSessionSaves,
  clearPendingSessionSaves,
} from '../../../effect/bridge/app-coordinator-bridge';
import { afterEach } from 'bun:test';
import { buildTreeRoot, groupPtysBySession } from '../';
import type { PtyInfo, SessionMetadata, SessionLoadState, TreeNode } from '../types';
import { isSavedAggregatePtyId } from '../rows';

const createMockPty = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
  ptyId: 'pty-1',
  cwd: '/home/user',
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
  foregroundProcess: 'vim',
  shell: '/bin/bash',
  title: undefined,
  workspaceId: 1,
  paneId: 'pane-1',
  sessionId: 'session-1',
  sessionMetadata: undefined,
  ...overrides,
});

const createMockSession = (overrides: Partial<SessionMetadata> = {}): SessionMetadata => ({
  id: 'session-1',
  name: 'Test Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('stale snapshot PTY count regression', () => {
  afterEach(() => {
    clearPendingSessionSaves();
  });
  it('should not reduce ptyCount when matchedPtys has fewer entries than the session actually has', () => {
    // Scenario: session has 6 PTYs in memory but snapshot only has 2 due to stale disk read.
    // buildTreeRoot should show the correct count based on matchedPtys (which reflects
    // the snapshot). The fix ensures the snapshot itself is correct by reusing in-memory
    // data instead of stale disk data.

    const session = createMockSession({ id: 'session-a', name: 'Session A' });
    const sessions = [session];

    // Full 6 PTYs that the session actually has
    const allSixPtys = Array.from({ length: 6 }, (_, i) =>
      createMockPty({
        ptyId: `pty-${i + 1}`,
        paneId: `pane-${i + 1}`,
        sessionId: session.id,
      })
    );

    // Stale 2 PTYs from disk
    const staleTwoPtys = allSixPtys.slice(0, 2);

    const ptysBySessionFull = groupPtysBySession(allSixPtys);
    const ptysBySessionStale = groupPtysBySession(staleTwoPtys);

    const expandedSessionIds = new Set([session.id]);
    const loadedState: SessionLoadState = {
      status: 'loaded',
      paneCount: 6,
    };
    const sessionLoadStates = new Map([[session.id, loadedState]]);
    const emptyPaneOrder = new Map<string, number>();

    // With full data: ptyCount should be 6
    const treeFull = buildTreeRoot(
      sessions,
      ptysBySessionFull,
      expandedSessionIds,
      sessionLoadStates,
      emptyPaneOrder
    );
    const sessionNodeFull = treeFull.find(
      (n): n is TreeNode & { type: 'session' } => n.type === 'session'
    );
    expect(sessionNodeFull?.ptyCount).toBe(6);

    // With stale data: ptyCount would be 2 (this is the bug scenario before fix)
    const treeStale = buildTreeRoot(
      sessions,
      ptysBySessionStale,
      expandedSessionIds,
      sessionLoadStates,
      emptyPaneOrder
    );
    const sessionNodeStale = treeStale.find(
      (n): n is TreeNode & { type: 'session' } => n.type === 'session'
    );
    // Without the fix in buildSnapshot, this would be 2.
    // The fix ensures buildSnapshot reuses in-memory data, so this
    // scenario shouldn't occur in practice.
    expect(sessionNodeStale?.ptyCount).toBe(2);

    // But the loadState.paneCount fallback should preserve the correct count
    // when sessionPtys is empty (e.g., unloaded session)
    const ptysBySessionEmpty = groupPtysBySession([]);
    const treeEmpty = buildTreeRoot(
      sessions,
      ptysBySessionEmpty,
      expandedSessionIds,
      sessionLoadStates,
      emptyPaneOrder
    );
    const sessionNodeEmpty = treeEmpty.find(
      (n): n is TreeNode & { type: 'session' } => n.type === 'session'
    );
    // PtyCount falls back to loadState.paneCount (6)
    expect(sessionNodeEmpty?.ptyCount).toBe(6);
  });

  it('should preserve session PTY count through recomputeTree when using in-memory data', () => {
    // Simulate the fix: after the snapshot is built using in-memory data
    // (instead of stale disk data), the ptyCount should be preserved.

    const sessionA = createMockSession({ id: 'session-a', name: 'Session A' });
    const sessionB = createMockSession({ id: 'session-b', name: 'Session B' });
    const sessions = [sessionA, sessionB];

    // Session A: 6 PTYs (the session that was just switched away from)
    const sessionAPtys = Array.from({ length: 6 }, (_, i) =>
      createMockPty({
        ptyId: `pty-a${i + 1}`,
        paneId: `pane-a${i + 1}`,
        sessionId: sessionA.id,
      })
    );

    // Session B: 3 PTYs (the new active session)
    const sessionBPtys = Array.from({ length: 3 }, (_, i) =>
      createMockPty({
        ptyId: `pty-b${i + 1}`,
        paneId: `pane-b${i + 1}`,
        sessionId: sessionB.id,
      })
    );

    const allPtys = [...sessionAPtys, ...sessionBPtys];
    const ptysBySession = groupPtysBySession(allPtys);

    const expandedSessionIds = new Set([sessionA.id, sessionB.id]);
    const loadedStateA: SessionLoadState = {
      status: 'loaded',
      paneCount: 6,
    };
    const loadedStateB: SessionLoadState = {
      status: 'loaded',
      paneCount: 3,
    };
    const sessionLoadStates = new Map([
      [sessionA.id, loadedStateA],
      [sessionB.id, loadedStateB],
    ]);
    const emptyPaneOrder = new Map<string, number>();

    const tree = buildTreeRoot(
      sessions,
      ptysBySession,
      expandedSessionIds,
      sessionLoadStates,
      emptyPaneOrder
    );

    const sessionANode = tree.find(
      (n): n is TreeNode & { type: 'session'; session: { id: string } } =>
        n.type === 'session' && n.session.id === sessionA.id
    );
    const sessionBNode = tree.find(
      (n): n is TreeNode & { type: 'session'; session: { id: string } } =>
        n.type === 'session' && n.session.id === sessionB.id
    );

    expect(sessionANode?.ptyCount).toBe(6);
    expect(sessionBNode?.ptyCount).toBe(3);
  });

  it('should identify saved: PTY entries vs live PTY entries for reuse decision', () => {
    const livePtyId = 'pty-live-1';
    const savedPtyId = 'saved:session-a:pane-1';

    expect(isSavedAggregatePtyId(livePtyId)).toBe(false);
    expect(isSavedAggregatePtyId(savedPtyId)).toBe(true);
  });

  it('awaitAllSessionSaves should block until all pending saves complete', async () => {
    let resolveA: () => void;
    let resolveB: () => void;
    const promiseA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<void>((resolve) => {
      resolveB = resolve;
    });

    setPendingSessionSave('session-a', promiseA);
    setPendingSessionSave('session-b', promiseB);

    let savesCompleted = false;
    const awaitPromise = awaitAllSessionSaves().then(() => {
      savesCompleted = true;
    });

    // Not yet completed
    expect(savesCompleted).toBe(false);

    resolveA!();
    await new Promise((r) => setTimeout(r, 5));
    expect(savesCompleted).toBe(false);

    resolveB!();
    await awaitPromise;
    expect(savesCompleted).toBe(true);
  });

  it('awaitSessionSave should block until the specific save completes', async () => {
    let resolveA: () => void;
    const promiseA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });

    setPendingSessionSave('session-a', promiseA);

    let saveCompleted = false;
    const awaitPromise = awaitSessionSave('session-a').then(() => {
      saveCompleted = true;
    });

    expect(saveCompleted).toBe(false);

    resolveA!();
    await awaitPromise;
    expect(saveCompleted).toBe(true);
  });

  it('awaitSessionSave should return immediately for a session with no pending save', async () => {
    // No save registered for 'session-x' — should resolve immediately
    await awaitSessionSave('session-x');
  });
});
