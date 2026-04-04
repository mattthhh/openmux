/**
 * Litmus tests for session utilities - fast, single concept tests.
 */

import { describe, it, expect } from 'bun:test';
import {
  collectSerializedPaneIds,
  buildSessionPaneOrder,
  findWorkspaceIdForPane,
} from '../refresh';
import type { SerializedSession, SerializedLayoutNode } from '../../effect/models';

describe('session utils (litmus)', () => {
  describe('collectSerializedPaneIds', () => {
    it('handles null node', () => {
      const result: string[] = [];
      collectSerializedPaneIds(null, result);
      expect(result).toEqual([]);
    });

    it('handles undefined node', () => {
      const result: string[] = [];
      collectSerializedPaneIds(undefined, result);
      expect(result).toEqual([]);
    });

    it('collects single pane id', () => {
      const result: string[] = [];
      const node: SerializedLayoutNode = { id: 'pane-1', ptyId: 'pty-1' };
      collectSerializedPaneIds(node, result);
      expect(result).toEqual(['pane-1']);
    });

    it('collects from split node', () => {
      const result: string[] = [];
      const node: SerializedLayoutNode = {
        type: 'split',
        direction: 'horizontal',
        first: { id: 'pane-1', ptyId: 'pty-1' },
        second: { id: 'pane-2', ptyId: 'pty-2' },
      };
      collectSerializedPaneIds(node, result);
      expect(result).toEqual(['pane-1', 'pane-2']);
    });

    it('collects nested splits', () => {
      const result: string[] = [];
      const node: SerializedLayoutNode = {
        type: 'split',
        direction: 'horizontal',
        first: {
          type: 'split',
          direction: 'vertical',
          first: { id: 'pane-1', ptyId: 'pty-1' },
          second: { id: 'pane-2', ptyId: 'pty-2' },
        },
        second: { id: 'pane-3', ptyId: 'pty-3' },
      };
      collectSerializedPaneIds(node, result);
      expect(result).toEqual(['pane-1', 'pane-2', 'pane-3']);
    });
  });

  describe('buildSessionPaneOrder', () => {
    it('builds empty map for session with no workspaces', () => {
      const session: SerializedSession = {
        id: 'session-1',
        workspaces: [],
        activeWorkspaceId: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const order = buildSessionPaneOrder(session);
      expect(order.size).toBe(0);
    });

    it('assigns correct order indices', () => {
      const session: SerializedSession = {
        id: 'session-1',
        workspaces: [
          {
            id: 1,
            mainPane: { id: 'pane-1', ptyId: 'pty-1' },
            stackPanes: [],
            focusedPaneId: 'pane-1',
          },
        ],
        activeWorkspaceId: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const order = buildSessionPaneOrder(session);
      expect(order.get('pane-1')).toBe(0);
    });
  });

  describe('findWorkspaceIdForPane', () => {
    it('returns undefined for empty session', () => {
      const session: SerializedSession = {
        id: 'session-1',
        workspaces: [],
        activeWorkspaceId: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(findWorkspaceIdForPane(session, 'pane-1')).toBeUndefined();
    });

    it('finds workspace for pane in main pane', () => {
      const session: SerializedSession = {
        id: 'session-1',
        workspaces: [
          {
            id: 1,
            mainPane: { id: 'pane-1', ptyId: 'pty-1' },
            stackPanes: [],
            focusedPaneId: 'pane-1',
          },
        ],
        activeWorkspaceId: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(findWorkspaceIdForPane(session, 'pane-1')).toBe(1);
    });

    it('finds workspace for pane in stack panes', () => {
      const session: SerializedSession = {
        id: 'session-1',
        workspaces: [
          {
            id: 2,
            mainPane: { id: 'pane-1', ptyId: 'pty-1' },
            stackPanes: [{ id: 'pane-2', ptyId: 'pty-2' }],
            focusedPaneId: 'pane-1',
          },
        ],
        activeWorkspaceId: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(findWorkspaceIdForPane(session, 'pane-2')).toBe(2);
    });
  });
});
