import { describe, it, expect } from "bun:test";
import type { PaneData, SplitNode } from '../../../../src/core/types';
import { layoutReducer, generatePaneId } from '../../../../src/core/operations/layout-actions';
import { collectPanes, isSplitNode } from '../../../../src/core/layout-tree';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('MOVE_PANE action', () => {
    it('should swap within main split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [], { focusedPaneId: mainPane.id }),
        },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'west' });
      const mainNode = moved.workspaces[1]!.mainPane!;

      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect((split.first as PaneData).id).toBe('pane-2');
      expect((split.second as PaneData).id).toBe('pane-1');
      expect(moved.workspaces[1]!.focusedPaneId).toBe('pane-2');
    });

    it('should swap within stack split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [stackPane], {
            focusedPaneId: stackPane.id,
            activeStackIndex: 0,
          }),
        },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'north' });
      const stackNode = moved.workspaces[1]!.stackPanes[0]!;

      expect(isSplitNode(stackNode)).toBe(true);
      const split = stackNode as SplitNode;
      expect((split.first as PaneData).id).toBe('pane-3');
      expect((split.second as PaneData).id).toBe('pane-2');
      expect(moved.workspaces[1]!.focusedPaneId).toBe('pane-3');
    });

    it('should reorder stack entries when no sibling in direction', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPanes: PaneData[] = [
        { id: generatePaneId() },
        { id: generatePaneId() },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: stackPanes[1]!.id,
        activeStackIndex: 1,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'north' });
      const newWorkspace = moved.workspaces[1]!;

      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(stackPanes[1]!.id);
      expect((newWorkspace.stackPanes[1] as PaneData).id).toBe(stackPanes[0]!.id);
      expect(newWorkspace.activeStackIndex).toBe(0);
    });

    it('should swap panes geometrically from main to stack (east)', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: mainPane.id,
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'east' });
      const newWorkspace = moved.workspaces[1]!;

      // The panes should have swapped positions (their data swapped)
      expect((newWorkspace.mainPane as PaneData).id).toBe(stackPane.id);
      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(mainPane.id);
    });

    it('should swap panes geometrically from stack to main (west)', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: stackPane.id,
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'west' });
      const newWorkspace = moved.workspaces[1]!;

      // The panes should have swapped positions (their data swapped)
      expect((newWorkspace.mainPane as PaneData).id).toBe(stackPane.id);
      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(mainPane.id);
    });

    it('should swap individual panes between split trees geometrically', () => {
      // Create main with a split and stack with a split
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [stackPane], {
            focusedPaneId: mainPane.id,
            activeStackIndex: 0,
          }),
        },
      });

      // Split the main pane vertically (creates two panes side by side)
      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      // Focus is now on the new pane (second child of split)
      // Move that pane east - it should swap with the closest pane in stack
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'east' });

      // The split structure should be preserved, but pane data swapped
      const mainNode = moved.workspaces[1]!.mainPane!;
      expect(isSplitNode(mainNode)).toBe(true);

      // Collect all panes to verify the swap happened
      const allPanes = collectPanes(mainNode);
      const stackPanes = collectPanes(moved.workspaces[1]!.stackPanes[0]!);

      // The stack pane should now contain the originally split pane
      // and the main split should contain the original stack pane
      expect(allPanes.some(p => p.id === stackPane.id)).toBe(true);
      expect(stackPanes.some(p => p.id !== stackPane.id)).toBe(true);
    });

    it('should reorder stack entries in stacked mode', () => {
      // Create workspace in stacked mode with multiple stack entries
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPanes: PaneData[] = [
        { id: generatePaneId() },
        { id: generatePaneId() },
        { id: generatePaneId() },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: stackPanes[1]!.id,
        activeStackIndex: 1,
        layoutMode: 'stacked',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      // Move stack entry left (west/h direction moves to previous tab)
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'west' });
      const newWorkspace = moved.workspaces[1]!;

      // Stack entries should be reordered
      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(stackPanes[1]!.id);
      expect((newWorkspace.stackPanes[1] as PaneData).id).toBe(stackPanes[0]!.id);
      expect((newWorkspace.stackPanes[2] as PaneData).id).toBe(stackPanes[2]!.id);
      expect(newWorkspace.activeStackIndex).toBe(0);
    });

    it('should move stack entry to the right in stacked mode', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPanes: PaneData[] = [
        { id: generatePaneId() },
        { id: generatePaneId() },
        { id: generatePaneId() },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: stackPanes[1]!.id,
        activeStackIndex: 1,
        layoutMode: 'stacked',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      // Move stack entry right (east/l direction moves to next tab)
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'east' });
      const newWorkspace = moved.workspaces[1]!;

      // Stack entries should be reordered
      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(stackPanes[0]!.id);
      expect((newWorkspace.stackPanes[1] as PaneData).id).toBe(stackPanes[2]!.id);
      expect((newWorkspace.stackPanes[2] as PaneData).id).toBe(stackPanes[1]!.id);
      expect(newWorkspace.activeStackIndex).toBe(2);
    });

    it('should swap stack entry with main pane in stacked mode', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPanes: PaneData[] = [
        { id: generatePaneId() },
        { id: generatePaneId() },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: stackPanes[0]!.id,
        activeStackIndex: 0,
        layoutMode: 'stacked',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      // Move focused stack entry to main (west/h from first stack entry moves to main)
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'west' });
      const newWorkspace = moved.workspaces[1]!;

      // Main and first stack entry should be swapped
      expect((newWorkspace.mainPane as PaneData).id).toBe(stackPanes[0]!.id);
      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(mainPane.id);
    });
  });
});
