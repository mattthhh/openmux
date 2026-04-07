import { describe, expect, it } from 'bun:test';

import { getNextPendingPaneCreationOrder } from '../pending';
import type { AggregateViewState, PendingPaneCreation } from '../types';

function createState(): Pick<
  AggregateViewState,
  'allPtys' | 'sessionPaneOrders' | 'sessionPaneOrderIndex' | 'pendingPaneCreations'
> {
  return {
    allPtys: [],
    sessionPaneOrders: new Map([
      [
        'session-1',
        new Map([
          ['pane-1', 0],
          ['pane-2', 1],
        ]),
      ],
    ]),
    sessionPaneOrderIndex: new Map(),
    pendingPaneCreations: [],
  };
}

describe('getNextPendingPaneCreationOrder', () => {
  it('keeps large overlapping insertion bursts ordered inside the same gap', () => {
    const state = createState();
    const orders: number[] = [];

    for (let index = 0; index < 80; index += 1) {
      const sortOrderHint = getNextPendingPaneCreationOrder(state, {
        sessionId: 'session-1',
        insertAfterPaneId: 'pane-1',
      });
      const insertion: PendingPaneCreation = {
        id: `pending-${index}`,
        sessionId: 'session-1',
        insertAfterPtyId: 'pty-1',
        insertAfterPaneId: 'pane-1',
        pendingPtyId: null,
        pendingPaneId: null,
        sortOrderHint,
      };

      state.pendingPaneCreations.push(insertion);
      orders.push(sortOrderHint);
    }

    expect(new Set(orders).size).toBe(80);
    expect(orders.every((order, index) => index === 0 || order > orders[index - 1]!)).toBe(true);
    expect(Math.max(...orders)).toBeLessThan(1);
  });
});
