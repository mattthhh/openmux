import { describe, it, expect } from 'bun:test';
import type { PaneData } from '../../../../src/core/types';
import { layoutReducer, createWorkspace } from '../../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('SWAP_MAIN action', () => {
    it('should swap focused stack pane with main', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-1');
    });

    it('should return same state when main pane is focused', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1', // Main is focused
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should return same state when no main pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should return same state when no focused pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: null,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
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

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState.layoutVersion).toBe(1);
    });
  });
});
