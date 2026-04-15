/**
 * Session pane ordering helpers for aggregate view.
 *
 * Pane ordering is stored in a single flattened index keyed by
 * `sessionId\0paneId`. These helpers expose session-scoped reads/writes
 * so callers do not need to care about the flattened representation.
 */

import type { AggregateViewState } from './types';

export type SessionPaneOrderIndex = AggregateViewState['sessionPaneOrderIndex'];

const SESSION_PANE_ORDER_SEPARATOR = '\u0000';

/** Synthetic pane ID prefix used to track sortOrderHint for pending creations
 * that haven't been assigned a real paneId yet. Prevents the intended sort
 * position from being lost when applySnapshot rebuilds sessionPaneOrderIndex. */
const PENDING_PANE_ORDER_PREFIX = '__pending_';

export function getPendingPaneOrderKey(pendingId: string): string {
  return `${PENDING_PANE_ORDER_PREFIX}${pendingId}`;
}

export function isPendingPaneOrderKey(paneId: string): boolean {
  return paneId.startsWith(PENDING_PANE_ORDER_PREFIX);
}

export function getSessionPaneOrderKey(sessionId: string, paneId: string): string {
  return `${sessionId}${SESSION_PANE_ORDER_SEPARATOR}${paneId}`;
}

function getSessionPaneOrderPrefix(sessionId: string): string {
  return `${sessionId}${SESSION_PANE_ORDER_SEPARATOR}`;
}

export function getSessionPaneOrder(
  sessionPaneOrderIndex: SessionPaneOrderIndex,
  sessionId: string
): Map<string, number> {
  const prefix = getSessionPaneOrderPrefix(sessionId);
  const paneOrder = new Map<string, number>();

  for (const [key, order] of sessionPaneOrderIndex) {
    if (!key.startsWith(prefix)) continue;
    if (typeof order !== 'number') continue;
    paneOrder.set(key.slice(prefix.length), order);
  }

  return paneOrder;
}

export function deleteSessionPaneOrder(
  sessionPaneOrderIndex: SessionPaneOrderIndex,
  sessionId: string
): void {
  const prefix = getSessionPaneOrderPrefix(sessionId);
  for (const key of [...sessionPaneOrderIndex.keys()]) {
    if (key.startsWith(prefix)) {
      sessionPaneOrderIndex.delete(key);
    }
  }
}

export function setSessionPaneOrder(
  sessionPaneOrderIndex: SessionPaneOrderIndex,
  sessionId: string,
  paneOrder: Map<string, number>
): void {
  deleteSessionPaneOrder(sessionPaneOrderIndex, sessionId);
  for (const [paneId, order] of paneOrder) {
    sessionPaneOrderIndex.set(getSessionPaneOrderKey(sessionId, paneId), order);
  }
}

export function mergePaneOrder(
  existing: Map<string, number> | undefined,
  incoming: Map<string, number>
): Map<string, number> {
  if (!existing || existing.size === 0) {
    return new Map(incoming);
  }

  const incomingPaneIds = new Set(incoming.keys());
  const merged = new Map<string, number>();
  const existingEntries = [...existing.entries()]
    .filter(([paneId]) => incomingPaneIds.has(paneId))
    .sort(([, aOrder], [, bOrder]) => aOrder - bOrder);

  for (const [paneId, order] of existingEntries) {
    merged.set(paneId, order);
  }

  let nextOrder = existingEntries.reduce((maxOrder, [, order]) => Math.max(maxOrder, order), -1);

  for (const [paneId] of [...incoming.entries()].sort(
    ([, aOrder], [, bOrder]) => aOrder - bOrder
  )) {
    if (merged.has(paneId)) {
      continue;
    }

    nextOrder = Math.floor(nextOrder) + 1;
    merged.set(paneId, nextOrder);
  }

  return merged;
}

export function buildSessionPaneOrderFromAggregateState(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrderIndex'>,
  sessionId: string
): Map<string, number> {
  const flattenedOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, sessionId);
  if (flattenedOrder.size > 0) {
    // Filter out synthetic pending keys — they're only stored in
    // sessionPaneOrderIndex for persistence across applySnapshot calls
    // and should not affect sort order computation for real panes.
    for (const key of flattenedOrder.keys()) {
      if (isPendingPaneOrderKey(key)) {
        flattenedOrder.delete(key);
      }
    }
    return flattenedOrder;
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
