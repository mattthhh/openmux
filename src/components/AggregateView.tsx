/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Thin composition root (<100 lines) that delegates to controller components.
 *
 * Controllers:
 * - AggregateKeyboardController: keyboard, vim mode, prefix keys
 * - AggregateMouseController: mouse, drag-drop, selection
 * - AggregateStateManager: session loading, pane creation effects
 *
 * Modes:
 * - List mode: Navigate PTY list (arrow keys; vim mode adds j/k), Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useLayout } from '../contexts/LayoutContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { useCopyMode } from '../contexts/copy-mode';
import { getHostBackgroundColor } from '../effect/bridge';
import { useOverlayColors } from './overlay-colors';
import { createCopyModeKeyHandler } from './app/copy-mode-keyboard';
import { createCopyModeVimState } from './app/copy-mode-vim';
import {
  calculateAggregateListViewport,
  getAggregateListScrollOffsetForSelection,
} from './aggregate/list-viewport';
import {
  calculateLayoutDimensions,
  getHintsText,
  getFilterText,
  calculateFooterWidths,
} from './aggregate';
import { truncateHint } from './overlay-hints';
import {
  ListPane,
  PreviewPane,
  InteractivePreview,
  SessionTreeNode,
  PtyTreeRow,
  PlaceholderRow,
} from './aggregate';
import { ListPaneProvider } from '../contexts/ListPaneContext';
import {
  useVimMode,
  useEmulatorCache,
  useActivitySubscriptions,
  useSessionDrag,
} from './aggregate/hooks';
import {
  AggregateKeyboardController,
  AggregateMouseController,
  AggregateStateManager,
} from './aggregate/controllers';
import { isSavedAggregatePtyId } from '../contexts/aggregate/rows';
import { findLivePtyIdForPane } from './aggregate/utils';

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
  const aggregate = useAggregateView();
  const layout = useLayout();
  const session = useSession();
  const terminal = useTerminal();
  const keyboard = useKeyboard();
  const config = useConfig();
  const theme = useTheme();
  const selection = useSelection();
  const copyMode = useCopyMode();
  const search = useSearch();
  const colors = useOverlayColors();

  const getPreviewableSelectedPtyId = () => {
    const selectedPtyId = aggregate.state.selectedPtyId;
    if (!selectedPtyId) {
      return null;
    }
    if (!isSavedAggregatePtyId(selectedPtyId)) {
      return selectedPtyId;
    }

    const selectedItem = aggregate.state.flattenedTree[aggregate.state.selectedIndex];
    if (
      selectedItem?.node.type !== 'pty' ||
      selectedItem.node.ptyInfo.sessionId !== session.state.activeSessionId
    ) {
      return null;
    }

    const paneId = selectedItem.node.ptyInfo.paneId;
    if (!paneId) {
      return null;
    }

    return findLivePtyIdForPane(paneId, layout.state.workspaces);
  };

  // Hooks
  const vim = useVimMode({ isAggregateVisible: () => aggregate.state.showAggregateView });
  const emulatorCache = useEmulatorCache({
    isActive: () => aggregate.state.showAggregateView,
    getSelectedPtyId: getPreviewableSelectedPtyId,
  });
  const sessionDrag = useSessionDrag();

  // Local UI state
  const [prefixActive, setPrefixActive] = createSignal(false);
  const [inSearchMode, setInSearchMode] = createSignal(false);
  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  // Copy mode helpers
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => aggregate.state.showAggregateView && keyboard.state.mode === 'copy',
  });

  const handleEnterSearch = async () => {
    const ptyId = getPreviewableSelectedPtyId();
    if (!ptyId) return;
    selection.clearAllSelections();
    await search.enterSearchMode(ptyId);
    keyboard.enterSearchMode();
    setInSearchMode(true);
  };

  const handleEnterCopyMode = () => {
    const ptyId = getPreviewableSelectedPtyId();
    if (!aggregate.state.previewMode || !ptyId) return;
    selection.clearAllSelections();
    keyboard.enterCopyMode();
    copyMode.enterCopyMode(
      ptyId,
      (id) => emulatorCache.get(id)?.getTerminalState() ?? terminal.getTerminalStateSync(id)
    );
  };

  const handleCopyModeKeys = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: () => {
      copyMode.exitCopyMode();
      if (keyboard.state.mode === 'copy') {
        keyboard.exitCopyMode();
        if (aggregate.state.showAggregateView) keyboard.enterAggregateMode();
      }
    },
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  // Prefix timeout helpers
  const clearPrefixTimeout = () => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
      prefixTimeout = null;
    }
  };
  const startPrefixTimeout = () => {
    prefixTimeout = setTimeout(() => setPrefixActive(false), config.keybindings().prefixTimeoutMs);
  };

  // Layout calculations
  const layoutDims = createMemo(() =>
    calculateLayoutDimensions({
      width: props.width,
      height: props.height,
      listPaneRatio: aggregate.state.previewZoomed ? 0 : undefined,
    })
  );

  const listViewport = createMemo(() =>
    calculateAggregateListViewport({
      totalItems: aggregate.state.flattenedTree.length,
      maxRows: layoutDims().maxVisibleCards,
      scrollOffset: aggregate.state.listScrollOffset,
    })
  );

  // Activity tracking for shimmer
  const activity = useActivitySubscriptions({
    isActive: () => aggregate.state.showAggregateView,
    getTrackedPtys: () => aggregate.state.matchedPtys,
  });

  // Helper to get item at mouse position
  const getItemAtListMouse = (event: { y: number }) => {
    const viewport = listViewport();
    const relY = event.y - 1 - (viewport.showTopIndicator ? 1 : 0);
    if (relY < 0 || relY >= viewport.visibleCount) return undefined;
    return aggregate.state.flattenedTree[viewport.start + relY];
  };

  createEffect((previousSelectedIndex?: number) => {
    if (!aggregate.state.showAggregateView) return aggregate.state.selectedIndex;
    if (previousSelectedIndex === aggregate.state.selectedIndex)
      return aggregate.state.selectedIndex;

    const nextScrollOffset = getAggregateListScrollOffsetForSelection({
      selectedIndex: aggregate.state.selectedIndex,
      totalItems: aggregate.state.flattenedTree.length,
      maxRows: layoutDims().maxVisibleCards,
      scrollOffset: aggregate.state.listScrollOffset,
    });

    if (nextScrollOffset !== aggregate.state.listScrollOffset) {
      aggregate.setListScrollOffset(nextScrollOffset);
    }

    return aggregate.state.selectedIndex;
  });

  // Emulator helpers
  const getAggregateEmulatorSync = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return null;
    }
    return emulatorCache.get(ptyId) ?? terminal.getEmulatorSync(ptyId);
  };
  const getAggregateTerminalStateSync = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return null;
    }
    return (
      getAggregateEmulatorSync(ptyId)?.getTerminalState() ?? terminal.getTerminalStateSync(ptyId)
    );
  };
  const isAggregateMouseTrackingEnabled = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return false;
    }
    return (
      getAggregateEmulatorSync(ptyId)?.isMouseTrackingEnabled() ??
      terminal.isMouseTrackingEnabled(ptyId)
    );
  };

  // Controllers
  const stateManager = AggregateStateManager({
    isActive: () => aggregate.state.showAggregateView,
    state: aggregate.state,
    selectedPtyId: () => aggregate.state.selectedPtyId,
    selectedSessionId: () => aggregate.state.selectedSessionId,
    previewMode: () => aggregate.state.previewMode,
    selectedIndex: () => aggregate.state.selectedIndex,
    flattenedTree: () => aggregate.state.flattenedTree,
    expandedSessionIds: () => aggregate.state.expandedSessionIds,
    filterQuery: () => aggregate.state.filterQuery,
    pendingPaneCreations: () => aggregate.state.pendingPaneCreations,
    aggregateState: () => ({
      allPtys: aggregate.state.allPtys,
      sessionPaneOrders: aggregate.state.sessionPaneOrders,
      sessionPaneOrderIndex: aggregate.state.sessionPaneOrderIndex,
      pendingPaneCreations: aggregate.state.pendingPaneCreations,
    }),
    loadAttemptedSessionIds: () => aggregate.state.loadAttemptedSessionIds,
    loadSessionPtys: aggregate.loadSessionPtys,
    setFilterQuery: aggregate.setFilterQuery,
    toggleSessionExpanded: aggregate.toggleSessionExpanded,
    selectPty: aggregate.selectPty,
    upsertPendingPaneCreation: aggregate.upsertPendingPaneCreation,
    removePendingPaneCreation: aggregate.removePendingPaneCreation,
    clearPendingPaneCreations: aggregate.clearPendingPaneCreations,
    closeAggregateView: aggregate.closeAggregateView,
    exitAggregateMode: keyboard.exitAggregateMode,
    enterAggregateMode: keyboard.enterAggregateMode,
  });

  const mouseHandlers = AggregateMouseController({
    isActive: () => aggregate.state.showAggregateView,
    getPreviewMode: () => aggregate.state.previewMode,
    getSelectedPtyId: getPreviewableSelectedPtyId,
    getListPaneWidth: () => layoutDims().listPaneWidth,
    getPreviewInnerWidth: () => layoutDims().previewInnerWidth,
    getPreviewInnerHeight: () => layoutDims().previewInnerHeight,
    isMouseTrackingEnabled: isAggregateMouseTrackingEnabled,
    getScrollState: terminal.getScrollState,
    scrollTerminal: terminal.scrollTerminal,
    setScrollOffset: terminal.setScrollOffset,
    startSelection: selection.startSelection,
    updateSelection: selection.updateSelection,
    completeSelection: selection.completeSelection,
    clearSelection: selection.clearSelection,
    getSelection: selection.getSelection,
    getEmulatorSync: getAggregateEmulatorSync,
    getTerminalStateSync: getAggregateTerminalStateSync,
  });

  // Keyboard deps
  const keyboardDeps = {
    getPreviewMode: () => aggregate.state.previewMode,
    getSelectedPtyId: () => aggregate.state.selectedPtyId,
    getFilterQuery: () => aggregate.state.filterQuery,
    getSearchState: () => search.searchState,
    getInSearchMode: () => inSearchMode(),
    getCopyModeActive: () =>
      aggregate.state.previewMode &&
      !!aggregate.state.selectedPtyId &&
      copyMode.isActive(aggregate.state.selectedPtyId),
    getPrefixActive: prefixActive,
    getKeybindings: () => config.keybindings(),
    getMatchedCount: () => aggregate.state.flattenedTree.length,
    getVimEnabled: vim.isEnabled,
    getVimMode: vim.mode,
    setVimMode: vim.setMode,
    getSearchVimMode: () => search.vimMode,
    setSearchVimMode: search.setVimMode,
    getVimHandlers: vim.getHandlers,
    getEmulatorSync: getAggregateEmulatorSync,
    setFilterQuery: aggregate.setFilterQuery,
    toggleShowInactive: aggregate.toggleShowInactive,
    setInSearchMode,
    setPrefixActive,
    setSelectedIndex: aggregate.setSelectedIndex,
    closeAggregateView: aggregate.closeAggregateView,
    navigateUp: aggregate.navigateUp,
    navigateDown: aggregate.navigateDown,
    navigateToPrevPty: aggregate.navigateToPrevPty,
    navigateToNextPty: aggregate.navigateToNextPty,
    enterPreviewMode: aggregate.enterPreviewMode,
    exitPreviewMode: aggregate.exitPreviewMode,
    togglePreviewZoom: aggregate.togglePreviewZoom,
    exitAggregateMode: keyboard.exitAggregateMode,
    exitSearchMode: search.exitSearchMode,
    setSearchQuery: search.setSearchQuery,
    nextMatch: search.nextMatch,
    prevMatch: search.prevMatch,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    handleJumpToPty: stateManager.handleJumpToPty,
    handleNewPaneInSession: stateManager.handleNewPaneInSession,
    handleListEnter: () => {
      const item = aggregate.state.flattenedTree[aggregate.state.selectedIndex];
      if (!item) return true;
      if (item.node.type === 'pty') {
        aggregate.enterPreviewMode();
        return true;
      }
      if (item.node.type === 'session' && item.node.loadState.status === 'loaded') {
        aggregate.toggleSessionExpanded(item.node.session.id);
        return true;
      }
      return true;
    },
    onToggleSessionPicker: session.togglePicker,
    onToggleCommandPalette: props.onToggleCommandPalette,
    onToggleConsole: props.onToggleConsole,
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    onPaste: () => terminal.pasteToFocused(),
    clearPrefixTimeout,
    startPrefixTimeout,
    scrollListUp: aggregate.scrollListUp,
    scrollListDown: aggregate.scrollListDown,
    setListScrollOffset: aggregate.setListScrollOffset,
  };

  // Effects
  AggregateKeyboardController({
    ...keyboardDeps,
    isActive: () => aggregate.state.showAggregateView,
  });

  // Footer text
  const hintsText = () =>
    getHintsText(
      inSearchMode(),
      aggregate.state.previewMode,
      aggregate.state.previewZoomed,
      aggregate.state.previewMode &&
        !!aggregate.state.selectedPtyId &&
        copyMode.isActive(aggregate.state.selectedPtyId),
      config.keybindings(),
      aggregate.state.showInactive,
      vim.isEnabled(),
      vim.mode()
    );
  const filterText = () => getFilterText(aggregate.state.filterQuery);
  const footerWidths = () => calculateFooterWidths(props.width, filterText(), hintsText());
  const hostBgColor = () => {
    void terminal.hostColorsVersion;
    return getHostBackgroundColor();
  };

  return (
    <Show when={aggregate.state.showAggregateView}>
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
        <box style={{ flexDirection: 'row', height: layoutDims().contentHeight }}>
          <Show when={!aggregate.state.previewZoomed}>
            <ListPaneProvider
              layout={{
                width: layoutDims().listPaneWidth,
                height: layoutDims().contentHeight,
                innerWidth: layoutDims().listInnerWidth,
                innerHeight: layoutDims().listInnerHeight,
              }}
              viewport={listViewport()}
              state={{
                flattenedTree: aggregate.state.flattenedTree,
                selectedIndex: aggregate.state.selectedIndex,
                activeSessionId: session.state.activeSessionId,
                draggingSessionId: sessionDrag.draggingId(),
                dragTargetSessionId: sessionDrag.targetId(),
                isPreviewMode: aggregate.state.previewMode,
              }}
              selectionHandlers={{
                onSelectItem: aggregate.setSelectedIndex,
                onSelectPty: aggregate.selectPty,
                onToggleSession: aggregate.toggleSessionExpanded,
              }}
              dragHandlers={{
                onBeginSessionDrag: sessionDrag.beginDrag,
                onEndSessionDrag: (sessionId) => {
                  if (!sessionDrag.suppressToggle()) aggregate.toggleSessionExpanded(sessionId);
                },
                onUpdateDragTarget: (e) =>
                  sessionDrag.updateTarget(
                    e as unknown as import('@opentui/core').MouseEvent,
                    getItemAtListMouse
                  ),
                onCommitDrag: () =>
                  sessionDrag.commitDrag((src, tgt) => aggregate.reorderSessions(src, tgt)),
                getItemAtMouse: getItemAtListMouse,
              }}
              scrollHandlers={{
                onScrollUp: aggregate.scrollListUp,
                onScrollDown: aggregate.scrollListDown,
                onExitPreview: aggregate.exitPreviewMode,
                onPlaceholderClick: () => {},
              }}
              shimmerTargetColor={hostBgColor()}
            >
              <ListPane components={{ SessionTreeNode, PtyTreeRow, PlaceholderRow }} />
            </ListPaneProvider>
          </Show>
          <PreviewPane
            theme={theme}
            width={layoutDims().previewPaneWidth}
            height={layoutDims().contentHeight}
            innerWidth={layoutDims().previewInnerWidth}
            innerHeight={layoutDims().previewInnerHeight}
            isPreviewMode={aggregate.state.previewMode}
            isZoomed={aggregate.state.previewZoomed}
            isCopyModeActive={
              aggregate.state.previewMode &&
              !!aggregate.state.selectedPtyId &&
              copyMode.isActive(aggregate.state.selectedPtyId)
            }
            selectedPtyId={getPreviewableSelectedPtyId()}
            offsetX={layoutDims().listPaneWidth + 1}
            offsetY={1}
            mouseHandlers={mouseHandlers}
            onEnterPreview={aggregate.enterPreviewMode}
            components={{ InteractivePreview }}
          />
        </box>
        <box style={{ height: 1, flexDirection: 'row' }}>
          <Show
            when={!aggregate.state.previewMode}
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
                  <text fg={colors.subtle()}>
                    {truncateHint(hintsText(), footerWidths().hintsWidth)}
                  </text>
                </box>
              </>
            }
          >
            <box style={{ width: footerWidths().filterWidth }}>
              <text fg={colors.foreground()}>
                {filterText().slice(0, footerWidths().filterWidth)}
              </text>
            </box>
            <box
              style={{
                width: footerWidths().hintsWidth + 2,
                flexDirection: 'row',
                justifyContent: 'flex-end',
              }}
            >
              <text fg={colors.subtle()}>
                {truncateHint(hintsText(), footerWidths().hintsWidth)}
              </text>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  );
}
