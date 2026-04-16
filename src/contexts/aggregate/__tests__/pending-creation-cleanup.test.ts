/**
 * Regression test for orphaned pending pane creations blocking autoswitch.
 *
 * Bug: When handlePtyCreated fires before onCreated sets pendingPtyId
 * (and there are multiple unclaimed insertions for the same session),
 * findPendingPaneCreationForLifecycle returns null because it only
 * matches when exactly one insertion is unclaimed. The pending creation
 * is never removed, and pendingPaneCreations.length > 0 permanently
 * blocks the autoswitch effect.
 *
 * Fix: Two-pronged approach:
 * 1. handlePtyCreatedImpl yields (setTimeout(0)) before the final
 *    removal check, giving onCreated a chance to fire and set
 *    pendingPtyId so the match succeeds.
 * 2. Fallback cleanup removes any pending creation whose real PTY
 *    has already landed in the flattened tree index (both in
 *    handlePtyCreatedImpl and in the pending pane focus resolution).
 */

import { describe, expect, it } from 'bun:test';
import { findPendingPaneCreationForLifecycle, removePendingPaneCreations } from '../pending';
import type { PendingPaneCreation } from '../types';

describe('Orphaned pending pane creation cleanup', () => {
  const createPendingInsertion = (
    id: string,
    sessionId: string,
    overrides: Partial<PendingPaneCreation> = {}
  ): PendingPaneCreation => ({
    id,
    sessionId,
    insertAfterPtyId: null,
    insertAfterPaneId: null,
    pendingPtyId: null,
    pendingPaneId: null,
    sortOrderHint: undefined,
    ...overrides,
  });

  it('findPendingPaneCreationForLifecycle returns null with multiple unclaimed insertions', () => {
    // This is the root condition that causes the orphaned pending creation.
    // When two insertions for the same session are both unclaimed
    // (pendingPtyId === null), the function can't determine which one
    // matches the lifecycle event.
    const state = {
      pendingPaneCreations: [
        createPendingInsertion('pending-1', 'session-b'),
        createPendingInsertion('pending-2', 'session-b'),
      ],
    };

    const result = findPendingPaneCreationForLifecycle(state, {
      ptyId: 'pty-new',
      sessionId: 'session-b',
      paneId: 'pane-new',
    });

    expect(result).toBeNull();
  });

  it('findPendingPaneCreationForLifecycle matches when only one insertion is unclaimed', () => {
    // After onCreated fires for the first PTY, its pendingPtyId is set.
    // Only one unclaimed insertion remains, so the fallback matches.
    const state = {
      pendingPaneCreations: [
        createPendingInsertion('pending-1', 'session-b', {
          pendingPtyId: 'pty-first',
          pendingPaneId: 'pane-first',
        }),
        createPendingInsertion('pending-2', 'session-b'),
      ],
    };

    const result = findPendingPaneCreationForLifecycle(state, {
      ptyId: 'pty-second',
      sessionId: 'session-b',
      paneId: 'pane-second',
    });

    // The unclaimed fallback matches pending-2
    expect(result).not.toBeNull();
    expect(result!.id).toBe('pending-2');
  });

  it('findPendingPaneCreationForLifecycle matches by pendingPtyId when set', () => {
    // After onCreated fires and sets pendingPtyId, the direct match works.
    const state = {
      pendingPaneCreations: [
        createPendingInsertion('pending-1', 'session-b', {
          pendingPtyId: 'pty-first',
          pendingPaneId: 'pane-first',
        }),
        createPendingInsertion('pending-2', 'session-b', {
          pendingPtyId: 'pty-second',
          pendingPaneId: 'pane-second',
        }),
      ],
    };

    const result = findPendingPaneCreationForLifecycle(state, {
      ptyId: 'pty-first',
      sessionId: 'session-b',
      paneId: 'pane-first',
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('pending-1');
  });

  it('fallback cleanup removes pending creations whose PTY is in the tree index', () => {
    // Simulates the fallback cleanup that runs after the yield in
    // handlePtyCreatedImpl and in the pending pane focus resolution.
    const state = {
      pendingPaneCreations: [
        createPendingInsertion('pending-1', 'session-b', {
          pendingPtyId: 'pty-in-tree',
          pendingPaneId: 'pane-1',
        }),
        createPendingInsertion('pending-2', 'session-b', {
          pendingPtyId: 'pty-not-yet-in-tree',
          pendingPaneId: 'pane-2',
        }),
      ],
    };

    const flattenedTreeIndex = new Map<string, number>();
    flattenedTreeIndex.set('pty-in-tree', 3);
    // pty-not-yet-in-tree is NOT in the index yet

    // The fallback cleanup: remove any pending creation whose
    // real PTY has landed in the flattened tree index.
    removePendingPaneCreations(
      state,
      (insertion) =>
        insertion.pendingPtyId !== null && flattenedTreeIndex.has(insertion.pendingPtyId)
    );

    expect(state.pendingPaneCreations).toHaveLength(1);
    expect(state.pendingPaneCreations[0].id).toBe('pending-2');
  });

  it('orphaned pending creation blocks autoswitch guard', () => {
    // Documents that pendingPaneCreations.length > 0 blocks autoswitch.
    // This is the user-visible symptom: autoswitch stops working.
    const pendingCreations = [
      createPendingInsertion('orphaned', 'session-b', {
        pendingPtyId: 'pty-resolved', // Set by onCreated but never removed
        pendingPaneId: 'pane-resolved',
      }),
    ];

    // The autoswitch guard checks: pendingPaneCreations().length > 0
    const autoswitchBlocked = pendingCreations.length > 0;
    expect(autoswitchBlocked).toBe(true);

    // After the fallback cleanup removes it:
    const flattenedTreeIndex = new Map<string, number>();
    flattenedTreeIndex.set('pty-resolved', 0);

    const remaining = pendingCreations.filter(
      (insertion) =>
        !(insertion.pendingPtyId !== null && flattenedTreeIndex.has(insertion.pendingPtyId))
    );

    const autoswitchBlockedAfterCleanup = remaining.length > 0;
    expect(autoswitchBlockedAfterCleanup).toBe(false);
  });
});
