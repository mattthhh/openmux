import { describe, it, expect } from 'bun:test';
import type { PaneData } from '../../../../src/core/types';
import { layoutReducer, generatePaneId } from '../../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('CLOSE_PANE_BY_ID action', () => {
    it('should close pane by specific ID', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-1', // Focus main, but close stack pane
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-1'); // Focus unchanged
    });

    it('should update focus when closing focused pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.focusedPaneId).toBe('pane-3');
    });

    it('should adjust activeStackIndex when closing pane before it', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }, { id: 'pane-4' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-4',
        activeStackIndex: 2,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

      // Active index should be adjusted
      expect(newWorkspace.activeStackIndex).toBe(1);
      expect(newWorkspace.focusedPaneId).toBe('pane-4');
    });

    it('should return same state when pane not found', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'non-existent' });
      expect(newState).toBe(state);
    });

    it('should close main pane and promote stack', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-1' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes).toHaveLength(0);
    });

    it('should close pane in a non-active workspace', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' }, [{ id: 'pane-3' }], {
        focusedPaneId: 'pane-3',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace1, 2: workspace2 },
        activeWorkspaceId: 1,
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-3' });
      const updatedWorkspace2 = newState.workspaces[2]!;

      expect(updatedWorkspace2.stackPanes).toHaveLength(0);
      expect(updatedWorkspace2.focusedPaneId).toBe('pane-2');
    });

    it('should preserve focus when closing a different pane inside the main split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [], { focusedPaneId: mainPane.id }),
        },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      const splitPaneId = state.workspaces[1]!.focusedPaneId!;
      state = layoutReducer(state, { type: 'FOCUS_PANE', paneId: mainPane.id });

      const newState = layoutReducer(state, {
        type: 'CLOSE_PANE_BY_ID',
        paneId: splitPaneId,
      });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.focusedPaneId).toBe(mainPane.id);
      expect(newWorkspace.mainPane?.id).toBe(mainPane.id);
    });

    it('should preserve focus when closing a different pane inside the active stack split tree', () => {
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
      const splitPaneId = state.workspaces[1]!.focusedPaneId!;
      state = layoutReducer(state, { type: 'FOCUS_PANE', paneId: stackPane.id });

      const newState = layoutReducer(state, {
        type: 'CLOSE_PANE_BY_ID',
        paneId: splitPaneId,
      });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.focusedPaneId).toBe(stackPane.id);
      expect(newWorkspace.activeStackIndex).toBe(0);
    });
  });
});
