/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list (arrow keys; vim mode adds j/k), Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, For, createSignal, createEffect, onCleanup, createMemo } from 'solid-js';
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
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { getEmulator, getHostBackgroundColor } from '../effect/bridge';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { useOverlayColors } from './overlay-colors';
import { createCopyModeVimState } from './app/copy-mode-vim';
import { createCopyModeKeyHandler } from './app/copy-mode-keyboard';
import {
  PtyCard,
  InteractivePreview,
  findPtyLocation,
  findPaneLocation,
  createAggregateKeyboardHandler,
  createAggregateMouseHandlers,
  borderStyleMap,
  calculateLayoutDimensions,
  getHintsText,
  getFilterText,
  calculateFooterWidths,
} from './aggregate';
import { truncateHint } from './overlay-hints';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';

interface AggregateViewProps {
  width: number;
  height: number;
  onRequestQuit?: () => void;
  onDetach?: () => void;
  onRequestKillPty?: (ptyId: string) => void;
  onVimModeChange?: (mode: VimInputMode) => void;
}

export function AggregateView(props: AggregateViewProps) {
  const config = useConfig();
  const keyboard = useKeyboardState();
  const {
    state,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    setSelectedIndex,
    enterPreviewMode,
    exitPreviewMode,
    selectPty,
  } = useAggregateView();
  const {
    state: keyboardState,
    enterAggregateMode,
    exitAggregateMode,
    enterSearchMode: keyboardEnterSearchMode,
    enterCopyMode: keyboardEnterCopyMode,
    exitCopyMode: keyboardExitCopyMode,
  } = keyboard;
  const { state: layoutState, switchWorkspace, focusPane } = useLayout();
  const { state: sessionState, switchSession } = useSession();
  const terminal = useTerminal();
  const { findSessionForPty, scrollTerminal, isMouseTrackingEnabled, getScrollState, getEmulatorSync, getTerminalStateSync } = terminal;
  const theme = useTheme();
  const { foreground: overlayFg, muted: overlayMuted, subtle: overlaySubtle } = useOverlayColors();
  const { clearAllSelections, startSelection, updateSelection, completeSelection, clearSelection, getSelection } = useSelection();
  const copyMode = useCopyMode();
  // Keep search context to access searchState reactively (it's a getter)
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  const [aggregateCopyModeActive, setAggregateCopyModeActive] = createSignal(false);
  const buildVimHandlers = (timeoutMs: number) => ({
    list: createVimSequenceHandler({
      timeoutMs,
      sequences: [
        { keys: ['j'], action: 'aggregate.list.down' },
        { keys: ['k'], action: 'aggregate.list.up' },
        { keys: ['g', 'g'], action: 'aggregate.list.top' },
        { keys: ['shift+g'], action: 'aggregate.list.bottom' },
        { keys: ['enter'], action: 'aggregate.list.preview' },
        { keys: ['q'], action: 'aggregate.list.close' },
      ],
    }),
    preview: createVimSequenceHandler({
      timeoutMs,
      sequences: [
        { keys: ['q'], action: 'aggregate.preview.exit' },
      ],
    }),
    search: createVimSequenceHandler({
      timeoutMs,
      sequences: [
        { keys: ['n'], action: 'aggregate.search.next' },
        { keys: ['shift+n'], action: 'aggregate.search.prev' },
        { keys: ['enter'], action: 'aggregate.search.confirm' },
        { keys: ['q'], action: 'aggregate.search.cancel' },
      ],
    }),
  });
  let vimHandlers = buildVimHandlers(config.config().keyboard.vimSequenceTimeoutMs);
  const getVimHandlers = () => vimHandlers;
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => state.showAggregateView && keyboardState.mode === 'copy',
  });

  // Track prefix mode for prefix+esc to exit interactive mode
  const [prefixActive, setPrefixActive] = createSignal(false);
  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track pending navigation after session switch
  let pendingPaneNavigation: string | null = null;

  // Track if we're in search mode within aggregate view
  const [inSearchMode, setInSearchMode] = createSignal(false);

  // Cache emulators for selected PTYs so input works across sessions.
  const aggregateEmulators = new Map<string, ITerminalEmulator>();
  const pendingEmulators = new Set<string>();
  let emulatorEpoch = 0;

  const resetAggregateEmulators = () => {
    emulatorEpoch += 1;
    aggregateEmulators.clear();
    pendingEmulators.clear();
  };

  const preloadEmulator = (ptyId: string) => {
    if (aggregateEmulators.has(ptyId) || pendingEmulators.has(ptyId)) return;
    const currentEpoch = emulatorEpoch;
    pendingEmulators.add(ptyId);
    getEmulator(ptyId)
      .then((emulator) => {
        if (!emulator || currentEpoch !== emulatorEpoch) return;
        aggregateEmulators.set(ptyId, emulator);
      })
      .finally(() => {
        pendingEmulators.delete(ptyId);
      });
  };

  // Layout dimensions (memoized)
  const layout = createMemo(() =>
    calculateLayoutDimensions({ width: props.width, height: props.height })
  );

  // Clear prefix timeout on unmount
  onCleanup(() => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
    }
  });

  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs;
    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();
    vimHandlers = buildVimHandlers(timeoutMs);
  });

  createEffect(() => {
    if (!state.showAggregateView) return;
    if (vimEnabled()) {
      setVimMode('normal');
    }
    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();
  });

  createEffect(() => {
    if (!state.showAggregateView || !vimEnabled()) return;
    if (inSearchMode() || state.previewMode) {
      setVimMode('normal');
    }
  });

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

  createEffect(() => {
    props.onVimModeChange?.(vimMode());
  });

  createEffect(() => {
    if (!state.showAggregateView) {
      resetAggregateEmulators();
      return;
    }

    if (state.selectedPtyId) {
      preloadEmulator(state.selectedPtyId);
    }
  });

  // Handle pending navigation after session switch
  createEffect(() => {
    // Track session ID to detect changes
    sessionState.activeSessionId;

    if (!pendingPaneNavigation) return;
    const pendingPaneId = pendingPaneNavigation;

    // Clear the pending navigation
    pendingPaneNavigation = null;

    // Find the workspace containing this pane in the current (newly loaded) workspaces
    const paneLocation = findPaneLocation(pendingPaneId, layoutState.workspaces);
    if (paneLocation) {
      switchWorkspace(paneLocation.workspaceId);
    }
    focusPane(pendingPaneId);
  });

  // Jump to the selected PTY's workspace and pane (supports cross-session jumps)
  const handleJumpToPty = async () => {
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return false;

    // Close aggregate view first
    closeAggregateView();
    exitAggregateMode();

    // First, check if PTY is in the current session
    const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
    if (location) {
      // PTY is in current session - navigate to it
      if (layoutState.activeWorkspaceId !== location.workspaceId) {
        switchWorkspace(location.workspaceId);
      }
      focusPane(location.paneId);
      return true;
    }

    // PTY not in current session - check if it's in another session
    const sessionLocation = findSessionForPty(selectedPtyId);
    if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
      // Store the target pane ID for navigation after session loads
      pendingPaneNavigation = sessionLocation.paneId;

      // Switch to the other session - the effect will handle navigation after load
      await switchSession(sessionLocation.sessionId);

      return true;
    }

    return false;
  };

  // Helper to enter search mode for the selected PTY
  const handleEnterSearch = async () => {
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;

    // Clear any existing selection
    clearAllSelections();

    // Enter search mode for the selected PTY
    await enterSearchMode(selectedPtyId);
    keyboardEnterSearchMode();
    setInSearchMode(true);
  };

  const exitAggregateCopyMode = () => {
    copyMode.exitCopyMode();
    setAggregateCopyModeActive(false);
    if (keyboardState.mode === 'copy') {
      keyboardExitCopyMode();
      if (state.showAggregateView) {
        enterAggregateMode();
      }
    }
  };

  const handleEnterCopyMode = () => {
    const selectedPtyId = state.selectedPtyId;
    if (!state.previewMode || !selectedPtyId) return;
    clearAllSelections();
    keyboardEnterCopyMode();
    copyMode.enterCopyMode(selectedPtyId);
    setAggregateCopyModeActive(true);
  };

  const handleCopyModeKeys = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: exitAggregateCopyMode,
    getVimHandler: copyModeVimState.getCopyVimHandler,
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

  const getAggregateEmulatorSync = (ptyId: string) =>
    aggregateEmulators.get(ptyId) ?? getEmulatorSync(ptyId);

  const getAggregateTerminalStateSync = (ptyId: string) => {
    const emulator = getAggregateEmulatorSync(ptyId);
    return emulator?.getTerminalState() ?? getTerminalStateSync(ptyId);
  };

  const isAggregateMouseTrackingEnabled = (ptyId: string) => {
    const emulator = getAggregateEmulatorSync(ptyId);
    return emulator?.isMouseTrackingEnabled() ?? isMouseTrackingEnabled(ptyId);
  };

  // Create keyboard handler using factory
  const keyboardHandler = createAggregateKeyboardHandler({
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getFilterQuery: () => state.filterQuery,
    getSearchState: () => search.searchState,
    getInSearchMode: inSearchMode,
    getCopyModeActive: () => (
      state.previewMode &&
      keyboardState.mode === 'copy' &&
      !!state.selectedPtyId &&
      copyMode.isActive(state.selectedPtyId)
    ),
    getPrefixActive: prefixActive,
    getKeybindings: () => config.keybindings(),
    getMatchedCount: () => state.matchedPtys.length,
    getVimEnabled: vimEnabled,
    getVimMode: vimMode,
    setVimMode,
    getSearchVimMode: () => search.vimMode,
    setSearchVimMode: search.setVimMode,
    getVimHandlers,
    getEmulatorSync: getAggregateEmulatorSync,
    setFilterQuery,
    toggleShowInactive,
    setInSearchMode,
    setPrefixActive,
    setSelectedIndex,
    closeAggregateView,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
    exitAggregateMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    handleJumpToPty,
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
  });

  // Create mouse handlers using factory (uses shared terminal-mouse-handler)
  const mouseHandlers = createAggregateMouseHandlers({
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getListPaneWidth: () => layout().listPaneWidth,
    getPreviewInnerWidth: () => layout().previewInnerWidth,
    getPreviewInnerHeight: () => layout().previewInnerHeight,
    isMouseTrackingEnabled: isAggregateMouseTrackingEnabled,
    getScrollState,
    scrollTerminal,
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    getSelection,
    getEmulatorSync: getAggregateEmulatorSync,
    getTerminalStateSync: getAggregateTerminalStateSync,
  });

  // Cleanup mouse handler state (auto-scroll intervals, pending selection) on unmount
  onCleanup(() => {
    mouseHandlers.cleanup();
  });

  useOverlayKeyboardHandler({
    overlay: 'aggregateView',
    isActive: () => state.showAggregateView,
    handler: keyboardHandler.handleKeyDown,
    ignoreRelease: false,
  });

  // Get host terminal background color to match user's theme
  const hostBgColor = createMemo(() => {
    void terminal.hostColorsVersion;
    return getHostBackgroundColor();
  });

  // Build hints text based on mode
  const hintsText = () => getHintsText(
    inSearchMode(),
    state.previewMode,
    state.previewMode && !!state.selectedPtyId && copyMode.isActive(state.selectedPtyId),
    config.keybindings(),
    state.showInactive,
    vimEnabled(),
    vimMode()
  );

  // Build search/filter text
  const filterText = () => getFilterText(state.filterQuery);

  // Calculate footer widths
  const footerWidths = () => calculateFooterWidths(props.width, filterText(), hintsText());
  const previewBorderColor = () => {
    if (!state.previewMode) return theme.pane.borderColor;
    if (state.selectedPtyId && copyMode.isActive(state.selectedPtyId)) {
      return theme.pane.copyModeBorderColor;
    }
    return theme.pane.focusedBorderColor;
  };

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
        <box style={{ flexDirection: 'row', height: layout().contentHeight }}>
          {/* Left pane - PTY list (bordered, highlighted when in list mode) */}
          <box
            style={{
              width: layout().listPaneWidth,
              height: layout().contentHeight,
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: state.previewMode ? theme.pane.borderColor : theme.pane.focusedBorderColor,
            }}
            title={` PTYs (${state.matchedPtys.length}) `}
            titleAlignment="left"
            onMouseDown={(e: { preventDefault: () => void }) => {
              e.preventDefault();
              // Clicking on list pane exits preview mode
              if (state.previewMode) {
                exitPreviewMode();
              }
            }}
          >
            <box style={{ flexDirection: 'column' }}>
              <Show
                when={state.matchedPtys.length > 0}
                fallback={
                  <box style={{ height: layout().listInnerHeight, justifyContent: 'center', alignItems: 'center' }}>
                    <text fg={overlaySubtle()}>No PTYs match filter</text>
                  </box>
                }
              >
                <For each={state.matchedPtys.slice(0, layout().maxVisibleCards)}>
                  {(pty, index) => (
                    <PtyCard
                      pty={pty}
                      isSelected={index() === state.selectedIndex}
                      maxWidth={layout().listInnerWidth}
                      index={index()}
                      totalCount={state.matchedPtys.length}
                      aggregateTheme={theme.ui.aggregate}
                      textColors={{
                        foreground: overlayFg(),
                        muted: overlayMuted(),
                        subtle: overlaySubtle(),
                      }}
                      onClick={() => {
                        // Select this PTY and exit preview mode if active
                        selectPty(pty.ptyId);
                        if (state.previewMode) {
                          exitPreviewMode();
                        }
                      }}
                    />
                  )}
                </For>
              </Show>
            </box>
          </box>

          {/* Right pane - Terminal preview (bordered, with mouse support) */}
          <box
            style={{
              width: layout().previewPaneWidth,
              height: layout().contentHeight,
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: previewBorderColor(),
            }}
            onMouseDown={(e: Parameters<typeof mouseHandlers.handlePreviewMouseDown>[0]) => {
              // Click on preview enters preview mode if not already in it
              if (!state.previewMode) {
                e.preventDefault();
                enterPreviewMode();
                return;
              }
              mouseHandlers.handlePreviewMouseDown(e);
            }}
            onMouseUp={mouseHandlers.handlePreviewMouseUp}
            onMouseMove={mouseHandlers.handlePreviewMouseMove}
            onMouseDrag={mouseHandlers.handlePreviewMouseDrag}
            onMouseScroll={mouseHandlers.handlePreviewMouseScroll}
          >
            <InteractivePreview
              ptyId={state.selectedPtyId}
              width={layout().previewInnerWidth}
              height={layout().previewInnerHeight}
              isInteractive={state.previewMode}
              offsetX={layout().listPaneWidth + 1}
              offsetY={1}
            />
          </box>
        </box>

        {/* Footer status bar - search on left, hints on right */}
        <box style={{ height: 1, flexDirection: 'row' }}>
          <box style={{ width: footerWidths().filterWidth }}>
            <text fg={overlayFg()}>{filterText().slice(0, footerWidths().filterWidth)}</text>
          </box>
          <box style={{ width: footerWidths().hintsWidth + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <text fg={overlaySubtle()}>{truncateHint(hintsText(), footerWidths().hintsWidth)}</text>
          </box>
        </box>
      </box>
    </Show>
  );
}
