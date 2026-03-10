/**
 * Tree operations litmus tests - fast, single concept tests.
 */

import { describe, it, expect } from 'vitest';
import {
  getDefaultLoadState,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  createUnloadedPlaceholder,
  computeTreePrefix,
  computeIndentPrefix,
  isSelectableItem,
} from '../tree';
import { TREE_GLYPHS } from '../types';
import type { FlattenedTreeItem, SessionLoadState } from '../types';

describe('getDefaultLoadState', () => {
  it('returns unloaded state', () => {
    const state = getDefaultLoadState();
    expect(state.status).toBe('unloaded');
  });
});

describe('createLoadingPlaceholder', () => {
  it('creates loading placeholder', () => {
    const node = createLoadingPlaceholder('session-1');
    expect(node.type).toBe('placeholder');
    expect(node.parentSessionId).toBe('session-1');
    expect(node.message).toBe('Loading...');
    expect(node.isLoading).toBe(true);
  });
});

describe('createErrorPlaceholder', () => {
  it('creates error placeholder', () => {
    const node = createErrorPlaceholder('session-1', 'Connection failed');
    expect(node.type).toBe('placeholder');
    expect(node.message).toBe('Error: Connection failed');
    expect(node.isLoading).toBe(false);
  });
});

describe('createUnloadedPlaceholder', () => {
  it('creates unloaded placeholder without workspace', () => {
    const node = createUnloadedPlaceholder('session-1');
    expect(node.message).toBe('Session (unloaded)');
  });

  it('creates unloaded placeholder with workspace', () => {
    const node = createUnloadedPlaceholder('session-1', 3);
    expect(node.message).toBe('Workspace 3 (unloaded)');
    expect(node.lastActiveWorkspaceId).toBe(3);
  });
});

describe('computeTreePrefix', () => {
  it('returns empty for depth 0', () => {
    expect(computeTreePrefix(0, false)).toBe('');
    expect(computeTreePrefix(0, true)).toBe('');
  });

  it('returns correct glyphs for depth > 0', () => {
    expect(computeTreePrefix(1, false)).toBe(TREE_GLYPHS.BRANCH_MIDDLE);
    expect(computeTreePrefix(1, true)).toBe(TREE_GLYPHS.BRANCH_LAST);
  });
});

describe('computeIndentPrefix', () => {
  it('returns empty for no ancestors', () => {
    expect(computeIndentPrefix([])).toBe('');
  });

  it('computes single level prefix', () => {
    expect(computeIndentPrefix([false])).toBe(TREE_GLYPHS.BRANCH_MIDDLE);
    expect(computeIndentPrefix([true])).toBe(TREE_GLYPHS.BRANCH_LAST);
  });

  it('computes multi-level prefix', () => {
    const prefix = computeIndentPrefix([false, true]);
    expect(prefix).toContain(TREE_GLYPHS.VERTICAL);
    expect(prefix).toContain(TREE_GLYPHS.BRANCH_LAST);
  });
});

describe('isSelectableItem', () => {
  it('returns false for spacer', () => {
    const item: FlattenedTreeItem = {
      node: { type: 'spacer' },
      depth: 0,
      isLast: false,
      prefix: '',
      index: 0,
      parentSessionId: undefined,
    };
    expect(isSelectableItem(item)).toBe(false);
  });

  it('returns true for session', () => {
    const item: FlattenedTreeItem = {
      node: {
        type: 'session',
        session: { id: 's1', name: 'Test', createdAt: Date.now(), updatedAt: Date.now() },
        ptyCount: 0,
        activePtyCount: 0,
        loadState: { status: 'loaded' },
        isExpanded: false,
      },
      depth: 0,
      isLast: false,
      prefix: '',
      index: 0,
      parentSessionId: undefined,
    };
    expect(isSelectableItem(item)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isSelectableItem(undefined)).toBe(false);
  });
});
