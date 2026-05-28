import { describe, it, expect } from 'bun:test';
import type { PaneData } from '../../../../src/core/types';
import {
  layoutReducer,
  createWorkspace,
  generatePaneId,
} from '../../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('CLOSE_PANE action', () => {
    it('should close main pane and promote first stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-1',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');
    });

    it('should close stack pane and adjust focus', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      // Should focus adjacent pane or main
      expect(newWorkspace.focusedPaneId).toBe('pane-3');
    });

    it('should focus main when closing last stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.stackPanes).toHaveLength(0);
      expect(newWorkspace.focusedPaneId).toBe('pane-1');
    });

    it('should focus sibling when closing inside a split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      let state = createInitialState({
        workspaces: { 1: workspace },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.focusedPaneId).toBe('pane-2');
    });

    it('should clear workspace when closing only pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });

      // Workspace should be removed from object
      expect(newState.workspaces[1]).toBeUndefined();
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      expect(newState).toBe(state);
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-2',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      expect(newState.layoutVersion).toBe(1);
    });
  });
});
