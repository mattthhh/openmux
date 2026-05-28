import { describe, it, expect } from 'bun:test';
import type { PaneData, SplitNode } from '../../../../src/core/types';
import { layoutReducer, generatePaneId } from '../../../../src/core/operations/layout-actions';
import { collectPanes, isSplitNode } from '../../../../src/core/layout-tree';
import {
  createInitialState,
  createWorkspaceWithPanes,
  defaultViewport,
  setupLayoutReducerTest,
} from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('SPLIT_PANE action', () => {
    it('should split the focused main pane into a split node', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      const newWorkspace = newState.workspaces[1]!;
      const mainNode = newWorkspace.mainPane!;

      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect(split.direction).toBe('vertical');

      const firstPane = split.first as PaneData;
      const secondPane = split.second as PaneData;
      expect(firstPane.id).toBe(mainPane.id);
      expect(secondPane.id).toBe('pane-2');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');

      expect(firstPane.rectangle).toBeDefined();
      expect(secondPane.rectangle).toBeDefined();
      expect(firstPane.rectangle!.height).toBe(defaultViewport.height);
      expect(secondPane.rectangle!.height).toBe(defaultViewport.height);
      expect(firstPane.rectangle!.width + secondPane.rectangle!.width).toBe(defaultViewport.width);
    });

    it('should split a stack pane in stacked layout', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: stackPane.id,
        activeStackIndex: 0,
        layoutMode: 'stacked',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });
      const newWorkspace = newState.workspaces[1]!;
      const stackNode = newWorkspace.stackPanes[0]!;

      expect(isSplitNode(stackNode)).toBe(true);
      const split = stackNode as SplitNode;
      expect(split.direction).toBe('horizontal');

      const firstPane = split.first as PaneData;
      const secondPane = split.second as PaneData;
      expect(firstPane.id).toBe(stackPane.id);
      expect(secondPane.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-3');

      expect(split.rectangle).toBeDefined();
      expect(firstPane.rectangle).toBeDefined();
      expect(secondPane.rectangle).toBeDefined();
      expect(firstPane.rectangle!.width).toBe(split.rectangle!.width);
      expect(secondPane.rectangle!.width).toBe(split.rectangle!.width);
      expect(firstPane.rectangle!.height + secondPane.rectangle!.height).toBe(
        split.rectangle!.height
      );
    });

    it('should support nested splits within main pane', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      let state = createInitialState({
        workspaces: { 1: workspace },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });

      const mainNode = state.workspaces[1]!.mainPane!;
      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect(split.direction).toBe('vertical');

      expect(isSplitNode(split.second)).toBe(true);
      const nested = split.second as SplitNode;
      expect(nested.direction).toBe('horizontal');
      expect((nested.first as PaneData).id).toBe('pane-2');
      expect((nested.second as PaneData).id).toBe('pane-3');

      const panes = collectPanes(mainNode);
      expect(panes).toHaveLength(3);
      panes.forEach((pane) => {
        expect(pane.rectangle).toBeDefined();
      });
    });
  });
});
