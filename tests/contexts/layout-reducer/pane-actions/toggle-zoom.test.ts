import { describe, it, expect } from 'bun:test';
import type { PaneData } from '../../../../src/core/types';
import { layoutReducer, createWorkspace } from '../../../../src/core/operations/layout-actions';
import {
  createInitialState,
  createWorkspaceWithPanes,
  defaultViewport,
  setupLayoutReducerTest,
} from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('TOGGLE_ZOOM action', () => {
    it('should toggle zoom on', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1',
        zoomed: false,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.zoomed).toBe(true);
      // Focused pane should get full viewport
      expect(newWorkspace.mainPane!.rectangle).toEqual(defaultViewport);
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeUndefined();
    });

    it('should toggle zoom off', () => {
      const mainPane: PaneData = { id: 'pane-1', rectangle: defaultViewport };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1',
        zoomed: true,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.zoomed).toBe(false);
      // Should recalculate normal layout
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeDefined();
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      expect(newState).toBe(state);
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: 'pane-1',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      expect(newState.layoutVersion).toBe(1);
    });
  });
});
