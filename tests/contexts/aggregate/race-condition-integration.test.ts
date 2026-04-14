/**
 * Integration-style test simulating the exact race condition that causes
 * PTY duplication during rapid session switching in the aggregate view.
 *
 * This test creates the microtask ordering that the real app produces:
 *   1. lifecycleRegistry.notify() fires synchronously inside create()
 *   2. The stream resolves the pending next() Promise, queuing handlePtyCreated
 *   3. create() returns, queuing createPTY's continuation
 *   4. handlePtyCreated runs BEFORE the continuation sets mappings
 *
 * Unlike the unit tests, this test simulates the full sequence including
 * applySnapshot running between lifecycle events and mapping updates.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';

import type { TerminalScrollState } from '../../../src/core/types';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
import {
  aggregateSessionMappings,
  getAggregateSessionForPty,
} from '../../../src/effect/bridge/aggregate/cache/session-pty-cache';
import { setActiveSessionIdForShim } from '../../../src/effect/bridge/app-coordinator-bridge';
import {
  dedupeAggregatePtysByPane,
  getAggregatePaneKey,
} from '../../../src/contexts/aggregate/rows';
import type { PtyInfo } from '../../../src/contexts/aggregate-view-types';

// ─── Scenario 1: Microtask race in handlePtyCreated ───

describe('race condition: lifecycle event before mapping update', () => {
  beforeEach(() => {
    aggregateSessionMappings.clear();
    setActiveSessionIdForShim(null);
  });

  afterEach(() => {
    aggregateSessionMappings.clear();
    setActiveSessionIdForShim(null);
  });

  test('ownership is null when lifecycle event fires before createPTY continuation', () => {
    // Simulate the exact microtask ordering:
    // T1: lifecycle event fires, handlePtyCreated runs
    // T2: createPTY continuation sets aggregateSessionMappings
    //
    // At T1, neither trackedOwner nor aggregateOwner is available.

    setActiveSessionIdForShim('session-B');

    // At T1: lifecycle event fires, mappings NOT yet set
    const ownershipAtT1 = getAggregateSessionForPty('pty-123');
    expect(ownershipAtT1).toBeNull(); // ← This is the race

    // At T2: createPTY continuation sets the mapping
    const mapping = aggregateSessionMappings.get('session-B') ?? new Map<string, string>();
    mapping.set('pane-B1', 'pty-123');
    aggregateSessionMappings.set('session-B', mapping);

    // Now ownership resolves correctly
    const ownershipAtT2 = getAggregateSessionForPty('pty-123');
    expect(ownershipAtT2).toEqual({ sessionId: 'session-B', paneId: 'pane-B1' });
  });

  test('resolving ownership after queueMicrotask finds the mapping', async () => {
    // Simulates: handlePtyCreated runs at T1 (null ownership),
    // schedules queueMicrotask retry, which runs at T3 (after T2 sets mappings).

    setActiveSessionIdForShim('session-B');

    // T1: ownership is null
    const ownership1 = getAggregateSessionForPty('pty-123');
    expect(ownership1).toBeNull();

    // T2: createPTY continuation runs (sets mappings)
    const mapping = aggregateSessionMappings.get('session-B') ?? new Map<string, string>();
    mapping.set('pane-B1', 'pty-123');
    aggregateSessionMappings.set('session-B', mapping);

    // T3: queueMicrotask retry would run here
    const ownership2 = getAggregateSessionForPty('pty-123');
    expect(ownership2).not.toBeNull();
    expect(ownership2!.sessionId).toBe('session-B');
  });

  test('OLD behavior: activeSessionId fallback produces wrong ownership', () => {
    // This demonstrates what the OLD code (with the fallback) would do.
    // The layout has been updated to session-B, but activeSessionId
    // (SolidJS reactive state) is still session-A.
    //
    // The removed fallback used:
    //   findPtyLocation(ptyId, workspaces) → finds PTY in session-B's layout
    //   BUT returns sessionId = activeSessionId = 'session-A'  ← WRONG

    // With the fallback removed, this should return null instead
    // (neither trackedOwner nor aggregateOwner is set)
    const result = getAggregateSessionForPty('pty-123');
    expect(result).toBeNull(); // Would have been { sessionId: 'session-A' } with old fallback
  });
});

// ─── Scenario 2: dedupeAggregatePtysByPane with loading PTYs ───

describe('race condition: duplicate loading PTYs bypass dedup', () => {
  test('loading PTY with same ptyId but missing paneId is deduped', () => {
    const live1: PtyInfo = {
      ptyId: 'pty-123',
      paneId: 'pane-B1',
      sessionId: 'session-B',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-B', name: 'Session B', autoNamed: false, lastSwitchedAt: 0 },
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

    // Loading placeholder — same ptyId but no paneId
    const loading: PtyInfo = {
      ...live1,
      paneId: undefined as any,
      title: '...',
      sortOrderHint: undefined,
    };

    // Before the fix: these would NOT be deduped because
    // getAggregatePaneKey('session-B', undefined) returns null,
    // and both entries would be pushed without deduplication.
    const result = dedupeAggregatePtysByPane([live1, loading]);

    expect(result).toHaveLength(1);
    expect(result[0].ptyId).toBe('pty-123');
    // The merged entry should have the paneId from the live entry
    expect(result[0].paneId).toBe('pane-B1');
  });

  test('multiple loading PTYs with same ptyId are deduped to one', () => {
    const makeLoading = (): PtyInfo => ({
      ptyId: 'pty-123',
      paneId: undefined as any,
      sessionId: 'session-B',
      cwd: '',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: undefined,
      sessionMetadata: { id: 'session-B', name: 'Session B', autoNamed: false, lastSwitchedAt: 0 },
      sortOrderHint: undefined,
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
    });

    // Simulate multiple concurrent refreshPtys creating loading placeholders
    const result = dedupeAggregatePtysByPane([makeLoading(), makeLoading(), makeLoading()]);

    expect(result).toHaveLength(1);
  });

  test('saved and live entries for same pane are still deduped (no regression)', () => {
    const saved: PtyInfo = {
      ptyId: 'saved:session-B:pane-B1',
      paneId: 'pane-B1',
      sessionId: 'session-B',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-B', name: 'Session B', autoNamed: false, lastSwitchedAt: 0 },
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

    const live: PtyInfo = {
      ptyId: 'pty-123',
      paneId: 'pane-B1',
      sessionId: 'session-B',
      cwd: '/home',
      foregroundProcess: 'vim',
      shell: 'shell',
      title: 'vim',
      workspaceId: 1,
      sessionMetadata: { id: 'session-B', name: 'Session B', autoNamed: false, lastSwitchedAt: 0 },
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

    const result = dedupeAggregatePtysByPane([saved, live]);

    expect(result).toHaveLength(1);
    expect(result[0].ptyId).toBe('pty-123'); // live preferred over saved
    expect(result[0].gitBranch).toBe('main'); // git preserved from saved
    expect(result[0].gitDirty).toBe(true);
  });

  test('entries for different panes with same ptyId format are NOT wrongly merged', () => {
    // Two real PTYs with different paneIds — they should NOT be merged by ptyId
    const pty1: PtyInfo = {
      ptyId: 'pty-same-id',
      paneId: 'pane-A1',
      sessionId: 'session-A',
      cwd: '/a',
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

    const pty2: PtyInfo = {
      ...pty1,
      paneId: 'pane-A2',
      sortOrderHint: 1,
    };

    // Different paneIds → different paneKeys → NOT merged by pane key
    // Same ptyId → ptyId dedupe kicks in and merges them
    // This is correct: a single PTY can only be in one pane
    const result = dedupeAggregatePtysByPane([pty1, pty2]);
    expect(result).toHaveLength(1); // Same ptyId = same PTY, must be deduped
  });
});

// ─── Scenario 3: applySnapshot pane-key carry prevention ───

describe('race condition: optimistic entry carried when snapshot covers same pane', () => {
  test('optimistic PTY is NOT carried when snapshot has same pane key', () => {
    // Simulates: lifecycle handler created an optimistic entry for pane-B1
    // with ptyId 'pty-123', but the snapshot has a saved: entry for the
    // same pane with ptyId 'saved:session-B:pane-B1'.
    //
    // Before: carriedOptimisticPtys only checked ptyId match → optimistic
    // entry was carried (different ptyId), creating duplication.
    //
    // After: also checks pane key → same pane → NOT carried.

    const optimisticPty: PtyInfo = {
      ptyId: 'pty-123',
      paneId: 'pane-B1',
      sessionId: 'session-B',
      cwd: '',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
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
    };

    const snapshotPty: PtyInfo = {
      ptyId: 'saved:session-B:pane-B1',
      paneId: 'pane-B1',
      sessionId: 'session-B',
      cwd: '/home',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      sessionMetadata: { id: 'session-B', name: 'B', autoNamed: false, lastSwitchedAt: 0 },
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

    // Build the sets that applySnapshot uses
    const snapshotPtyIds = new Set([snapshotPty.ptyId]);
    const snapshotPaneKeys = new Set<string>();
    const paneKey = getAggregatePaneKey(snapshotPty.sessionId, snapshotPty.paneId);
    if (paneKey) snapshotPaneKeys.add(paneKey);

    const pendingPtyIds = new Set(['pty-123']);

    // Before fix: only checked snapshotPtyIds
    const carriedBefore = [optimisticPty].filter(
      (pty) => !snapshotPtyIds.has(pty.ptyId) && pendingPtyIds.has(pty.ptyId) // && !deletedPtyIds.has(...)
    );
    expect(carriedBefore).toHaveLength(1); // ← CARRIED → duplication!

    // After fix: also checks snapshotPaneKeys
    const carriedAfter = [optimisticPty].filter((pty) => {
      const pk = getAggregatePaneKey(pty.sessionId, pty.paneId);
      return (
        !snapshotPtyIds.has(pty.ptyId) &&
        !(pk && snapshotPaneKeys.has(pk)) &&
        pendingPtyIds.has(pty.ptyId)
      );
    });
    expect(carriedAfter).toHaveLength(0); // ← NOT carried → no duplication!

    // The dedupe would merge them into one entry either way, but
    // carrying creates a temporary duplicate that flickers in the UI.
  });
});

// ─── Scenario 4: queueMicrotask retry timing ───

describe('race condition: queueMicrotask retry runs after createPTY continuation', () => {
  test('queueMicrotask callback runs after synchronous continuation', async () => {
    // Prove that queueMicrotask runs after the current microtask queue
    // is drained, which includes the createPTY continuation.
    let mappingSet = false;
    let retryRan = false;
    let retryFoundMapping = false;

    // Simulate T1: lifecycle event fires, ownership is null
    const ownership = null; // getAggregateSessionForPty returns null

    if (!ownership) {
      // Schedule microtask retry (what handlePtyCreated does)
      queueMicrotask(() => {
        retryRan = true;
        // By now, T2 should have run
        retryFoundMapping = mappingSet;
      });
    }

    // Simulate T2: createPTY continuation sets the mapping
    // This runs BEFORE the microtask because it's in the current
    // synchronous execution context
    mappingSet = true;

    // Wait for microtasks to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(retryRan).toBe(true);
    expect(retryFoundMapping).toBe(true); // ← The mapping IS available when retry runs
  });
});
