import { describe, it, expect } from 'bun:test';
import type { PaneData } from '../../../../src/core/types';
import { layoutReducer } from '../../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('SET_PANE_PTY action', () => {
    it('should set ptyId on main pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-1',
        ptyId: 'pty-123',
      });

      expect(newState.workspaces[1]!.mainPane!.ptyId).toBe('pty-123');
    });

    it('should set ptyId on stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-456',
      });

      expect(newState.workspaces[1]!.stackPanes[0]!.ptyId).toBe('pty-456');
    });

    it('should not modify other panes', () => {
      const mainPane: PaneData = { id: 'pane-1', ptyId: 'pty-original' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-new',
      });

      expect(newState.workspaces[1]!.mainPane!.ptyId).toBe('pty-original');
    });
  });
});
