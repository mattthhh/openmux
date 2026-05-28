import { describe, it, expect } from 'bun:test';
import { layoutReducer } from '../../../../src/core/operations/layout-actions';
import { createInitialState, defaultViewport, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('NEW_PANE action', () => {
    it('should create first pane as main pane', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces[1]!;
      expect(workspace.mainPane).not.toBeNull();
      expect(workspace.mainPane!.id).toBe('pane-1');
      expect(workspace.focusedPaneId).toBe('pane-1');
      expect(workspace.stackPanes).toHaveLength(0);
    });

    it('should add subsequent panes to stack', () => {
      // First create a pane using NEW_PANE to sync the counter
      const initialState = createInitialState();
      const stateWithMain = layoutReducer(initialState, { type: 'NEW_PANE' });

      // Now add second pane
      const newState = layoutReducer(stateWithMain, { type: 'NEW_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.mainPane!.id).toBe('pane-1');
      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-2');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');
      expect(newWorkspace.activeStackIndex).toBe(0);
    });

    it('should use provided ptyId and title', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, {
        type: 'NEW_PANE',
        ptyId: 'pty-123',
        title: 'my-shell',
      });

      const workspace = newState.workspaces[1]!;
      expect(workspace.mainPane!.ptyId).toBe('pty-123');
      expect(workspace.mainPane!.title).toBe('my-shell');
    });

    it('should default title to shell', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces[1]!;
      expect(workspace.mainPane!.title).toBe('shell');
    });

    it('should increment layout version', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });
      expect(newState.layoutVersion).toBe(1);
    });

    it('should calculate layout rectangles', () => {
      const state = createInitialState();
      let newState = layoutReducer(state, { type: 'NEW_PANE' });

      // Single pane gets full viewport
      expect(newState.workspaces[1]!.mainPane!.rectangle).toEqual(defaultViewport);

      // Add second pane - should split
      newState = layoutReducer(newState, { type: 'NEW_PANE' });
      const workspace = newState.workspaces[1]!;

      expect(workspace.mainPane!.rectangle!.width).toBeLessThan(defaultViewport.width);
      expect(workspace.stackPanes[0]!.rectangle).toBeDefined();
    });
  });
});
