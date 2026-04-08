/**
 * AggregateView - fullscreen overlay for browsing panes across sessions.
 *
 * This file is the composition root for the overlay. Preview resolution,
 * activity tracking, keyboard routing, and async state transitions live in
 * dedicated hooks and controllers so the aggregate semantics stay consistent.
 */

import { Show, createEffect, createMemo } from 'solid-js';
import type { MouseEvent as OpentuiMouseEvent } from '@opentui/core';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSelection } from '../contexts/SelectionContext';
import { getHostBackgroundColor } from '../effect/bridge';
import { useOverlayColors } from './overlay-colors';
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
import { useSessionDrag } from './aggregate/hooks';
import {
  AggregateKeyboardController,
  AggregateMouseController,
  AggregateStateManager,
} from './aggregate/controllers';

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
  const session = useSession();
  const terminal = useTerminal();
  const config = useConfig();
  const theme = useTheme();
  const selection = useSelection();
  const colors = useOverlayColors();

  // Hooks
  const sessionDrag = useSessionDrag();

  // State manager (handles autoswitch, pane creation, and jump effects)
  const stateManager = AggregateStateManager();

  // Controllers (keyboard controller owns vim, preview support, prefix/copy mode state)
  const kbCtrl = AggregateKeyboardController({
    isActive: () => aggregate.state.showAggregateView,
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    onToggleCommandPalette: props.onToggleCommandPalette,
    onToggleConsole: props.onToggleConsole,
    stateManagerOverrides: {
      handleJumpToPty: stateManager.handleJumpToPty,
      handleNewPaneInSession: stateManager.handleNewPaneInSession,
    },
  });

  createEffect(() => {
    props.onVimModeChange?.(kbCtrl.vimMode());
  });

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

  const mouseHandlers = AggregateMouseController({
    isActive: () => aggregate.state.showAggregateView,
    getPreviewMode: () => aggregate.state.previewMode,
    getSelectedPtyId: kbCtrl.getPreviewableSelectedPtyId,
    getListPaneWidth: () => layoutDims().listPaneWidth,
    getPreviewInnerWidth: () => layoutDims().previewInnerWidth,
    getPreviewInnerHeight: () => layoutDims().previewInnerHeight,
    isMouseTrackingEnabled: kbCtrl.isAggregateMouseTrackingEnabled,
    getScrollState: terminal.getScrollState,
    scrollTerminal: terminal.scrollTerminal,
    setScrollOffset: terminal.setScrollOffset,
    startSelection: selection.startSelection,
    updateSelection: selection.updateSelection,
    completeSelection: selection.completeSelection,
    clearSelection: selection.clearSelection,
    getSelection: selection.getSelection,
    getEmulatorSync: kbCtrl.getAggregateEmulatorSync,
    getTerminalStateSync: kbCtrl.getAggregateTerminalStateSync,
  });

  // Footer text
  const hintsText = () =>
    getHintsText(
      kbCtrl.inSearchMode(),
      aggregate.state.previewMode,
      aggregate.state.previewZoomed,
      kbCtrl.isPreviewCopyModeActive(),
      config.keybindings(),
      aggregate.state.showInactive,
      kbCtrl.vimEnabled(),
      kbCtrl.vimMode()
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
                  sessionDrag.updateTarget(e as unknown as OpentuiMouseEvent, getItemAtListMouse),
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
            isCopyModeActive={kbCtrl.isPreviewCopyModeActive()}
            selectedPtyId={kbCtrl.getPreviewableSelectedPtyId()}
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
