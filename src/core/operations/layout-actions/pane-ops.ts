/**
 * Pane operations action handlers
 * SET_LAYOUT_MODE, SET_PANE_PTY, SET_PANE_TITLE, SWAP_MAIN, MOVE_PANE, TOGGLE_ZOOM
 */

import type { Direction, LayoutMode, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, getCandidateScore, recalculateLayout, updateWorkspace } from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';
import {
  clearNodeRectangles,
  cloneLayoutNode,
  containsPane,
  findPane,
  isSplitNode,
  swapPaneInDirection,
  swapTwoPanesById,
  updatePaneInNode,
} from '../../layout-tree';

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

  let updated: Workspace = workspace;

  if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
    updated = {
      ...workspace,
      mainPane: updatePaneInNode(workspace.mainPane, paneId, pane => ({ ...pane, ptyId })),
    };
  } else {
    updated = {
      ...workspace,
      stackPanes: workspace.stackPanes.map((pane) =>
        containsPane(pane, paneId)
          ? updatePaneInNode(pane, paneId, target => ({ ...target, ptyId }))
          : pane
      ),
    };
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}

/**
 * Handle SET_PANE_TITLE action
 * Updates the title of a pane
 */
export function handleSetPaneTitle(state: LayoutState, paneId: string, title: string): LayoutState {
  const workspace = getActiveWorkspace(state);

  let updated: Workspace = workspace;

  if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
    updated = {
      ...workspace,
      mainPane: updatePaneInNode(workspace.mainPane, paneId, pane => ({ ...pane, title })),
    };
  } else {
    updated = {
      ...workspace,
      stackPanes: workspace.stackPanes.map((pane) =>
        containsPane(pane, paneId)
          ? updatePaneInNode(pane, paneId, target => ({ ...target, title }))
          : pane
      ),
    };
  }

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

  const focusedStackIndex = workspace.stackPanes.findIndex(
    p => containsPane(p, workspace.focusedPaneId!)
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
 * Handle MOVE_PANE action
 * Moves the focused pane in the given direction using layout-tree aware logic:
 * 1. First tries within-tree swap using split direction
 * 2. Falls back to geometry-based swap with nearest pane in direction
 */
export function handleMovePane(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;

  const focusedId = workspace.focusedPaneId;
  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, focusedId));
  const focusedRoot = stackIndex >= 0 ? workspace.stackPanes[stackIndex]! : workspace.mainPane;

  // Step 1: Try within-tree swap using split direction
  if (focusedRoot) {
    const result = swapPaneInDirection(focusedRoot, focusedId, direction);
    if (result.swapped) {
      let updated: Workspace;
      if (stackIndex >= 0) {
        // Clear rectangles to ensure fresh layout calculation and proper re-renders
        const clearedNode = clearNodeRectangles(result.node)!;
        const newStack = workspace.stackPanes.map((pane, index) =>
          index === stackIndex ? clearedNode : pane
        );
        updated = {
          ...workspace,
          stackPanes: newStack,
          activeStackIndex: stackIndex,
        };
      } else {
        // Clear rectangles to ensure fresh layout calculation and proper re-renders
        const clearedMain = clearNodeRectangles(result.node)!;
        updated = {
          ...workspace,
          mainPane: clearedMain,
        };
      }

      updated = recalculateLayout(updated, state.viewport, state.config);
      return {
        ...state,
        workspaces: updateWorkspace(state, updated),
        layoutVersion: state.layoutVersion + 1,
        layoutGeometryVersion: state.layoutGeometryVersion + 1,
      };
    }
  }

  // Step 2: Handle stacked mode tab reordering with h/l keys
  // In stacked mode, h/l always navigate between tabs (reorder stack entries)
  // This works regardless of whether the focused pane is at root or inside a split tree
  if (workspace.layoutMode === 'stacked' && stackIndex >= 0) {
    // h/l navigate between stack tabs:
    // - west (h) = move left to previous tab (lower index) or swap with main if at index 0
    // - east (l) = move right to next tab (higher index)
    // j/k fall through to geometric swap for within-tree navigation

    if (direction === 'west') {
      if (stackIndex === 0 && workspace.mainPane) {
        // Move from first stack entry to main (swap with main)
        // This matches the expected behavior: h moves from stack to main
        // Clone entire trees to ensure all children are properly swapped
        const focusedEntry = cloneLayoutNode(workspace.stackPanes[0]!)!;
        const mainEntry = cloneLayoutNode(workspace.mainPane)!;
        const newStack = [...workspace.stackPanes];
        newStack[0] = mainEntry;

        let updated: Workspace = {
          ...workspace,
          mainPane: focusedEntry,
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

      if (stackIndex > 0) {
        // Move stack entry left (h key moves to previous tab)
        // Clone entire trees to ensure all children are properly swapped
        const entry1 = cloneLayoutNode(workspace.stackPanes[stackIndex]!)!;
        const entry2 = cloneLayoutNode(workspace.stackPanes[stackIndex - 1]!)!;
        const newStack = [...workspace.stackPanes];
        newStack[stackIndex] = entry2;
        newStack[stackIndex - 1] = entry1;

        let updated: Workspace = {
          ...workspace,
          stackPanes: newStack,
          activeStackIndex: stackIndex - 1,
        };

        updated = recalculateLayout(updated, state.viewport, state.config);
        return {
          ...state,
          workspaces: updateWorkspace(state, updated),
          layoutVersion: state.layoutVersion + 1,
          layoutGeometryVersion: state.layoutGeometryVersion + 1,
        };
      }
    }

    if (direction === 'east' && stackIndex < workspace.stackPanes.length - 1) {
      // Move stack entry right (l key moves to next tab)
      // Clone entire trees to ensure all children are properly swapped
      const entry1 = cloneLayoutNode(workspace.stackPanes[stackIndex]!)!;
      const entry2 = cloneLayoutNode(workspace.stackPanes[stackIndex + 1]!)!;
      const newStack = [...workspace.stackPanes];
      newStack[stackIndex] = entry2;
      newStack[stackIndex + 1] = entry1;

      let updated: Workspace = {
        ...workspace,
        stackPanes: newStack,
        activeStackIndex: stackIndex + 1,
      };

      updated = recalculateLayout(updated, state.viewport, state.config);
      return {
        ...state,
        workspaces: updateWorkspace(state, updated),
        layoutVersion: state.layoutVersion + 1,
        layoutGeometryVersion: state.layoutGeometryVersion + 1,
      };
    }

    // In stacked mode, north/south don't make sense for stack entries
    // (they're all full-height tabs), so return unchanged for those directions
    return state;
  }

  // Step 2b: Handle main->stack swap in stacked mode
  // When focused pane is in main and user presses east (l), swap entire main tree with first stack entry
  // Note: west (h) from main shouldn't do anything - master is always on the left/top
  if (workspace.layoutMode === 'stacked' && stackIndex < 0 && direction === 'east' && workspace.mainPane && workspace.stackPanes.length > 0) {
    // Check if focused pane is at the ROOT level of main
    // Root level means: mainPane itself (if simple), OR immediate child of mainPane (first/second)
    const mainPane = workspace.mainPane;
    let isRootLevelPane = false;
    
    if (!isSplitNode(mainPane)) {
      // Simple pane - check if it's the main pane itself
      isRootLevelPane = mainPane.id === focusedId;
    } else {
      // Split pane - check if focusedId is exactly first or second (immediate children only)
      isRootLevelPane = mainPane.first.id === focusedId || mainPane.second.id === focusedId;
    }
    
    if (isRootLevelPane) {
      // Swap entire main tree with first stack entry
      const mainTree = cloneLayoutNode(mainPane)!;
      const stackTree = cloneLayoutNode(workspace.stackPanes[0]!)!;
      const newStack = [...workspace.stackPanes];
      newStack[0] = mainTree;

      let updated: Workspace = {
        ...workspace,
        mainPane: stackTree,
        stackPanes: newStack,
        activeStackIndex: 0,
      };

      updated = recalculateLayout(updated, state.viewport, state.config);
      return {
        ...state,
        workspaces: updateWorkspace(state, updated),
        layoutVersion: state.layoutVersion + 1,
        layoutGeometryVersion: state.layoutGeometryVersion + 1,
      };
    }
  }

  // Step 3: Geometry-based cross-tree swap
  const allPanes = getAllWorkspacePanes(workspace).filter(p => p.rectangle);
  if (allPanes.length === 0) return state;

  const currentPane = allPanes.find(p => p.id === focusedId);
  if (!currentPane?.rectangle) return state;

  // Find best target pane in the direction using geometry
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

  // No valid target found
  if (bestPane.id === currentPane.id) return state;

  // Find the pane data objects for swapping
  const focusedPaneData = workspace.mainPane
    ? findPane(workspace.mainPane, focusedId) ??
      workspace.stackPanes.reduce<ReturnType<typeof findPane>>(
        (found, node) => found ?? findPane(node, focusedId),
        null
      )
    : null;

  const targetPaneData = workspace.mainPane
    ? findPane(workspace.mainPane, bestPane.id) ??
      workspace.stackPanes.reduce<ReturnType<typeof findPane>>(
        (found, node) => found ?? findPane(node, bestPane.id),
        null
      )
    : null;

  if (!focusedPaneData || !targetPaneData) return state;

  // Prepare pane data for swapping (without rectangle - will be recalculated)
  const pane1Data = { id: focusedPaneData.id, ptyId: focusedPaneData.ptyId, title: focusedPaneData.title };
  const pane2Data = { id: targetPaneData.id, ptyId: targetPaneData.ptyId, title: targetPaneData.title };

  // Swap both panes in a single pass through all trees
  // This handles both same-tree and cross-tree swaps correctly
  const newMainPane = swapTwoPanesById(workspace.mainPane, focusedId, pane1Data, bestPane.id, pane2Data);
  const newStackPanes = workspace.stackPanes.map(node =>
    swapTwoPanesById(node, focusedId, pane1Data, bestPane.id, pane2Data)
  );

  // Update activeStackIndex if target is in a different stack entry
  const targetStackIndex = workspace.stackPanes.findIndex(p => containsPane(p, bestPane.id));
  const newActiveStackIndex = targetStackIndex >= 0 ? targetStackIndex : workspace.activeStackIndex;

  // Clear rectangles from all nodes to ensure fresh layout calculation and proper re-renders
  // This prevents the structural sharing optimization from returning the same object reference
  const clearedMainPane = newMainPane ? clearNodeRectangles(newMainPane) : newMainPane;
  const clearedStackPanes = newStackPanes.map(p => clearNodeRectangles(p)!);

  let updated: Workspace = {
    ...workspace,
    mainPane: clearedMainPane,
    stackPanes: clearedStackPanes,
    activeStackIndex: newActiveStackIndex,
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
