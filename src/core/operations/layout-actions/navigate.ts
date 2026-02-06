/**
 * NAVIGATE action handler
 */

import type { Direction, LayoutNode, Rectangle, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, getCandidateScore, recalculateLayout, updateWorkspace } from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';
import { collectPanes, containsPane, findPane, findSiblingInDirection, getFirstPane } from '../../layout-tree';

function pickBestPaneInNode(
  node: LayoutNode,
  direction: Direction,
  currentRect: Rectangle
): { id: string } | null {
  const panes = collectPanes(node).filter(p => p.rectangle);
  let bestPane: { id: string; rectangle: Rectangle } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of panes) {
    const score = getCandidateScore(currentRect, pane.rectangle!, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane as { id: string; rectangle: Rectangle };
    }
  }

  return bestPane ?? getFirstPane(node);
}

/**
 * Handle NAVIGATE action
 * Moves focus between panes based on geometry
 */
export function handleNavigate(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  const focusedId = workspace.focusedPaneId;
  if (!focusedId) return state;

  const allPanes = getAllWorkspacePanes(workspace).filter(p => p.rectangle);
  if (allPanes.length === 0) return state;

  const currentPane = allPanes.find(p => p.id === focusedId);
  if (!currentPane?.rectangle) return state;

  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, focusedId));
  const focusedRoot = stackIndex >= 0 ? workspace.stackPanes[stackIndex]! : workspace.mainPane;

  if (focusedRoot) {
    const siblingNode = findSiblingInDirection(focusedRoot, focusedId, direction);
    if (siblingNode) {
      const targetPane = pickBestPaneInNode(siblingNode, direction, currentPane.rectangle);
      if (targetPane && targetPane.id !== focusedId) {
        let updated: Workspace = {
          ...workspace,
          focusedPaneId: targetPane.id,
          activeStackIndex: stackIndex >= 0 ? stackIndex : workspace.activeStackIndex,
        };

        if (workspace.zoomed) {
          updated = recalculateLayout(updated, state.viewport, state.config);
          return {
            ...state,
            workspaces: updateWorkspace(state, updated),
            layoutGeometryVersion: state.layoutGeometryVersion + 1,
          };
        }

        return { ...state, workspaces: updateWorkspace(state, updated) };
      }
    }
  }

  const isStackedMode = workspace.layoutMode === 'stacked';
  const stackCount = workspace.stackPanes.length;
  
  // Handle stacked mode navigation with main/stack transitions
  // Uses lastFocusedPaneIds to restore focus when returning to a tab
  if (isStackedMode && (direction === 'west' || direction === 'east')) {
    // west (h) from first stack entry -> navigate to main
    if (direction === 'west' && stackIndex === 0 && workspace.mainPane) {
      // Save current focus in stack entry 0 before leaving
      const newLastFocused = [...workspace.lastFocusedPaneIds];
      newLastFocused[0] = focusedId;

      const mainPane = getFirstPane(workspace.mainPane);
      if (mainPane && mainPane.id !== focusedId) {
        let updated: Workspace = {
          ...workspace,
          focusedPaneId: mainPane.id,
          activeStackIndex: 0,
          lastFocusedPaneIds: newLastFocused,
        };
        if (workspace.zoomed) {
          updated = recalculateLayout(updated, state.viewport, state.config);
        }
        return {
          ...state,
          workspaces: updateWorkspace(state, updated),
          layoutVersion: state.layoutVersion + 1,
          ...(workspace.zoomed && { layoutGeometryVersion: state.layoutGeometryVersion + 1 }),
        };
      }
    }

    // east (l) from main -> navigate to first stack entry
    if (direction === 'east' && stackIndex < 0 && workspace.mainPane && stackCount > 0) {
      // Check if focused is in main
      const mainContainsFocused = workspace.mainPane && containsPane(workspace.mainPane, focusedId);
      if (mainContainsFocused) {
        const targetEntry = workspace.stackPanes[0];
        // Restore last focused pane in stack entry 0, or fall back to first pane
        const lastFocusedInTarget = workspace.lastFocusedPaneIds[0];
        const targetPane = lastFocusedInTarget
          ? (findPane(targetEntry, lastFocusedInTarget) ?? getFirstPane(targetEntry))
          : getFirstPane(targetEntry);

        if (targetPane && targetPane.id !== focusedId) {
          let updated: Workspace = {
            ...workspace,
            focusedPaneId: targetPane.id,
            activeStackIndex: 0,
          };
          if (workspace.zoomed) {
            updated = recalculateLayout(updated, state.viewport, state.config);
          }
          return {
            ...state,
            workspaces: updateWorkspace(state, updated),
            layoutVersion: state.layoutVersion + 1,
            ...(workspace.zoomed && { layoutGeometryVersion: state.layoutGeometryVersion + 1 }),
          };
        }
      }
    }

    // Normal stack tab cycling - save current focus, restore target focus
    if (stackIndex >= 0 && stackCount > 0) {
      const delta = direction === 'west' ? -1 : 1;
      const nextIndex =
        stackCount > 1
          ? (workspace.activeStackIndex + delta + stackCount) % stackCount
          : 0;
      const targetEntry = workspace.stackPanes[nextIndex];

      // Save current focus before switching
      const newLastFocused = [...workspace.lastFocusedPaneIds];
      newLastFocused[stackIndex] = focusedId;

      // Restore last focused pane in target entry, or fall back to first pane
      const lastFocusedInTarget = newLastFocused[nextIndex];
      const targetPane = lastFocusedInTarget
        ? (findPane(targetEntry, lastFocusedInTarget) ?? getFirstPane(targetEntry))
        : getFirstPane(targetEntry);

      if (!targetPane) return state;

      const stackIndexChanged = nextIndex !== workspace.activeStackIndex;
      if (!stackIndexChanged && targetPane.id === focusedId) {
        return state;
      }

      let updated: Workspace = {
        ...workspace,
        focusedPaneId: targetPane.id,
        activeStackIndex: nextIndex,
        lastFocusedPaneIds: newLastFocused,
      };

      if (workspace.zoomed || stackIndexChanged) {
        updated = recalculateLayout(updated, state.viewport, state.config);
        return {
          ...state,
          workspaces: updateWorkspace(state, updated),
          layoutVersion: state.layoutVersion + 1,
          layoutGeometryVersion: state.layoutGeometryVersion + 1,
        };
      }

      return { ...state, workspaces: updateWorkspace(state, updated) };
    }
  }

  let bestPane = currentPane;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of allPanes) {
    if (pane.id === currentPane.id || !pane.rectangle) continue;
    const score = getCandidateScore(currentPane.rectangle, pane.rectangle, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  if (bestPane.id === currentPane.id) return state;

  const targetStackIndex = workspace.stackPanes.findIndex(p => containsPane(p, bestPane.id));
  const activeStackIndex = targetStackIndex >= 0 ? targetStackIndex : workspace.activeStackIndex;
  const stackIndexChanged = activeStackIndex !== workspace.activeStackIndex;

  let updated: Workspace = {
    ...workspace,
    focusedPaneId: bestPane.id,
    activeStackIndex,
  };

  const needsStackedRecalc = workspace.layoutMode === 'stacked' && stackIndexChanged;
  if (workspace.zoomed || needsStackedRecalc) {
    updated = recalculateLayout(updated, state.viewport, state.config);
    return {
      ...state,
      workspaces: updateWorkspace(state, updated),
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}
