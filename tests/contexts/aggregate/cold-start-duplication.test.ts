/**
 * Integration test for the cold-start duplication bug.
 *
 * Bug: When applySnapshot replaces a placeholder (real ptyId) with a snapshot
 * entry (saved: ptyId) for the same pane, the placeholder is removed from
 * allPtys/allPtysIndex but NOT from pendingPtyIds. When hydratePlaceholderRow
 * later completes its await, it finds the ptyId in pendingPtyIds but not in
 * allPtysIndex, and pushes a DUPLICATE entry.
 *
 * This test simulates the exact sequence that causes the bug:
 * 1. insertPlaceholderRow creates a placeholder with a real ptyId
 * 2. applySnapshot replaces it with a saved: entry for the same pane
 * 3. hydratePlaceholderRow completes and should NOT push a duplicate
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';

import type { PtyInfo, AggregateViewState } from '../../../src/contexts/aggregate-view-types';
import {
  dedupeAggregatePtysByPane,
  getAggregatePaneKey,
  getSavedAggregatePtyId,
} from '../../../src/contexts/aggregate/rows';

// ─── Scenario: applySnapshot replaces placeholder, hydratePlaceholderRow
//      should not push duplicate ───

describe('cold-start duplication: applySnapshot + hydratePlaceholderRow race', () => {
  test('pendingPtyIds cleanup prevents hydratePlaceholderRow duplicate', () => {
    // Simulate the state after insertPlaceholderRow + applySnapshot:
    // - allPtys has a saved: entry (from snapshot)
    // - pendingPtyIds has the real ptyId (not cleaned up)
    // - allPtysIndex has the saved: ptyId, NOT the real ptyId

    const realPtyId = 'pty-123';
    const savedPtyId = getSavedAggregatePtyId('session-A', 'pane-1');

    const savedEntry: PtyInfo = {
      ptyId: savedPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
      gitBranch: 'main',
      gitDiffStats: undefined,
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 0,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 3,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/home',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    // Build allPtysIndex from the saved entry
    const allPtys = [savedEntry];
    const allPtysIndex = new Map<string, number>();
    allPtysIndex.set(savedPtyId, 0);

    // pendingPtyIds still has the real ptyId (BUG: not cleaned up)
    const pendingPtyIds = new Set<string>([realPtyId]);

    // BEFORE FIX: hydratePlaceholderRow would find ptyId in pendingPtyIds
    // but NOT in allPtysIndex → would push a duplicate
    const isInPending = pendingPtyIds.has(realPtyId);
    const isInIndex = allPtysIndex.has(realPtyId);
    expect(isInPending).toBe(true);
    expect(isInIndex).toBe(false);

    // AFTER FIX: applySnapshot cleans up pendingPtyIds
    for (const ptyId of pendingPtyIds) {
      if (!allPtysIndex.has(ptyId)) {
        pendingPtyIds.delete(ptyId);
      }
    }

    // Now hydratePlaceholderRow would find ptyId NOT in pendingPtyIds
    // → enters "no longer pending" branch → returns early → no duplicate
    expect(pendingPtyIds.has(realPtyId)).toBe(false);
  });

  test('dedupeAggregatePtysByPane merges real ptyId with saved: entry for same pane', () => {
    const realPtyId = 'pty-123';
    const savedPtyId = getSavedAggregatePtyId('session-A', 'pane-1');

    const savedEntry: PtyInfo = {
      ptyId: savedPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
      gitBranch: 'main',
      gitDiffStats: undefined,
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 0,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 3,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/home',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    const liveEntry: PtyInfo = {
      ptyId: realPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '/home/project',
      foregroundProcess: 'vim',
      shell: 'zsh',
      title: 'vim',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
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
    };

    // When both entries are passed to dedupeAggregatePtysByPane,
    // they should be merged into one entry (same pane key)
    const result = dedupeAggregatePtysByPane([savedEntry, liveEntry]);
    expect(result).toHaveLength(1);
    // Live entry should be preferred (real ptyId wins over saved:)
    expect(result[0].ptyId).toBe(realPtyId);
    // Git metadata should be preserved from saved entry
    expect(result[0].gitBranch).toBe('main');
    expect(result[0].gitDirty).toBe(true);
  });

  test('applySnapshot carriedOptimisticPtys pane-key check prevents carry', () => {
    // Simulates applySnapshot's carriedOptimisticPtys filter logic.
    // When the snapshot has a saved: entry for the same pane as an
    // optimistic entry, the optimistic entry should NOT be carried.

    const realPtyId = 'pty-123';
    const savedPtyId = getSavedAggregatePtyId('session-A', 'pane-1');

    const snapshotEntry: PtyInfo = {
      ptyId: savedPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
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
    };

    const optimisticEntry: PtyInfo = {
      ptyId: realPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
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
    };

    // Build the filter sets that applySnapshot uses
    const snapshotPtyIds = new Set([savedPtyId]);
    const snapshotPaneKeys = new Set<string>();
    const paneKey = getAggregatePaneKey(snapshotEntry.sessionId, snapshotEntry.paneId);
    if (paneKey) snapshotPaneKeys.add(paneKey);
    const pendingPtyIds = new Set([realPtyId]);

    // OLD behavior: only checked ptyId → optimistic would be carried
    const carriedOld = [optimisticEntry].filter(
      (pty) => !snapshotPtyIds.has(pty.ptyId) && pendingPtyIds.has(pty.ptyId)
    );
    expect(carriedOld).toHaveLength(1); // ← CARRIED → duplication when hydrated

    // NEW behavior: also checks pane key → NOT carried
    const carriedNew = [optimisticEntry].filter((pty) => {
      const pk = getAggregatePaneKey(pty.sessionId, pty.paneId);
      return (
        !snapshotPtyIds.has(pty.ptyId) &&
        !(pk && snapshotPaneKeys.has(pk)) &&
        pendingPtyIds.has(pty.ptyId)
      );
    });
    expect(carriedNew).toHaveLength(0); // ← NOT carried → no duplication
  });

  test('full cold-start sequence: placeholder → applySnapshot → hydrate', () => {
    // Simulates the complete cold-start sequence:
    // 1. insertPlaceholderRow creates a placeholder with real ptyId
    // 2. applySnapshot replaces it with saved: entry + cleans pendingPtyIds
    // 3. hydratePlaceholderRow should NOT push a duplicate

    const realPtyId = 'pty-123';
    const savedPtyId = getSavedAggregatePtyId('session-A', 'pane-1');

    // Step 1: insertPlaceholderRow creates a placeholder
    let allPtys: PtyInfo[] = [
      {
        ptyId: realPtyId,
        paneId: 'pane-1',
        sessionId: 'session-A',
        cwd: '',
        foregroundProcess: undefined,
        shell: 'shell',
        title: '...',
        workspaceId: 1,
        sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
        sortOrderHint: 0,
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
      },
    ];
    let allPtysIndex = new Map<string, number>([[realPtyId, 0]]);
    const pendingPtyIds = new Set<string>([realPtyId]);

    // Step 2: applySnapshot replaces the placeholder with saved: entry
    const snapshotPtys: PtyInfo[] = [
      {
        ptyId: savedPtyId,
        paneId: 'pane-1',
        sessionId: 'session-A',
        cwd: '/home',
        foregroundProcess: undefined,
        shell: 'shell',
        title: 'shell',
        workspaceId: 1,
        sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
        sortOrderHint: 0,
        gitBranch: 'main',
        gitDiffStats: undefined,
        gitDirty: true,
        gitStaged: 1,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: 3,
        gitBehind: 0,
        gitStashCount: 0,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: '/home',
        gitIsWorktree: false,
        gitCommonDir: null,
      },
    ];

    // dedupeAggregatePtysByPane merges by pane key → single entry
    allPtys = dedupeAggregatePtysByPane(snapshotPtys);
    allPtysIndex = new Map(allPtys.map((pty, i) => [pty.ptyId, i] as const));

    // THE FIX: Clean up pendingPtyIds for ptyIds no longer in allPtysIndex
    for (const ptyId of pendingPtyIds) {
      if (!allPtysIndex.has(ptyId)) {
        pendingPtyIds.delete(ptyId);
      }
    }

    // Verify: allPtys has only the saved: entry
    expect(allPtys).toHaveLength(1);
    expect(allPtys[0].ptyId).toBe(savedPtyId);
    expect(allPtysIndex.has(realPtyId)).toBe(false);

    // Verify: pendingPtyIds no longer has the real ptyId
    expect(pendingPtyIds.has(realPtyId)).toBe(false);

    // Step 3: hydratePlaceholderRow would check pendingPtyIds
    // → not found → returns early → NO DUPLICATE
    expect(pendingPtyIds.has(realPtyId)).toBe(false);
  });

  test('snapshot has saved: entry for pane → live ptyId lost from index → hydrate would push duplicate', () => {
    // This is the EXACT cold-start duplication path:
    // 1. insertPlaceholderRow creates entry with real ptyId → pendingPtyIds has it
    // 2. applySnapshot's snapshot has saved: entry for same pane but different ptyId
    // 3. carriedOptimisticPtys pane-key check prevents carrying the live entry
    // 4. dedupeAggregatePtysByPane produces [saved: entry] → allPtysIndex has saved: ID
    // 5. pendingPtyIds still has the real ptyId → hydratePlaceholderRow pushes DUPLICATE

    const realPtyId = 'pty-123';
    const savedPtyId = getSavedAggregatePtyId('session-A', 'pane-1');

    // Snapshot entry: saved: ptyId for pane-1
    const snapshotEntry: PtyInfo = {
      ptyId: savedPtyId,
      paneId: 'pane-1',
      sessionId: 'session-A',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-A', name: 'A', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: 0,
      gitBranch: 'main',
      gitDiffStats: undefined,
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 0,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 3,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/home',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    // Simulate applySnapshot's logic:
    // - optimisticById.get(savedPtyId) → no match (different ptyId)
    // - mergedSnapshotPtys: [snapshotEntry] (no merge)
    // - carriedOptimisticPtys: live entry NOT carried (pane key matches)
    // - dedupeAggregatePtysByPane produces [snapshotEntry]

    const allPtys = dedupeAggregatePtysByPane([snapshotEntry]);
    const allPtysIndex = new Map(allPtys.map((pty, i) => [pty.ptyId, i] as const));
    const pendingPtyIds = new Set<string>([realPtyId]); // NOT cleaned up yet!

    // BEFORE FIX: hydratePlaceholderRow would find ptyId in pendingPtyIds
    // but NOT in allPtysIndex → would push a DUPLICATE
    expect(pendingPtyIds.has(realPtyId)).toBe(true);
    expect(allPtysIndex.has(realPtyId)).toBe(false); // real ptyId NOT in index!
    expect(allPtysIndex.has(savedPtyId)).toBe(true); // saved: ptyId IS in index

    // The bug: without cleanup, hydratePlaceholderRow sees:
    //   pendingPtyIds.has('pty-123') → TRUE (still pending)
    //   allPtysIndex.get('pty-123') → undefined (not in index!)
    //   → PUSHES NEW ENTRY → DUPLICATE

    // AFTER FIX: applySnapshot cleans up pendingPtyIds
    for (const ptyId of pendingPtyIds) {
      if (!allPtysIndex.has(ptyId)) {
        pendingPtyIds.delete(ptyId);
      }
    }

    // Now hydratePlaceholderRow would:
    //   pendingPtyIds.has('pty-123') → FALSE → returns early → NO DUPLICATE
    expect(pendingPtyIds.has(realPtyId)).toBe(false);
  });

  test('recentlyAddedPtyIds cleanup also prevents stale references', () => {
    const realPtyId = 'pty-456';
    const savedPtyId = getSavedAggregatePtyId('session-B', 'pane-2');

    const allPtys: PtyInfo[] = [
      {
        ptyId: savedPtyId,
        paneId: 'pane-2',
        sessionId: 'session-B',
        cwd: '/work',
        foregroundProcess: undefined,
        shell: 'bash',
        title: 'bash',
        workspaceId: 1,
        sessionMetadata: { id: 'session-B', name: 'B', autoNamed: false, lastSwitchedAt: 0 },
        sortOrderHint: 0,
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
      },
    ];

    const allPtysIndex = new Map<string, number>([[savedPtyId, 0]]);
    const recentlyAddedPtyIds = new Set<string>([realPtyId]);

    // Before cleanup: recentlyAddedPtyIds has a stale reference
    expect(recentlyAddedPtyIds.has(realPtyId)).toBe(true);
    expect(allPtysIndex.has(realPtyId)).toBe(false);

    // After cleanup
    for (const ptyId of recentlyAddedPtyIds) {
      if (!allPtysIndex.has(ptyId)) {
        recentlyAddedPtyIds.delete(ptyId);
      }
    }

    expect(recentlyAddedPtyIds.has(realPtyId)).toBe(false);
  });
});
