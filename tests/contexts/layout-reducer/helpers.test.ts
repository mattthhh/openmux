/**
 * Tests for the layout reducer helper functions.
 */

import { describe, it, expect } from "bun:test";
import { createWorkspace, getActiveWorkspace, generatePaneId } from '../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from './fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('Helper functions', () => {
    describe('generatePaneId', () => {
      it('should generate sequential IDs', () => {
        expect(generatePaneId()).toBe('pane-1');
        expect(generatePaneId()).toBe('pane-2');
        expect(generatePaneId()).toBe('pane-3');
      });
    });

    describe('createWorkspace', () => {
      it('should create empty workspace with default values', () => {
        const workspace = createWorkspace(1, 'vertical');
        expect(workspace).toEqual({
          id: 1,
          mainPane: null,
          stackPanes: [],
          focusedPaneId: null,
          activeStackIndex: 0,
          lastFocusedPaneIds: [],
          layoutMode: 'vertical',
          zoomed: false,
        });
      });

      it('should respect provided layout mode', () => {
        expect(createWorkspace(2, 'horizontal').layoutMode).toBe('horizontal');
        expect(createWorkspace(3, 'stacked').layoutMode).toBe('stacked');
      });
    });

    describe('getActiveWorkspace', () => {
      it('should return existing workspace', () => {
        const workspace = createWorkspaceWithPanes(1, { id: 'pane-1', title: 'test' });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });
        expect(getActiveWorkspace(state)).toEqual(workspace);
      });

      it('should create new workspace if not exists', () => {
        const state = createInitialState();
        const workspace = getActiveWorkspace(state);
        expect(workspace.id).toBe(1);
        expect(workspace.mainPane).toBeNull();
      });
    });
  });
});
