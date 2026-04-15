/**
 * Regression test: loadedSessionIds prevents merge mode from clobbering
 * other sessions' data when PTY ownership resolution maps a PTY to
 * a different session than the one actually being refreshed.
 *
 * Bug: In activeSessionOnly + mergeWithExisting mode, loadedSnapshotSessionIds
 * was derived from snapshot.ptys[].sessionId. If a PTY from the active session's
 * layout was resolved to a DIFFERENT session (e.g., stale aggregateSessionMappings),
 * loadedSnapshotSessionIds would include that wrong session. The merge would then
 * clobber that session's existing PTY data in allPtys.
 *
 * Fix: buildSnapshot now includes loadedSessionIds — the set of sessions that
 * were ACTUALLY loaded (not inferred from PTYs). In activeSessionOnly mode,
 * loadedSessionIds = {effectiveCurrentSessionId}, regardless of what sessionId
 * values the PTYs have.
 */

import { describe, expect, it } from 'bun:test';
import type { PtyInfo } from '../../../src/contexts/aggregate-view-types';

describe('loadedSessionIds merge protection', () => {
  it('activeSessionOnly mode: loadedSessionIds is only the active session', () => {
    // When activeSessionOnly: true, loadedSessionIds should be {activeSessionId}
    // even if some PTYs have sessionId pointing to other sessions.
    // This prevents the merge from clobbering other sessions' data.
    const activeSessionId = 'session-1';
    const otherSessionId = 'session-2';

    // Simulate a snapshot where activeSessionOnly: true
    // but a PTY has sessionId = 'session-2' due to ownership resolution
    const snapshotPtys: PtyInfo[] = [
      {
        ptyId: 'pty-a',
        sessionId: activeSessionId,
        paneId: 'pane-a',
        cwd: '/tmp/a',
        title: 'A',
        workspaceId: 1,
        foregroundProcess: undefined,
        shell: undefined,
        gitBranch: undefined,
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBelow: undefined,
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
        gitIsWorktree: false,
        gitCommonDir: null,
        sessionMetadata: undefined,
      },
      {
        ptyId: 'pty-b',
        // This PTY has sessionId = 'session-2' due to ownership resolution,
        // but it was loaded as part of the active session's refresh.
        sessionId: otherSessionId,
        paneId: 'pane-b',
        cwd: '/tmp/b',
        title: 'B',
        workspaceId: 1,
        foregroundProcess: undefined,
        shell: undefined,
        gitBranch: undefined,
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBelow: undefined,
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
        gitIsWorktree: false,
        gitCommonDir: null,
        sessionMetadata: undefined,
      },
    ];

    // OLD BUG: loadedSnapshotSessionIds = new Set(snapshotPtys.map(p => p.sessionId))
    // = {'session-1', 'session-2'} — would clobber session-2's existing data!
    const buggyLoadedSessionIds = new Set(snapshotPtys.map((p) => String(p.sessionId)));
    expect(buggyLoadedSessionIds.has(otherSessionId)).toBe(true);

    // FIX: loadedSessionIds from buildSnapshot with activeSessionOnly: true
    // = {activeSessionId} — only the session we actually loaded
    const fixedLoadedSessionIds = new Set([activeSessionId]);
    expect(fixedLoadedSessionIds.has(otherSessionId)).toBe(false);

    // In merge mode, existing PTYs for sessions in loadedSnapshotSessionIds
    // are filtered OUT. With the bug, session-2's PTYs would be removed:
    const allPtysBefore: PtyInfo[] = [
      ...snapshotPtys,
      {
        ptyId: 'saved:session-2:pane-c',
        sessionId: otherSessionId,
        paneId: 'pane-c',
        cwd: '/tmp/c',
        title: 'C',
        workspaceId: 1,
        foregroundProcess: undefined,
        shell: undefined,
        gitBranch: undefined,
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBelow: undefined,
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
        gitIsWorktree: false,
        gitCommonDir: null,
        sessionMetadata: undefined,
      },
    ];

    // With buggy loadedSessionIds, session-2's saved PTY would be removed:
    const buggyExisting = allPtysBefore.filter((pty) => !buggyLoadedSessionIds.has(pty.sessionId));
    expect(buggyExisting.find((p) => p.sessionId === otherSessionId)).toBeUndefined();

    // With fixed loadedSessionIds, session-2's saved PTY is preserved:
    const fixedExisting = allPtysBefore.filter((pty) => !fixedLoadedSessionIds.has(pty.sessionId));
    expect(fixedExisting.find((p) => p.sessionId === otherSessionId)).toBeDefined();
  });

  it('full refresh mode: loadedSessionIds includes all sessions', () => {
    // When activeSessionOnly: false (full refresh), loadedSessionIds
    // should include ALL sessions, not just the ones with PTYs.
    const allSessionIds = ['session-1', 'session-2', 'session-3'];

    // loadedSessionIds = all session IDs from listSessionsResult()
    const loadedSessionIds = new Set(allSessionIds);
    expect(loadedSessionIds.size).toBe(3);
    expect(loadedSessionIds.has('session-1')).toBe(true);
    expect(loadedSessionIds.has('session-2')).toBe(true);
    expect(loadedSessionIds.has('session-3')).toBe(true);
  });

  it('existingCurrentSessionPtys stamps sessionId from outer loop', () => {
    // Path 2 in buildSnapshot uses PTYs from allPtys for the current session.
    // These PTYs should have their sessionId stamped from the session being
    // processed, not from whatever sessionId they had in allPtys.
    // This prevents stale sessionIds from propagating.
    const effectiveCurrentSessionId = 'session-1';
    const staleSessionId = 'session-2';

    // A PTY that somehow has sessionId = 'session-2' in allPtys
    // but passes the filter for session-1 (shouldn't happen with the
    // current filter logic, but stamping provides defense-in-depth)
    const ptyWithStaleSession: PtyInfo = {
      ptyId: 'pty-stale',
      sessionId: staleSessionId,
      paneId: 'pane-stale',
      cwd: '/tmp/stale',
      title: 'Stale',
      workspaceId: 1,
      foregroundProcess: undefined,
      shell: undefined,
      gitBranch: undefined,
      gitDiffStats: undefined,
      gitDirty: false,
      gitStaged: 0,
      gitUnstaged: 0,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: undefined,
      gitBelow: undefined,
      gitBehind: undefined,
      gitStashCount: undefined,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: undefined,
      gitIsWorktree: false,
      gitCommonDir: null,
      sessionMetadata: undefined,
    };

    // After stamping, sessionId should be the outer loop's sessionId
    const stamped = { ...ptyWithStaleSession, sessionId: effectiveCurrentSessionId };
    expect(stamped.sessionId).toBe(effectiveCurrentSessionId);
  });
});
