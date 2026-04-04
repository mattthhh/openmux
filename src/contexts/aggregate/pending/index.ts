/**
 * Pending PTY insertion operations for Aggregate View.
 *
 * Manages temporary state for PTYs that are being created but haven't
 * been assigned a pane ID yet. Used for optimistic UI updates during
 * session restoration and new pane creation.
 */

import type { AggregateViewState, PendingPaneCreation } from '../types';

type PendingInsertionCollectionState = Pick<AggregateViewState, 'pendingPaneCreations'>;

type PendingInsertionOrderState = Pick<
  AggregateViewState,
  'allPtys' | 'sessionPaneOrders' | 'pendingPaneCreations'
>;

/** Get the most recent pending insertion */
export function getCurrentPendingPaneCreation(
  state: PendingInsertionCollectionState
): PendingPaneCreation | null {
  return state.pendingPaneCreations[state.pendingPaneCreations.length - 1] ?? null;
}

/** Replace all pending insertions */
export function setPendingPaneCreations(
  state: PendingInsertionCollectionState,
  insertions: PendingPaneCreation[]
): void {
  state.pendingPaneCreations = insertions;
}

/** Add or update a pending insertion */
export function upsertPendingPaneCreation(
  state: PendingInsertionCollectionState,
  insertion: PendingPaneCreation
): void {
  const nextInsertions = state.pendingPaneCreations.filter(
    (candidate) => candidate.id !== insertion.id
  );
  nextInsertions.push(insertion);
  setPendingPaneCreations(state, nextInsertions);
}

/** Remove pending insertions matching a predicate */
export function removePendingPaneCreations(
  state: PendingInsertionCollectionState,
  predicate: (insertion: PendingPaneCreation) => boolean
): void {
  setPendingPaneCreations(
    state,
    state.pendingPaneCreations.filter((insertion) => !predicate(insertion))
  );
}

/** Find a pending insertion matching a predicate */
export function findPendingPaneCreation(
  state: PendingInsertionCollectionState,
  predicate: (insertion: PendingPaneCreation) => boolean
): PendingPaneCreation | null {
  return state.pendingPaneCreations.find(predicate) ?? null;
}

/** Build pane order map for a session from current state */
function buildSessionPaneOrderFromState(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrders'>,
  sessionId: string
): Map<string, number> {
  const existingOrder = state.sessionPaneOrders.get(sessionId);
  if (existingOrder) {
    return existingOrder;
  }

  const sessionPaneIds = state.allPtys
    .filter((pty) => pty.sessionId === sessionId && !!pty.paneId)
    .sort((a, b) => {
      const aOrder = a.sortOrderHint ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.sortOrderHint ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return (a.paneId ?? a.ptyId).localeCompare(b.paneId ?? b.ptyId);
    })
    .map((pty) => pty.paneId as string);

  return new Map(sessionPaneIds.map((paneId, index) => [paneId, index] as const));
}

/** Calculate insertion order for a pane inserted after another */
export function getInsertedPaneOrder(
  paneOrder: Map<string, number>,
  insertAfterPaneId: string
): number | null {
  const insertAfterOrder = paneOrder.get(insertAfterPaneId);
  if (insertAfterOrder === undefined) {
    return null;
  }

  let nextOrder: number | undefined;
  for (const order of paneOrder.values()) {
    if (order <= insertAfterOrder) {
      continue;
    }
    if (nextOrder === undefined || order < nextOrder) {
      nextOrder = order;
    }
  }

  if (nextOrder === undefined) {
    return Math.floor(insertAfterOrder) + 1;
  }

  return insertAfterOrder + (nextOrder - insertAfterOrder) / 2;
}

/** Calculate order for appending a pane to the end */
export function getAppendedPaneOrder(paneOrder: Map<string, number>): number {
  return [...paneOrder.values()].reduce((maxOrder, order) => Math.max(maxOrder, order), -1) + 1;
}

/**
 * Calculate the next sort order hint for a pending PTY insertion.
 * This ensures proper ordering when multiple PTYs are being created.
 */
export function getNextPendingPaneCreationOrder(
  state: PendingInsertionOrderState,
  params: { sessionId: string; insertAfterPaneId: string | null }
): number {
  const paneOrder = buildSessionPaneOrderFromState(state, params.sessionId);
  const existingPendingOrders = state.pendingPaneCreations
    .filter(
      (insertion) =>
        insertion.sessionId === params.sessionId &&
        insertion.insertAfterPaneId === params.insertAfterPaneId
    )
    .map((insertion) => insertion.sortOrderHint)
    .filter((order): order is number => order !== undefined);

  if (!params.insertAfterPaneId) {
    const appendedOrder = getAppendedPaneOrder(paneOrder);
    if (existingPendingOrders.length === 0) {
      return appendedOrder;
    }
    return Math.max(appendedOrder - 1, ...existingPendingOrders) + 1;
  }

  const insertAfterOrder = paneOrder.get(params.insertAfterPaneId);
  if (insertAfterOrder === undefined) {
    const appendedOrder = getAppendedPaneOrder(paneOrder);
    if (existingPendingOrders.length === 0) {
      return appendedOrder;
    }
    return Math.max(appendedOrder - 1, ...existingPendingOrders) + 1;
  }

  let upperOrder: number | undefined;
  for (const order of paneOrder.values()) {
    if (order <= insertAfterOrder) {
      continue;
    }
    if (upperOrder === undefined || order < upperOrder) {
      upperOrder = order;
    }
  }

  const boundedPendingOrders = existingPendingOrders.filter(
    (order) => order > insertAfterOrder && (upperOrder === undefined || order < upperOrder)
  );
  const lowerOrder =
    boundedPendingOrders.length > 0 ? Math.max(...boundedPendingOrders) : insertAfterOrder;

  if (upperOrder === undefined) {
    return Math.floor(lowerOrder) + 1;
  }

  return lowerOrder + (upperOrder - lowerOrder) / 2;
}

/**
 * Find a pending insertion for a lifecycle event (PTY created/destroyed).
 * Matches by PTY ID, pane ID, or returns the oldest unresolved insertion.
 */
export function findPendingPaneCreationForLifecycle(
  state: PendingInsertionCollectionState,
  params: { ptyId?: string | null; sessionId?: string | null; paneId?: string | null }
): PendingPaneCreation | null {
  if (params.ptyId) {
    const matchingPtyInsertion = state.pendingPaneCreations.find(
      (insertion) => insertion.pendingPtyId === params.ptyId
    );
    if (matchingPtyInsertion) {
      return matchingPtyInsertion;
    }
  }

  const sessionInsertions = state.pendingPaneCreations.filter(
    (insertion) => !params.sessionId || insertion.sessionId === params.sessionId
  );

  if (params.paneId) {
    const matchingPaneInsertion = sessionInsertions.find(
      (insertion) => insertion.pendingPaneId === params.paneId
    );
    if (matchingPaneInsertion) {
      return matchingPaneInsertion;
    }
  }

  const unresolvedInsertions = sessionInsertions
    .map((insertion, index) => ({ insertion, index }))
    .filter(({ insertion }) => !insertion.pendingPaneId && !insertion.pendingPtyId)
    .sort((a, b) => {
      const aOrder = a.insertion.sortOrderHint ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.insertion.sortOrderHint ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.index - b.index;
    });

  return unresolvedInsertions[0]?.insertion ?? null;
}
