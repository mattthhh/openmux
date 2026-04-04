import { describe, expect, it } from 'bun:test';

import type {
  FlattenedTreeItem,
  PendingPaneCreation,
} from '../../../contexts/aggregate-view-types';
import type { PendingAggregatePaneFocus } from '../pending-pane-focus';
import { getSelectedSessionIdForAutoLoad } from '../auto-load-selected-session';

const createSessionItem = (
  sessionId: string,
  status: 'unloaded' | 'loaded' = 'unloaded'
): FlattenedTreeItem => ({
  node: {
    type: 'session',
    session: {
      id: sessionId,
      name: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ptyCount: 0,
    activePtyCount: 0,
    loadState: { status },
    isExpanded: false,
  },
  depth: 0,
  isLast: true,
  prefix: '',
  index: 0,
  parentSessionId: undefined,
});

const createPlaceholderItem = (sessionId: string, message = '...'): FlattenedTreeItem => ({
  node: {
    type: 'placeholder',
    parentSessionId: sessionId,
    message,
    isLoading: false,
  },
  depth: 1,
  isLast: true,
  prefix: '└─',
  index: 1,
  parentSessionId: sessionId,
});

const createPendingInsertion = (): PendingPaneCreation => ({
  id: 'pending-1',
  sessionId: 'session-a',
  insertAfterPtyId: 'pty-1',
  insertAfterPaneId: 'pane-1',
  pendingPtyId: 'pty-new',
  pendingPaneId: 'pane-new',
});

const createPendingPaneFocus = (): PendingAggregatePaneFocus => ({
  sessionId: 'session-a',
  paneId: 'pane-new',
});

describe('getSelectedSessionIdForAutoLoad', () => {
  it('autoloads unloaded session headers', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createSessionItem('session-a'),
      pendingPaneCreations: [],
      pendingPaneFocus: null,
    });

    expect(result).toBe('session-a');
  });

  it('autoloads unloaded session placeholders', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createPlaceholderItem('session-a'),
      pendingPaneCreations: [],
      pendingPaneFocus: null,
    });

    expect(result).toBe('session-a');
  });

  it('does not autoload while a pane creation is pending', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createPlaceholderItem('session-b'),
      pendingPaneCreations: [createPendingInsertion()],
      pendingPaneFocus: null,
    });

    expect(result).toBeNull();
  });

  it('does not autoload while pending focus is resolving', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createPlaceholderItem('session-b'),
      pendingPaneCreations: [],
      pendingPaneFocus: createPendingPaneFocus(),
    });

    expect(result).toBeNull();
  });

  it('ignores loaded session headers', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createSessionItem('session-a', 'loaded'),
      pendingPaneCreations: [],
      pendingPaneFocus: null,
    });

    expect(result).toBeNull();
  });

  it('ignores non-unloaded placeholders', () => {
    const result = getSelectedSessionIdForAutoLoad({
      selectedItem: createPlaceholderItem('session-a', 'Loading...'),
      pendingPaneCreations: [],
      pendingPaneFocus: null,
    });

    expect(result).toBeNull();
  });
});
