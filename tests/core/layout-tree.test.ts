import { describe, it, expect } from 'bun:test';
import type { PaneData, Rectangle, SplitNode } from '../../src/core/types';
import {
  clearNodeRectangles,
  cloneLayoutNode,
  removePaneFromNode,
  replacePaneWithSplit,
  updatePaneInNode,
} from '../../src/core/layout-tree';

function rectangle(x: number, y: number, width: number, height: number): Rectangle {
  return { x, y, width, height };
}

function createTree() {
  const left: PaneData = { id: 'pane-1' };
  const right: PaneData = { id: 'pane-2', rectangle: rectangle(60, 0, 60, 40) };
  const root: SplitNode = {
    type: 'split',
    id: 'split-1',
    direction: 'vertical',
    ratio: 0.5,
    rectangle: rectangle(0, 0, 120, 40),
    first: left,
    second: right,
  };

  return { left, right, root };
}

describe('layout-tree helpers', () => {
  it('returns the same root for no-op pane updates', () => {
    const { root } = createTree();

    const updated = updatePaneInNode(root, 'pane-2', (pane) => pane);

    expect(updated).toBe(root);
  });

  it('reuses unaffected branches when replacing a pane with a split', () => {
    const { left, root } = createTree();

    const replaced = replacePaneWithSplit(
      root,
      'pane-2',
      { id: 'pane-3' },
      'horizontal',
      0.5,
      'split-2'
    ) as SplitNode;

    expect(replaced).not.toBe(root);
    expect(replaced.first).toBe(left);
    expect(replaced.second).not.toBe(root.second);
  });

  it('returns the same root when removing a pane that does not exist', () => {
    const { root } = createTree();

    const updated = removePaneFromNode(root, 'pane-999');

    expect(updated).toBe(root);
  });

  it('only clones nodes whose rectangles are actually cleared', () => {
    const { left, right, root } = createTree();

    const cleared = clearNodeRectangles(root) as SplitNode;

    expect(cleared).not.toBe(root);
    expect(cleared.rectangle).toBeUndefined();
    expect(cleared.first).toBe(left);
    expect(cleared.second).not.toBe(right);
    expect((cleared.second as PaneData).rectangle).toBeUndefined();
  });

  it('deep clones every node in the tree', () => {
    const { left, right, root } = createTree();

    const cloned = cloneLayoutNode(root) as SplitNode;

    expect(cloned).not.toBe(root);
    expect(cloned.first).not.toBe(left);
    expect(cloned.second).not.toBe(right);
    expect(cloned).toEqual(root);
  });
});
