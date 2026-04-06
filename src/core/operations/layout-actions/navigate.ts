/**
 * NAVIGATE action handler.
 */

import type { Direction, LayoutNode, PaneData, Rectangle, Workspace } from '../../types';
import type { LayoutState } from './types';
import {
  getActiveWorkspace,
  getCandidateScore,
  recalculateLayout,
  updateWorkspace,
} from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';
import {
  collectPanes,
  containsPane,
  findPane,
  findSiblingInDirection,
  getFirstPane,
} from '../../layout-tree';

type PaneWithRectangle = PaneData & { rectangle: Rectangle };

type NavigationContext = {
  workspace: Workspace;
  direction: Direction;
  focusedId: string;
  currentPane: PaneWithRectangle;
  allPanes: PaneWithRectangle[];
  stackIndex: number;
  focusedRoot: LayoutNode | null;
};

type NavigationCommit = {
  workspace: Workspace;
  recalculate: boolean;
  incrementLayoutVersion: boolean;
  incrementGeometryVersion: boolean;
};

function hasRectangle(pane: PaneData): pane is PaneWithRectangle {
  return pane.rectangle !== undefined;
}

function pickBestPaneInNode(
  node: LayoutNode,
  direction: Direction,
  currentRect: Rectangle
): PaneData | null {
  const panes = collectPanes(node).filter(hasRectangle);
  let bestPane: PaneWithRectangle | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of panes) {
    const score = getCandidateScore(currentRect, pane.rectangle, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  return bestPane ?? getFirstPane(node);
}

function createNavigationContext(
  state: LayoutState,
  direction: Direction
): NavigationContext | null {
  const workspace = getActiveWorkspace(state);
  const focusedId = workspace.focusedPaneId;
  if (!focusedId) return null;

  const allPanes = getAllWorkspacePanes(workspace).filter(hasRectangle);
  if (allPanes.length === 0) return null;

  const currentPane = allPanes.find((pane) => pane.id === focusedId);
  if (!currentPane) return null;

  const stackIndex = workspace.stackPanes.findIndex((pane) => containsPane(pane, focusedId));
  return {
    workspace,
    direction,
    focusedId,
    currentPane,
    allPanes,
    stackIndex,
    focusedRoot: stackIndex >= 0 ? workspace.stackPanes[stackIndex]! : workspace.mainPane,
  };
}

function applyNavigationCommit(state: LayoutState, commit: NavigationCommit): LayoutState {
  const workspace = commit.recalculate
    ? recalculateLayout(commit.workspace, state.viewport, state.config)
    : commit.workspace;

  return {
    ...state,
    workspaces: updateWorkspace(state, workspace),
    layoutVersion: state.layoutVersion + Number(commit.incrementLayoutVersion),
    layoutGeometryVersion: state.layoutGeometryVersion + Number(commit.incrementGeometryVersion),
  };
}

function getRememberedPane(
  node: LayoutNode,
  rememberedPaneId: string | null | undefined
): PaneData | null {
  if (!rememberedPaneId) return getFirstPane(node);
  return findPane(node, rememberedPaneId) ?? getFirstPane(node);
}

function navigateInTree(context: NavigationContext): NavigationCommit | null {
  if (!context.focusedRoot) return null;

  const siblingNode = findSiblingInDirection(
    context.focusedRoot,
    context.focusedId,
    context.direction
  );
  if (!siblingNode) return null;

  const targetPane = pickBestPaneInNode(
    siblingNode,
    context.direction,
    context.currentPane.rectangle
  );
  if (!targetPane || targetPane.id === context.focusedId) return null;

  return {
    workspace: {
      ...context.workspace,
      focusedPaneId: targetPane.id,
      activeStackIndex:
        context.stackIndex >= 0 ? context.stackIndex : context.workspace.activeStackIndex,
    },
    recalculate: context.workspace.zoomed,
    incrementLayoutVersion: false,
    incrementGeometryVersion: context.workspace.zoomed,
  };
}

function navigateStackTab(context: NavigationContext): NavigationCommit | null {
  if (context.workspace.layoutMode !== 'stacked') return null;
  if (context.direction !== 'west' && context.direction !== 'east') return null;

  return (
    navigateFromFirstStackToMain(context) ??
    navigateFromMainToFirstStack(context) ??
    cycleStackTabs(context)
  );
}

function navigateFromFirstStackToMain(context: NavigationContext): NavigationCommit | null {
  if (context.direction !== 'west') return null;
  if (context.stackIndex !== 0 || !context.workspace.mainPane) return null;

  const mainPane = getFirstPane(context.workspace.mainPane);
  if (!mainPane || mainPane.id === context.focusedId) return null;

  const lastFocusedPaneIds = [...context.workspace.lastFocusedPaneIds];
  lastFocusedPaneIds[0] = context.focusedId;

  return {
    workspace: {
      ...context.workspace,
      focusedPaneId: mainPane.id,
      activeStackIndex: 0,
      lastFocusedPaneIds,
    },
    recalculate: context.workspace.zoomed,
    incrementLayoutVersion: true,
    incrementGeometryVersion: context.workspace.zoomed,
  };
}

function navigateFromMainToFirstStack(context: NavigationContext): NavigationCommit | null {
  if (context.direction !== 'east') return null;
  if (context.stackIndex >= 0 || !context.workspace.mainPane) return null;
  if (context.workspace.stackPanes.length === 0) return null;
  if (!containsPane(context.workspace.mainPane, context.focusedId)) return null;

  const targetEntry = context.workspace.stackPanes[0]!;
  const targetPane = getRememberedPane(targetEntry, context.workspace.lastFocusedPaneIds[0]);
  if (!targetPane || targetPane.id === context.focusedId) return null;

  return {
    workspace: {
      ...context.workspace,
      focusedPaneId: targetPane.id,
      activeStackIndex: 0,
    },
    recalculate: context.workspace.zoomed,
    incrementLayoutVersion: true,
    incrementGeometryVersion: context.workspace.zoomed,
  };
}

function cycleStackTabs(context: NavigationContext): NavigationCommit | null {
  const stackCount = context.workspace.stackPanes.length;
  if (context.stackIndex < 0 || stackCount === 0) return null;

  const delta = context.direction === 'west' ? -1 : 1;
  const nextIndex =
    stackCount > 1 ? (context.workspace.activeStackIndex + delta + stackCount) % stackCount : 0;
  const lastFocusedPaneIds = [...context.workspace.lastFocusedPaneIds];
  lastFocusedPaneIds[context.stackIndex] = context.focusedId;

  const targetPane = getRememberedPane(
    context.workspace.stackPanes[nextIndex]!,
    lastFocusedPaneIds[nextIndex]
  );
  if (!targetPane) return null;

  const stackIndexChanged = nextIndex !== context.workspace.activeStackIndex;
  if (!stackIndexChanged && targetPane.id === context.focusedId) return null;

  return {
    workspace: {
      ...context.workspace,
      focusedPaneId: targetPane.id,
      activeStackIndex: nextIndex,
      lastFocusedPaneIds,
    },
    recalculate: context.workspace.zoomed || stackIndexChanged,
    incrementLayoutVersion: stackIndexChanged,
    incrementGeometryVersion: context.workspace.zoomed || stackIndexChanged,
  };
}

function navigateByGeometry(context: NavigationContext): NavigationCommit | null {
  let bestPane = context.currentPane;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of context.allPanes) {
    if (pane.id === context.currentPane.id) continue;

    const score = getCandidateScore(
      context.currentPane.rectangle,
      pane.rectangle,
      context.direction
    );
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  if (bestPane.id === context.currentPane.id) return null;

  const targetStackIndex = context.workspace.stackPanes.findIndex((pane) =>
    containsPane(pane, bestPane.id)
  );
  const activeStackIndex =
    targetStackIndex >= 0 ? targetStackIndex : context.workspace.activeStackIndex;
  const stackIndexChanged = activeStackIndex !== context.workspace.activeStackIndex;
  const needsStackedRecalc = context.workspace.layoutMode === 'stacked' && stackIndexChanged;
  const recalculate = context.workspace.zoomed || needsStackedRecalc;

  return {
    workspace: {
      ...context.workspace,
      focusedPaneId: bestPane.id,
      activeStackIndex,
    },
    recalculate,
    incrementLayoutVersion: recalculate,
    incrementGeometryVersion: recalculate,
  };
}

/**
 * Handle NAVIGATE action.
 *
 * Navigation order matches the Zellij-style interaction model:
 * 1. Move within the current split tree when a directional sibling exists.
 * 2. In stacked mode, interpret west/east as tab transitions when tree navigation fails.
 * 3. Fall back to global geometry-based navigation across visible panes.
 */
export function handleNavigate(state: LayoutState, direction: Direction): LayoutState {
  const context = createNavigationContext(state, direction);
  if (!context) return state;

  const commit =
    navigateInTree(context) ?? navigateStackTab(context) ?? navigateByGeometry(context);
  if (!commit) return state;

  return applyNavigationCommit(state, commit);
}
