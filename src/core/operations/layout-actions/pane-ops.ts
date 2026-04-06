/**
 * Pane operations action handlers.
 * SET_LAYOUT_MODE, SET_PANE_PTY, SET_PANE_TITLE, SWAP_MAIN, MOVE_PANE, TOGGLE_ZOOM
 */

import type {
  Direction,
  LayoutMode,
  LayoutNode,
  PaneData,
  Rectangle,
  Workspace,
} from '../../types';
import type { LayoutState } from './types';
import {
  getActiveWorkspace,
  getCandidateScore,
  recalculateLayout,
  updatePaneProperty,
  updateWorkspace,
} from './helpers';
import { findPaneInWorkspace, getAllWorkspacePanes } from '../master-stack-layout';
import {
  clearNodeRectangles,
  containsPane,
  swapPaneInDirection,
  swapTwoPanesById,
} from '../../layout-tree';

type PaneWithRectangle = PaneData & { rectangle: Rectangle };

type FocusedRoot = {
  root: LayoutNode;
  stackIndex: number;
};

function hasRectangle(pane: PaneData): pane is PaneWithRectangle {
  return pane.rectangle !== undefined;
}

function finalizeMovedWorkspace(state: LayoutState, workspace: Workspace): LayoutState {
  const updated = recalculateLayout(workspace, state.viewport, state.config);
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

function getFocusedRoot(workspace: Workspace, focusedId: string): FocusedRoot | null {
  const stackIndex = workspace.stackPanes.findIndex((pane) => containsPane(pane, focusedId));
  if (stackIndex >= 0) {
    return { root: workspace.stackPanes[stackIndex]!, stackIndex };
  }

  if (!workspace.mainPane) return null;
  return { root: workspace.mainPane, stackIndex: -1 };
}

function tryTreeSwap(
  workspace: Workspace,
  focusedId: string,
  direction: Direction
): Workspace | null {
  const focusedRoot = getFocusedRoot(workspace, focusedId);
  if (!focusedRoot) return null;

  const result = swapPaneInDirection(focusedRoot.root, focusedId, direction);
  if (!result.swapped) return null;

  const clearedNode = clearNodeRectangles(result.node)!;
  if (focusedRoot.stackIndex >= 0) {
    return {
      ...workspace,
      stackPanes: workspace.stackPanes.map((pane, index) =>
        index === focusedRoot.stackIndex ? clearedNode : pane
      ),
      activeStackIndex: focusedRoot.stackIndex,
    };
  }

  return {
    ...workspace,
    mainPane: clearedNode,
  };
}

function findTargetByGeometry(
  workspace: Workspace,
  focusedId: string,
  direction: Direction
): string | null {
  const allPanes = getAllWorkspacePanes(workspace).filter(hasRectangle);
  if (allPanes.length === 0) return null;

  const currentPane = allPanes.find((pane) => pane.id === focusedId);
  if (!currentPane) return null;

  let bestPane = currentPane;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of allPanes) {
    if (pane.id === currentPane.id) continue;

    const score = getCandidateScore(currentPane.rectangle, pane.rectangle, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  return bestPane.id === currentPane.id ? null : bestPane.id;
}

function toSwappablePaneData(pane: PaneData): PaneData {
  return {
    id: pane.id,
    ptyId: pane.ptyId,
    title: pane.title,
  };
}

function executePaneSwap(
  workspace: Workspace,
  focusedId: string,
  targetPaneId: string
): Workspace | null {
  if (!workspace.mainPane) return null;

  const focusedPane = findPaneInWorkspace(workspace, focusedId);
  const targetPane = findPaneInWorkspace(workspace, targetPaneId);
  if (!focusedPane || !targetPane) return null;

  const focusedPaneData = toSwappablePaneData(focusedPane);
  const targetPaneData = toSwappablePaneData(targetPane);
  const mainPane = clearNodeRectangles(
    swapTwoPanesById(workspace.mainPane, focusedId, focusedPaneData, targetPaneId, targetPaneData)
  );
  const stackPanes = workspace.stackPanes.map(
    (pane) =>
      clearNodeRectangles(
        swapTwoPanesById(pane, focusedId, focusedPaneData, targetPaneId, targetPaneData)
      )!
  );
  const targetStackIndex = workspace.stackPanes.findIndex((pane) =>
    containsPane(pane, targetPaneId)
  );

  return {
    ...workspace,
    mainPane,
    stackPanes,
    activeStackIndex: targetStackIndex >= 0 ? targetStackIndex : workspace.activeStackIndex,
  };
}

/**
 * Handle SET_LAYOUT_MODE action
 * Changes the layout mode and recalculates layout
 */
export function handleSetLayoutMode(state: LayoutState, mode: LayoutMode): LayoutState {
  const workspace = getActiveWorkspace(state);
  let updated: Workspace = { ...workspace, layoutMode: mode };
  if (updated.mainPane) {
    updated = recalculateLayout(updated, state.viewport, state.config);
  }
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle SET_PANE_PTY action
 * Associates a PTY with a pane
 */
export function handleSetPanePty(state: LayoutState, paneId: string, ptyId: string): LayoutState {
  const workspace = getActiveWorkspace(state);
  const updated = updatePaneProperty(workspace, paneId, 'ptyId', ptyId);
  return { ...state, workspaces: updateWorkspace(state, updated) };
}

/**
 * Handle SET_PANE_TITLE action
 * Updates the title of a pane
 */
export function handleSetPaneTitle(state: LayoutState, paneId: string, title: string): LayoutState {
  const workspace = getActiveWorkspace(state);
  const updated = updatePaneProperty(workspace, paneId, 'title', title);
  return { ...state, workspaces: updateWorkspace(state, updated) };
}

/**
 * Handle SWAP_MAIN action
 * Swaps the focused stack pane with main pane
 */
export function handleSwapMain(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;
  if (containsPane(workspace.mainPane, workspace.focusedPaneId)) return state;

  const focusedStackIndex = workspace.stackPanes.findIndex((p) =>
    containsPane(p, workspace.focusedPaneId!)
  );
  if (focusedStackIndex === -1) return state;

  const focusedPane = workspace.stackPanes[focusedStackIndex]!;
  const newStack = [...workspace.stackPanes];
  newStack[focusedStackIndex] = workspace.mainPane;

  let updated: Workspace = {
    ...workspace,
    mainPane: focusedPane,
    stackPanes: newStack,
  };

  updated = recalculateLayout(updated, state.viewport, state.config);
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle MOVE_PANE action.
 *
 * Movement follows a two-phase strategy:
 * 1. Try an in-tree swap that preserves the current split structure.
 * 2. Fall back to a geometry-based pane-data swap across trees.
 */
export function handleMovePane(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;

  const treeSwap = tryTreeSwap(workspace, workspace.focusedPaneId, direction);
  if (treeSwap) {
    return finalizeMovedWorkspace(state, treeSwap);
  }

  const targetPaneId = findTargetByGeometry(workspace, workspace.focusedPaneId, direction);
  if (!targetPaneId) return state;

  const geometrySwap = executePaneSwap(workspace, workspace.focusedPaneId, targetPaneId);
  if (!geometrySwap) return state;

  return finalizeMovedWorkspace(state, geometrySwap);
}

/**
 * Handle TOGGLE_ZOOM action
 * Toggles zoom on the focused pane
 */
export function handleToggleZoom(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.focusedPaneId) return state;

  let updated: Workspace = {
    ...workspace,
    zoomed: !workspace.zoomed,
  };

  updated = recalculateLayout(updated, state.viewport, state.config);
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}
