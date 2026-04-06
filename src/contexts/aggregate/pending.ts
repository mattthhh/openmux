/**
 * Pending PTY insertion operations for Aggregate View.
 */

import type { AggregateViewState, PendingPaneCreation } from './types';
import { buildSessionPaneOrderFromAggregateState } from './pane-order';

type PendingInsertionCollectionState = Pick<AggregateViewState, 'pendingPaneCreations'>;
type PendingInsertionOrderState = Pick<
  AggregateViewState,
  'allPtys' | 'sessionPaneOrders' | 'sessionPaneOrderIndex' | 'pendingPaneCreations'
>;

export function getCurrentPendingPaneCreation(
  state: PendingInsertionCollectionState
): PendingPaneCreation | null {
  return state.pendingPaneCreations[state.pendingPaneCreations.length - 1] ?? null;
}

export function setPendingPaneCreations(
  state: PendingInsertionCollectionState,
  insertions: PendingPaneCreation[]
): void {
  state.pendingPaneCreations = insertions;
}

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

export function removePendingPaneCreations(
  state: PendingInsertionCollectionState,
  predicate: (insertion: PendingPaneCreation) => boolean
): void {
  setPendingPaneCreations(
    state,
    state.pendingPaneCreations.filter((insertion) => !predicate(insertion))
  );
}

export function findPendingPaneCreation(
  state: PendingInsertionCollectionState,
  predicate: (insertion: PendingPaneCreation) => boolean
): PendingPaneCreation | null {
  return state.pendingPaneCreations.find(predicate) ?? null;
}

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

export function getAppendedPaneOrder(paneOrder: Map<string, number>): number {
  return [...paneOrder.values()].reduce((maxOrder, order) => Math.max(maxOrder, order), -1) + 1;
}

export function getNextPendingPaneCreationOrder(
  state: PendingInsertionOrderState,
  params: { sessionId: string; insertAfterPaneId: string | null }
): number {
  const paneOrder = buildSessionPaneOrderFromAggregateState(state, params.sessionId);
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
