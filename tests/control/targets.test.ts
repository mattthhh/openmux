import { describe, expect, test } from 'bun:test';
import type { Workspace, WorkspaceId } from '../../src/core/types';
import type { LayoutState } from '../../src/core/operations/layout-actions';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { parsePaneSelector, resolvePaneSelector } from '../../src/control/targets';

function createWorkspace(id: WorkspaceId, params: Partial<Workspace>): Workspace {
  return {
    id,
    label: params.label,
    mainPane: params.mainPane ?? null,
    stackPanes: params.stackPanes ?? [],
    focusedPaneId: params.focusedPaneId ?? null,
    activeStackIndex: params.activeStackIndex ?? 0,
    layoutMode: params.layoutMode ?? 'vertical',
    zoomed: params.zoomed ?? false,
  };
}

function createLayoutState(
  workspaces: Record<WorkspaceId, Workspace>,
  activeWorkspaceId: WorkspaceId
): LayoutState {
  return {
    workspaces,
    activeWorkspaceId,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: DEFAULT_CONFIG,
    layoutVersion: 0,
    layoutGeometryVersion: 0,
  };
}

describe('control pane selector', () => {
  test('parses common selectors', () => {
    expect(parsePaneSelector('focused')).toEqual({ ok: true, selector: { type: 'focused' } });
    expect(parsePaneSelector('main')).toEqual({ ok: true, selector: { type: 'main' } });
    expect(parsePaneSelector('stack:2')).toEqual({
      ok: true,
      selector: { type: 'stack', index: 2 },
    });
    expect(parsePaneSelector('pane:abc')).toEqual({
      ok: true,
      selector: { type: 'pane', id: 'abc' },
    });
    expect(parsePaneSelector('pty:xyz')).toEqual({
      ok: true,
      selector: { type: 'pty', id: 'xyz' },
    });
    expect(parsePaneSelector('pane-1')).toEqual({
      ok: true,
      selector: { type: 'pane', id: 'pane-1' },
    });
  });

  test('rejects invalid stack selectors', () => {
    const result = parsePaneSelector('stack:0');
    expect(result.ok).toBe(false);
  });
});

describe('resolvePaneSelector', () => {
  const workspace1 = createWorkspace(1, {
    mainPane: { id: 'pane-1', ptyId: 'pty-1' },
    stackPanes: [
      { id: 'pane-2', ptyId: 'pty-2' },
      { id: 'pane-3', ptyId: 'pty-3' },
    ],
    focusedPaneId: 'pane-2',
    activeStackIndex: 0,
  });
  const workspace2 = createWorkspace(2, {
    mainPane: { id: 'pane-4', ptyId: 'pty-4' },
    focusedPaneId: 'pane-4',
  });

  const layoutState = createLayoutState({ 1: workspace1, 2: workspace2 }, 1);

  test('resolves focused pane', () => {
    const result = resolvePaneSelector({
      selector: { type: 'focused' },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pane.id).toBe('pane-2');
      expect(result.workspaceId).toBe(1);
    }
  });

  test('resolves main pane', () => {
    const result = resolvePaneSelector({
      selector: { type: 'main' },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pane.id).toBe('pane-1');
    }
  });

  test('resolves stack pane by index', () => {
    const result = resolvePaneSelector({
      selector: { type: 'stack', index: 2 },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pane.id).toBe('pane-3');
    }
  });

  test('resolves pane id across workspaces', () => {
    const result = resolvePaneSelector({
      selector: { type: 'pane', id: 'pane-4' },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe(2);
      expect(result.pane.id).toBe('pane-4');
    }
  });

  test('resolves pty id across workspaces', () => {
    const result = resolvePaneSelector({
      selector: { type: 'pty', id: 'pty-4' },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe(2);
      expect(result.pane.id).toBe('pane-4');
    }
  });

  test('returns not_found for missing pane', () => {
    const result = resolvePaneSelector({
      selector: { type: 'pane', id: 'pane-missing' },
      layoutState,
      activeWorkspace: workspace1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('not_found');
    }
  });
});
