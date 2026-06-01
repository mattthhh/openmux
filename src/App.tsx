/**
 * Main App component for openmux
 */

import { useTerminalDimensions, useRenderer } from '@opentui/solid';
import {
  useConfig,
  useLayout,
  useKeyboardHandler,
  useKeyboard,
  useOverlays,
  useTerminal,
  useCopyMode,
} from './contexts';
import { useSelection } from './contexts/SelectionContext';
import { useSearch } from './contexts/SearchContext';
import { useSession } from './contexts/SessionContext';
import { useAggregateView } from './contexts/AggregateViewContext';
import { useTitle } from './contexts/TitleContext';
import { useAppActions } from './components/app/app-actions';
import { PaneContainer } from './components';
import { getFocusedPtyId } from './core/workspace-utils';
import { resolveAggregatePreviewPtyId } from './components/aggregate/utils';
import { onShimDetached } from './effect/bridge';
import { createPaneResizeHandlers, createPasteHandler } from './components/app';
import { readFromClipboard } from './effect/bridge';
import { setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { setupKeyboardRouting } from './components/app/keyboard-routing';
import { usePtyCreation } from './components/app/pty-creation';
import { AppOverlays } from './components/app/AppOverlays';
import { getCommandsForContext } from './core/command-palette';
import { createAggregateCommandActionsBridge } from './components/app/aggregate-command-bridge';
import {
  createKittyGraphicsBridge,
  type RendererWithNative,
} from './components/app/kitty-graphics-bridge';
import { createCellMetricsGetter, createPixelResizeTracker } from './components/app/pixel-metrics';
import { setupAppLayoutEffects } from './components/app/layout-effects';
import { setupAppEffects } from './components/app/app-effects';
import { setupControlServer } from './components/app/control-server';
import { AppProviders } from './components/app/AppProviders';
import {
  getCommandPaletteRect,
  getFileOpenerRect,
  getDiffOpenerRect,
  getPaneRenameRect,
  getWorkspaceLabelRect,
  getConfirmationRect,
  getCopyNotificationRect,
  getSearchOverlayRect,
  getSessionPickerRect,
  getTemplateOverlayRect,
} from './components/app/overlay-rects';

function AppContent() {
  const config = useConfig();
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const terminal = useTerminal();
  const session = useSession();
  const titleContext = useTitle();
  const selection = useSelection();
  const search = useSearch();
  const copyMode = useCopyMode();
  const aggregateView = useAggregateView();
  const keyboardState = useKeyboard();
  const { exitSearchMode: keyboardExitSearchMode } = keyboardState;
  const renderer = useRenderer();
  const overlays = useOverlays();

  const getCellMetrics = createCellMetricsGetter(
    renderer as { resolution?: { width: number; height: number } | null },
    width,
    height
  );

  const paneResizeHandlers = createPaneResizeHandlers({
    getPanes: () => layout.panes,
    resizePTY: terminal.resizePTY,
    getCellMetrics,
  });

  const { ensurePixelResize, stopPixelResizePoll } = createPixelResizeTracker({
    getCellMetrics,
    isTerminalInitialized: () => terminal.isInitialized,
    getPaneCount: () => layout.panes.length,
    scheduleResizeAllPanes: paneResizeHandlers.scheduleResizeAllPanes,
  });

  const kittyRenderer = createKittyGraphicsBridge({
    renderer: renderer as unknown as RendererWithNative,
    ensurePixelResize,
    stopPixelResizePoll,
  });

  const getActivePtyId = () => {
    const aggregateState = aggregateView.state;
    if (aggregateState.showAggregateView && aggregateState.previewMode) {
      return (
        resolveAggregatePreviewPtyId({
          selectedPtyId: aggregateState.selectedPtyId,
          selectedIndex: aggregateState.selectedIndex,
          flattenedTree: aggregateState.flattenedTree,
          activeSessionId: session.state.activeSessionId,
          workspaces: layout.state.workspaces,
        }) ?? undefined
      );
    }
    return getFocusedPtyId(layout.activeWorkspace);
  };

  setupControlServer({ layout, terminal, session });

  const { handleNewPane, handleSplitPane } = usePtyCreation({
    layout: {
      get panes() {
        return layout.panes;
      },
      getFocusedPaneId: () => layout.activeWorkspace.focusedPaneId,
    },
    terminal,
    sessionState: session.state,
    newPane: layout.newPane,
    splitPane: layout.splitPane,
  });

  // Aggregate command actions bridge — wires AggregateViewContext methods
  // and AggregateStateManager's onActionsReady callback into a single
  // AggregateCommandActions object for the command palette and opener routing.
  const { actions: aggregateCommandActions, onActionsReady } = createAggregateCommandActionsBridge({
    aggregateView,
    layout,
    terminal,
    session,
    titleContext,
    keyboardState,
    copyMode,
    selection,
    search,
    overlays,
  });

  const appActions = useAppActions({
    config,
    layout,
    terminal,
    session,
    titleContext,
    copyMode,
    selection,
    search,
    keyboardState,
    overlays,
    aggregateState: aggregateView.state,
    aggregateActions: aggregateCommandActions,
    renderer,
    openAggregateView: aggregateView.openAggregateView,
    getActivePtyId,
    handleNewPane,
    handleSplitPane,
  });

  const pasteHandler = createPasteHandler({
    getFocusedPtyId: getActivePtyId,
    exitCopyMode: () => {
      if (keyboardState.state.mode === 'copy') {
        appActions.handleExitCopyMode();
      }
    },
    writeToPTY: terminal.writeToPTY,
  });

  const { setViewport } = layout;
  const { state: sessionState } = session;
  const { setUpdateLabel, confirmationState, handleShimDetached } = overlays;
  const { exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const { clearAllSelections } = selection;
  const { writeToFocused, getFocusedEmulator } = terminal;

  setupAppEffects({
    getWidth: width,
    getHeight: height,
    sessionState,
    session,
    layout,
    search,
    selection,
    aggregateState: aggregateView.state,
    commandPaletteState: overlays.commandPaletteState,
    fileOpenerState: overlays.fileOpenerState,
    diffOpenerState: overlays.diffOpenerState,
    paneRenameState: overlays.paneRenameState,
    workspaceLabelState: overlays.workspaceLabelState,
    confirmationVisible: () => confirmationState().visible,
    kittyRenderer,
    getSessionPickerRect,
    getTemplateOverlayRect,
    getCommandPaletteRect,
    getFileOpenerRect,
    getDiffOpenerRect,
    getPaneRenameRect,
    getWorkspaceLabelRect,
    getSearchOverlayRect,
    getConfirmationRect,
    getCopyNotificationRect,
    renderer,
    pasteHandler,
    setUpdateLabel,
    setClipboardPasteHandler,
    setCopyModeExitCallback: () => {},
    readFromClipboard,
    writeToPTY: terminal.writeToPTY,
    onShimDetached,
    handleShimDetached,
    getFocusedPtyId: getActivePtyId,
    isPtyActive: terminal.isPtyActive,
  });

  const keyboardHandler = useKeyboardHandler(appActions.actions);

  const hasAnyPanes = () =>
    Object.values(layout.state.workspaces).some(
      (workspace) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0)
    );

  setupAppLayoutEffects({
    width,
    height,
    setViewport,
    sessionState,
    hasAnyPanes,
    newPane: layout.newPane,
    ensurePixelResize,
    layout,
    terminal,
    paneResizeHandlers,
    aggregateState: aggregateView.state,
  });

  setupKeyboardRouting({
    config,
    keyboardHandler,
    keyboardExitSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState: () => search.searchState,
    getVimEnabled: () => config.config().keyboard.vimMode === 'overlays',
    getSearchVimMode: appActions.getSearchVimMode,
    setSearchVimMode: appActions.setSearchVimMode,
    getSearchVimHandler: appActions.getSearchVimHandler,
    clearAllSelections,
    getFocusedEmulator,
    writeToFocused,
    scrollToBottom: () => {
      const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
      if (focusedPtyId) terminal.scrollToBottom(focusedPtyId);
    },
    isOverlayActive: () => sessionState.showSessionPicker || session.showTemplateOverlay,
    handleCopyModeKey: appActions.handleCopyModeKey,
  });

  return (
    <box
      style={{
        width: width(),
        height: height(),
        flexDirection: 'column',
      }}
      backgroundColor="transparent"
    >
      <PaneContainer />

      <AppOverlays
        width={width()}
        height={height()}
        commands={getCommandsForContext(aggregateView.state.showAggregateView)}
        onCommandPaletteExecute={appActions.handleCommandPaletteExecute}
        onFileOpenerSelect={appActions.handleFileOpenerSelect}
        onToggleFileOpener={appActions.handleToggleFileOpener}
        onDiffOpenerSelect={appActions.handleDiffOpenerSelect}
        onToggleDiffOpener={appActions.handleToggleDiffOpener}
        onToggleConsole={appActions.actions.onToggleConsole!}
        onAggregateActionsReady={onActionsReady}
      />
    </box>
  );
}

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
