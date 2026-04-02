/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list (arrow keys; vim mode adds j/k), Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, createMemo, createEffect, onCleanup, createSignal } from 'solid-js';
import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';

// Contexts
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useConfig } from '../contexts/ConfigContext';
import { useLayout } from '../contexts/LayoutContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { useCopyMode } from '../contexts/CopyModeContext';

// Hooks
import {
  useVimMode,
  useEmulatorCache,
  useActivitySubscriptions,
  useSessionDrag,
} from './aggregate/hooks';

// Components
import {
  ListPane,
  PreviewPane,
  SessionTreeNode,
  PtyTreeRow,
  PlaceholderRow,
  InteractivePreview,
  borderStyleMap,
  calculateLayoutDimensions,
  getHintsText,
  getFilterText,
  calculateFooterWidths,
  createAggregateKeyboardHandler,
  createAggregateMouseHandlers,
  findPtyLocation,
  findPaneLocation,
} from './aggregate';

// Utilities
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { useOverlayColors } from './overlay-colors';
import { createCopyModeVimState } from './app/copy-mode-vim';
import { createCopyModeKeyHandler } from './app/copy-mode-keyboard';
import {
  calculateAggregateListViewport,
  getAggregateListScrollOffsetForSelection,
} from './aggregate/list-viewport';
import { truncateHint } from './overlay-hints';
import { loadSessionData, getHostBackgroundColor } from '../effect/bridge';
import { setShimmerEnabled } from '../core/shimmer';
import type { Workspace } from '../core/types';
import { collectPanes } from '../core/layout-tree';
import type { FlattenedTreeItem } from '../contexts/aggregate-view-types';
import {
  resolvePendingAggregatePaneFocus,
  type PendingAggregatePaneFocus,
} from './aggregate/pending-pane-focus';

interface AggregateViewProps {
  width: number;
  height: number;
  onRequestQuit?: () => void;
  onDetach?: () => void;
  onRequestKillPty?: (ptyId: string) => void;
  onToggleCommandPalette?: () => void;
  onToggleConsole?: () => void;
  onVimModeChange?: (mode: 'normal' | 'insert') => void;
}

export function AggregateView(props: AggregateViewProps) {
  // Contexts
  const config = useConfig();
  const keyboard = useKeyboardState();
  const layout = useLayout();
  const session = useSession();
  const terminal = useTerminal();
  const theme = useTheme();
  const selection = useSelection();
  const copyMode = useCopyMode();
  const search = useSearch();

  const {
    state,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    navigateToPrevPty,
    navigateToNextPty,
    setSelectedIndex,
    enterPreviewMode,
    exitPreviewMode,
    selectPty,
    loadSessionPtys,
    toggleSessionExpanded,
    togglePreviewZoom,
    reorderSessions,
    scrollListUp,
    scrollListDown,
    setListScrollOffset,
    setInsertAfterPtyId,
  } = useAggregateView();

  const { state: keyboardState, enterAggregateMode, exitAggregateMode } = keyboard;
  const { state: layoutState, switchWorkspace, focusPane, setLayoutMode } = layout;
  const { state: sessionState, switchSession, togglePicker } = session;
  const {
    findSessionForPty,
    scrollTerminal,
    setScrollOffset,
    isMouseTrackingEnabled,
    getScrollState,
    getEmulatorSync,
    getTerminalStateSync,
    createPaneWithPTY,
    getSessionCwd,
  } = terminal;

  const { foreground: overlayFg, muted: overlayMuted, subtle: overlaySubtle } = useOverlayColors();
  const {
    clearAllSelections,
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    getSelection,
  } = selection;

  // Extracted hooks
  const vim = useVimMode({ isAggregateVisible: () => state.showAggregateView });
  const emulatorCache = useEmulatorCache({ isActive: () => state.showAggregateView });
  const sessionDrag = useSessionDrag();

  // Local state
  const [prefixActive, setPrefixActive] = createSignal(false);
  const [inSearchMode, setInSearchMode] = createSignal(false);
  const [aggregateCopyModeActive, setAggregateCopyModeActive] = createSignal(false);
  const [pendingPaneFocus, setPendingPaneFocus] = createSignal<PendingAggregatePaneFocus | null>(
    null
  );

  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  // Copy mode helpers
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => state.showAggregateView && keyboardState.mode === 'copy',
  });

  // Layout calculations
  const layoutDims = createMemo(() =>
    calculateLayoutDimensions({
      width: props.width,
      height: props.height,
      listPaneRatio: state.previewZoomed ? 0 : undefined,
    })
  );

  const listViewport = createMemo(() =>
    calculateAggregateListViewport({
      totalItems: state.flattenedTree.length,
      maxRows: layoutDims().maxVisibleCards,
      scrollOffset: state.listScrollOffset,
    })
  );

  // Track activity for ALL PTYs in the aggregate view, not just visible viewport rows.
  // This ensures shimmer animation appears correctly when scrolling to a PTY that had
  // output while off-screen or in a collapsed session.
  const trackedActivityPtys = createMemo(() => {
    // Use matchedPtys which contains all PTYs currently in the aggregate view tree
    // (respects filters but includes those scrolled out of view or in collapsed sessions)
    return state.matchedPtys;
  });

  // Subscribe to activity updates for all tracked PTYs to enable shimmer effects.
  // We track all PTYs in the view, not just visible ones, so activity that happens
  // while a PTY is scrolled out of view or in a collapsed session is still recorded.
  const activity = useActivitySubscriptions({
    isActive: () => state.showAggregateView,
    getTrackedPtys: trackedActivityPtys,
  });

  const hostBgColor = createMemo(() => {
    void terminal.hostColorsVersion;
    return getHostBackgroundColor();
  });

  // Helper to get item at mouse position
  const getItemAtListMouse = (event: OpenTUIMouseEvent): FlattenedTreeItem | undefined => {
    const viewport = listViewport();
    const relY = event.y - 1 - (viewport.showTopIndicator ? 1 : 0);
    if (relY < 0 || relY >= viewport.visibleCount) return undefined;
    return state.flattenedTree[viewport.start + relY];
  };

  // Vim mode sync effects
  createEffect(() => {
    if (!state.showAggregateView || !vim.isEnabled()) return;
    if (inSearchMode() || state.previewMode) {
      vim.setMode('normal');
    }
  });

  createEffect(() => {
    props.onVimModeChange?.(vim.mode());
  });

  // Auto-scroll on selection change
  createEffect((prevSelectedIndex?: number) => {
    if (!state.showAggregateView) return state.selectedIndex;
    if (prevSelectedIndex === state.selectedIndex) return state.selectedIndex;

    const nextScrollOffset = getAggregateListScrollOffsetForSelection({
      selectedIndex: state.selectedIndex,
      totalItems: state.flattenedTree.length,
      maxRows: layoutDims().maxVisibleCards,
      scrollOffset: state.listScrollOffset,
    });

    if (nextScrollOffset !== state.listScrollOffset) {
      setListScrollOffset(nextScrollOffset);
    }

    return state.selectedIndex;
  });

  // Copy mode tracking
  createEffect(() => {
    if (
      state.showAggregateView &&
      state.previewMode &&
      keyboardState.mode === 'copy' &&
      state.selectedPtyId &&
      copyMode.isActive(state.selectedPtyId)
    ) {
      setAggregateCopyModeActive(true);
    }
  });

  createEffect(() => {
    if (!aggregateCopyModeActive()) return;

    const activeCopyPtyId = copyMode.getActivePtyId();
    const shouldKeepCopyMode =
      state.showAggregateView &&
      state.previewMode &&
      !!activeCopyPtyId &&
      activeCopyPtyId === state.selectedPtyId;

    if (shouldKeepCopyMode) return;
    exitAggregateCopyMode();
  });

  // Auto-load session PTYs when an unloaded session or its placeholder is selected.
  createEffect(() => {
    if (!state.showAggregateView) return;

    const selectedItem = state.flattenedTree[state.selectedIndex];
    if (!selectedItem) return;

    const sessionId = (() => {
      if (
        selectedItem.node.type === 'session' &&
        selectedItem.node.loadState.status === 'unloaded'
      ) {
        return selectedItem.node.session.id;
      }

      if (
        selectedItem.node.type === 'placeholder' &&
        selectedItem.node.message === '...' &&
        selectedItem.parentSessionId
      ) {
        return selectedItem.parentSessionId;
      }

      return null;
    })();

    if (!sessionId) return;

    const loadState = state.sessionLoadStates.get(sessionId);
    if (loadState?.status === 'unloaded' && !state.loadAttemptedSessionIds.has(sessionId)) {
      loadSessionPtys(sessionId);
    }
  });

  createEffect(() => {
    if (!state.showAggregateView) {
      setPendingPaneFocus(null);
      return;
    }

    const resolution = resolvePendingAggregatePaneFocus({
      pending: pendingPaneFocus(),
      allPtys: state.allPtys,
      flattenedTreeIndex: state.flattenedTreeIndex,
      expandedSessionIds: state.expandedSessionIds,
      filterQuery: state.filterQuery,
    });

    if (resolution.type === 'wait') return;

    if (resolution.type === 'clear-filter') {
      if (state.filterQuery) {
        setFilterQuery('');
      }
      return;
    }

    if (resolution.type === 'expand-session') {
      toggleSessionExpanded(resolution.sessionId);
      return;
    }

    selectPty(resolution.ptyId);
    setPendingPaneFocus(null);
  });

  // Preload emulator for selected PTY
  createEffect(() => {
    if (!state.showAggregateView || !state.selectedPtyId) return;
    void emulatorCache.preload(state.selectedPtyId);
  });

  // Cleanup
  onCleanup(() => {
    if (prefixTimeout) clearTimeout(prefixTimeout);
    sessionDrag.cancelDrag();
    setShimmerEnabled(false);
    activity.sync();
  });

  // Prefix timeout management
  const clearPrefixTimeout = () => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
      prefixTimeout = null;
    }
  };

  const startPrefixTimeout = () => {
    prefixTimeout = setTimeout(() => {
      setPrefixActive(false);
    }, config.keybindings().prefixTimeoutMs);
  };

  // Helpers
  const closeAggregateOverlay = () => {
    closeAggregateView();
    exitAggregateMode();
  };

  const exitAggregateCopyMode = () => {
    copyMode.exitCopyMode();
    setAggregateCopyModeActive(false);
    if (keyboardState.mode === 'copy') {
      keyboard.exitCopyMode();
      if (state.showAggregateView) {
        enterAggregateMode();
      }
    }
  };

  const getAggregateEmulatorSync = (ptyId: string) =>
    emulatorCache.get(ptyId) ?? getEmulatorSync(ptyId);

  const getAggregateTerminalStateSync = (ptyId: string) => {
    const emulator = getAggregateEmulatorSync(ptyId);
    return emulator?.getTerminalState() ?? getTerminalStateSync(ptyId);
  };

  const isAggregateMouseTrackingEnabled = (ptyId: string) => {
    const emulator = getAggregateEmulatorSync(ptyId);
    return emulator?.isMouseTrackingEnabled() ?? isMouseTrackingEnabled(ptyId);
  };

  // Handlers
  const handleListEnter = () => {
    const selectedItem = state.flattenedTree[state.selectedIndex];
    if (!selectedItem) return true;

    if (selectedItem.node.type === 'pty') {
      enterPreviewMode();
      return true;
    }

    if (selectedItem.node.type === 'session' && selectedItem.node.loadState.status === 'loaded') {
      toggleSessionExpanded(selectedItem.node.session.id);
      return true;
    }

    return true;
  };

  const handleEnterSearch = async () => {
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;

    clearAllSelections();
    await search.enterSearchMode(selectedPtyId);
    keyboard.enterSearchMode();
    setInSearchMode(true);
  };

  const handleEnterCopyMode = () => {
    const selectedPtyId = state.selectedPtyId;
    if (!state.previewMode || !selectedPtyId) return;
    clearAllSelections();
    keyboard.enterCopyMode();
    copyMode.enterCopyMode(selectedPtyId, getAggregateTerminalStateSync);
    setAggregateCopyModeActive(true);
  };

  const handleCopyModeKeys = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: exitAggregateCopyMode,
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  // Session drag helpers
  const handleBeginSessionDrag = (sessionId: string) => {
    sessionDrag.beginDrag(sessionId);
  };

  const handleUpdateDragTarget = (event: OpenTUIMouseEvent) => {
    sessionDrag.updateTarget(event, getItemAtListMouse);
  };

  const handleCommitDrag = async () => {
    await sessionDrag.commitDrag(async (sourceId, targetId) => {
      await reorderSessions(sourceId, targetId);
    });
  };

  // Workspace/pane helpers for jump operations
  const getLastPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;

    const paneIds: string[] = [];
    if (workspace.mainPane) {
      for (const pane of collectPanes(workspace.mainPane)) {
        paneIds.push(pane.id);
      }
    }
    for (const stackPane of workspace.stackPanes) {
      for (const pane of collectPanes(stackPane)) {
        paneIds.push(pane.id);
      }
    }

    return paneIds[paneIds.length - 1] ?? workspace.focusedPaneId ?? null;
  };

  const getPreferredPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;
    return workspace.focusedPaneId ?? getLastPaneIdForWorkspace(workspace);
  };

  // Jump to PTY
  const handleJumpToPty = async () => {
    const selectedPtyId = state.selectedPtyId;
    const selectedSessionId = state.selectedSessionId;

    if (selectedPtyId) {
      const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
      if (location) {
        closeAggregateOverlay();
        if (layoutState.activeWorkspaceId !== location.workspaceId) {
          switchWorkspace(location.workspaceId);
        }
        focusPane(location.paneId);
        return true;
      }

      const sessionLocation = findSessionForPty(selectedPtyId);
      if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
        closeAggregateOverlay();
        await switchSession(sessionLocation.sessionId);
        // After switch, try to focus the pane
        const nextLocation = findPaneLocation(sessionLocation.paneId, layoutState.workspaces);
        if (nextLocation) {
          switchWorkspace(nextLocation.workspaceId);
          focusPane(sessionLocation.paneId);
          return true;
        }
        const fallbackPaneId = getPreferredPaneIdForWorkspace(
          layoutState.workspaces[layoutState.activeWorkspaceId]
        );
        if (fallbackPaneId) {
          focusPane(fallbackPaneId);
        }
        return true;
      }
    }

    if (!selectedSessionId) return false;

    if (selectedSessionId === sessionState.activeSessionId) {
      const workspaceId = layoutState.activeWorkspaceId;
      const paneId = getPreferredPaneIdForWorkspace(layoutState.workspaces[workspaceId]);
      closeAggregateOverlay();
      if (paneId) {
        switchWorkspace(workspaceId);
        focusPane(paneId);
      }
      return true;
    }

    // Load session and jump to it
    const sessionData = await loadSessionData(selectedSessionId);
    if (sessionData instanceof Error) {
      console.error('Failed to load session:', sessionData.message);
      return false;
    }

    const workspaceId = sessionData.activeWorkspaceId;
    const paneId = getPreferredPaneIdForWorkspace(sessionData.workspaces[workspaceId]);

    closeAggregateOverlay();
    await switchSession(selectedSessionId);
    switchWorkspace(workspaceId);
    if (paneId) {
      focusPane(paneId);
    }
    return true;
  };

  // New pane in session
  const handleNewPaneInSession = async () => {
    const selectedSessionId = state.selectedSessionId;
    const selectedPtyId = state.selectedPtyId;

    if (!selectedSessionId && !selectedPtyId) return;

    // Set insert position to place new PTY adjacent to selected one
    setInsertAfterPtyId(selectedPtyId);

    const targetSessionId =
      selectedSessionId ??
      findSessionForPty(selectedPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    setPendingPaneFocus(null);

    let targetWorkspaceId = layoutState.activeWorkspaceId;
    let targetCwd: string | undefined;

    // Get CWD from selected PTY if available
    if (selectedPtyId) {
      targetCwd = await getSessionCwd(selectedPtyId).catch(() => undefined);
    }

    if (targetSessionId === sessionState.activeSessionId) {
      // Current session
      if (!targetCwd) {
        const workspace = layoutState.workspaces[layoutState.activeWorkspaceId];
        if (workspace) {
          const livePanes: Array<{ id: string; ptyId?: string }> = [];
          if (workspace.mainPane) {
            livePanes.push(...collectPanes(workspace.mainPane));
          }
          for (const stackPane of workspace.stackPanes) {
            livePanes.push(...collectPanes(stackPane));
          }
          const candidatePane =
            livePanes.find((p) => p.id === workspace.focusedPaneId && !!p.ptyId) ??
            [...livePanes].reverse().find((p) => !!p.ptyId) ??
            null;
          if (candidatePane?.ptyId) {
            targetCwd = await getSessionCwd(candidatePane.ptyId).catch(() => undefined);
          }
        }
      }

      if (selectedPtyId) {
        const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      // Other session - load and switch
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        console.error('Failed to load session:', sessionData.message);
        return;
      }

      targetWorkspaceId = sessionData.activeWorkspaceId;
      if (!targetCwd) {
        const activeWorkspace = sessionData.workspaces[sessionData.activeWorkspaceId];
        const lastPaneId = getLastPaneIdForWorkspace(activeWorkspace);
        if (lastPaneId) {
          targetCwd = sessionData.cwdMap.get(lastPaneId);
        }
      }

      await switchSession(targetSessionId);
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const paneId = await createPaneWithPTY(targetCwd, 'shell');
    if (!paneId) {
      console.error('Failed to create pane in aggregate view');
      return;
    }

    setPendingPaneFocus({ sessionId: targetSessionId, paneId });
  };

  // Keyboard handler
  const keyboardHandler = createAggregateKeyboardHandler({
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getFilterQuery: () => state.filterQuery,
    getSearchState: () => search.searchState,
    getInSearchMode: inSearchMode,
    getCopyModeActive: () =>
      state.previewMode &&
      keyboardState.mode === 'copy' &&
      !!state.selectedPtyId &&
      copyMode.isActive(state.selectedPtyId),
    getPrefixActive: prefixActive,
    getKeybindings: () => config.keybindings(),
    getMatchedCount: () => state.flattenedTree.length,
    getVimEnabled: vim.isEnabled,
    getVimMode: vim.mode,
    setVimMode: vim.setMode,
    getSearchVimMode: () => search.vimMode,
    setSearchVimMode: search.setVimMode,
    getVimHandlers: vim.getHandlers,
    getEmulatorSync: getAggregateEmulatorSync,
    setFilterQuery,
    toggleShowInactive,
    setInSearchMode,
    setPrefixActive,
    setSelectedIndex,
    closeAggregateView,
    navigateUp,
    navigateDown,
    navigateToPrevPty,
    navigateToNextPty,
    enterPreviewMode,
    exitPreviewMode,
    togglePreviewZoom,
    exitAggregateMode,
    exitSearchMode: search.exitSearchMode,
    setSearchQuery: search.setSearchQuery,
    nextMatch: search.nextMatch,
    prevMatch: search.prevMatch,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    handleJumpToPty,
    handleNewPaneInSession,
    handleListEnter,
    onToggleSessionPicker: togglePicker,
    onToggleCommandPalette: props.onToggleCommandPalette,
    onToggleConsole: props.onToggleConsole,
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
    scrollListUp,
    scrollListDown,
    setListScrollOffset,
  });

  // Mouse handlers
  const mouseHandlers = createAggregateMouseHandlers({
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getListPaneWidth: () => layoutDims().listPaneWidth,
    getPreviewInnerWidth: () => layoutDims().previewInnerWidth,
    getPreviewInnerHeight: () => layoutDims().previewInnerHeight,
    isMouseTrackingEnabled: isAggregateMouseTrackingEnabled,
    getScrollState,
    scrollTerminal,
    setScrollOffset,
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    getSelection,
    getEmulatorSync: getAggregateEmulatorSync,
    getTerminalStateSync: getAggregateTerminalStateSync,
  });

  // Cleanup mouse handler state
  onCleanup(() => {
    mouseHandlers.cleanup();
  });

  // Keyboard hook
  useOverlayKeyboardHandler({
    overlay: 'aggregateView',
    isActive: () => state.showAggregateView,
    handler: keyboardHandler.handleKeyDown,
    ignoreRelease: false,
  });

  // Footer text calculations
  const hintsText = () =>
    getHintsText(
      inSearchMode(),
      state.previewMode,
      state.previewZoomed,
      state.previewMode && !!state.selectedPtyId && copyMode.isActive(state.selectedPtyId),
      config.keybindings(),
      state.showInactive,
      vim.isEnabled(),
      vim.mode()
    );

  const filterText = () => getFilterText(state.filterQuery);
  const footerWidths = () => calculateFooterWidths(props.width, filterText(), hintsText());

  return (
    <Show when={state.showAggregateView}>
      <box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: props.width,
          height: props.height,
          flexDirection: 'column',
          zIndex: 100,
        }}
        backgroundColor={hostBgColor()}
      >
        {/* Main content - two panes side by side */}
        <box style={{ flexDirection: 'row', height: layoutDims().contentHeight }}>
          <Show when={!state.previewZoomed}>
            <ListPane
              theme={theme}
              foregroundColor={overlayFg()}
              mutedColor={overlayMuted()}
              subtleColor={overlaySubtle()}
              layout={{
                width: layoutDims().listPaneWidth,
                height: layoutDims().contentHeight,
                innerWidth: layoutDims().listInnerWidth,
                innerHeight: layoutDims().listInnerHeight,
              }}
              viewport={listViewport()}
              flattenedTree={state.flattenedTree}
              selectedIndex={state.selectedIndex}
              activeSessionId={sessionState.activeSessionId}
              draggingSessionId={sessionDrag.draggingId()}
              dragTargetSessionId={sessionDrag.targetId()}
              isPreviewMode={state.previewMode}
              onSelectItem={setSelectedIndex}
              onSelectPty={selectPty}
              onToggleSession={toggleSessionExpanded}
              onBeginSessionDrag={handleBeginSessionDrag}
              onEndSessionDrag={(sessionId) => {
                // Toggle is handled by checking suppressToggle internally
                if (!sessionDrag.suppressToggle()) {
                  toggleSessionExpanded(sessionId);
                }
              }}
              onPlaceholderClick={loadSessionPtys}
              getItemAtMouse={getItemAtListMouse}
              onUpdateDragTarget={handleUpdateDragTarget}
              onCommitDrag={handleCommitDrag}
              onScrollUp={scrollListUp}
              onScrollDown={scrollListDown}
              onExitPreview={exitPreviewMode}
              shimmerTargetColor={hostBgColor()}
              components={{
                SessionTreeNode,
                PtyTreeRow,
                PlaceholderRow,
              }}
            />
          </Show>

          <PreviewPane
            theme={theme}
            width={layoutDims().previewPaneWidth}
            height={layoutDims().contentHeight}
            innerWidth={layoutDims().previewInnerWidth}
            innerHeight={layoutDims().previewInnerHeight}
            isPreviewMode={state.previewMode}
            isZoomed={state.previewZoomed}
            isCopyModeActive={
              state.previewMode && !!state.selectedPtyId && copyMode.isActive(state.selectedPtyId)
            }
            selectedPtyId={state.selectedPtyId}
            offsetX={layoutDims().listPaneWidth + 1}
            offsetY={1}
            mouseHandlers={mouseHandlers}
            onEnterPreview={enterPreviewMode}
            components={{ InteractivePreview }}
          />
        </box>

        {/* Footer status bar */}
        <box style={{ height: 1, flexDirection: 'row' }}>
          <Show
            when={!state.previewMode}
            fallback={
              <>
                <box style={{ width: footerWidths().filterWidth }} />
                <box
                  style={{
                    width: footerWidths().hintsWidth + 2,
                    flexDirection: 'row',
                    justifyContent: 'flex-end',
                  }}
                >
                  <text fg={overlaySubtle()}>
                    {truncateHint(hintsText(), footerWidths().hintsWidth)}
                  </text>
                </box>
              </>
            }
          >
            <box style={{ width: footerWidths().filterWidth }}>
              <text fg={overlayFg()}>{filterText().slice(0, footerWidths().filterWidth)}</text>
            </box>
            <box
              style={{
                width: footerWidths().hintsWidth + 2,
                flexDirection: 'row',
                justifyContent: 'flex-end',
              }}
            >
              <text fg={overlaySubtle()}>
                {truncateHint(hintsText(), footerWidths().hintsWidth)}
              </text>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  );
}
