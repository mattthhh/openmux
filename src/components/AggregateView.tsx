/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list (arrow keys; vim mode adds j/k), Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, For, createSignal, createEffect, onCleanup, createMemo } from 'solid-js';
import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
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
import { getEmulator, getHostBackgroundColor, loadSessionData, subscribeUnifiedToPty } from '../effect/bridge';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { useOverlayColors } from './overlay-colors';
import { createCopyModeVimState } from './app/copy-mode-vim';
import { createCopyModeKeyHandler } from './app/copy-mode-keyboard';
import {
  PtyCard,
  SessionTreeNode,
  PtyTreeRow,
  PlaceholderRow,
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
import type { FlattenedTreeItem, TreeNode } from '../contexts/aggregate-view-types';
import { truncateHint } from './overlay-hints';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import { setShimmerEnabled, recordPtyStdoutActivity, clearPtyStdoutActivity } from '../core/shimmer';
import type { Workspace, WorkspaceId } from '../core/types';
import { collectPanes } from '../core/layout-tree';

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
    loadSessionPtys,
    toggleSessionExpanded,
    reorderSessions,
  } = useAggregateView();
  const {
    state: keyboardState,
    enterAggregateMode,
    exitAggregateMode,
    enterSearchMode: keyboardEnterSearchMode,
    enterCopyMode: keyboardEnterCopyMode,
    exitCopyMode: keyboardExitCopyMode,
  } = keyboard;
  const { state: layoutState, switchWorkspace, focusPane, setLayoutMode } = useLayout();
  const { state: sessionState, switchSession } = useSession();
  const terminal = useTerminal();
  const {
    findSessionForPty,
    scrollTerminal,
    isMouseTrackingEnabled,
    getScrollState,
    getEmulatorSync,
    getTerminalStateSync,
    createPaneWithPTY,
    getSessionCwd,
  } = terminal;
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
        { keys: ['n'], action: 'aggregate.list.new.pane' },
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

  // Track if we're in search mode within aggregate view
  const [inSearchMode, setInSearchMode] = createSignal(false);

  // Session drag-and-drop ordering state
  const [draggingSessionId, setDraggingSessionId] = createSignal<string | null>(null);
  const [dragTargetSessionId, setDragTargetSessionId] = createSignal<string | null>(null);
  const [didDragSession, setDidDragSession] = createSignal(false);
  const [suppressSessionToggle, setSuppressSessionToggle] = createSignal(false);

  // Cache emulators for selected PTYs so input works across sessions.
  const aggregateEmulators = new Map<string, ITerminalEmulator>();
  const activitySubscriptions = new Map<string, () => void>();
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

  const syncActivitySubscriptions = () => {
    if (!state.showAggregateView) {
      for (const [ptyId, unsubscribe] of activitySubscriptions) {
        unsubscribe();
        clearPtyStdoutActivity(ptyId);
      }
      activitySubscriptions.clear();
      return;
    }

    const nextPtyIds = new Set(state.allPtys.map((pty) => pty.ptyId));

    for (const [ptyId, unsubscribe] of activitySubscriptions) {
      if (!nextPtyIds.has(ptyId)) {
        unsubscribe();
        activitySubscriptions.delete(ptyId);
        clearPtyStdoutActivity(ptyId);
      }
    }

    for (const ptyId of nextPtyIds) {
      if (activitySubscriptions.has(ptyId)) continue;

      let seenInitialUpdate = false;
      void subscribeUnifiedToPty(ptyId, (update) => {
        if (!seenInitialUpdate) {
          seenInitialUpdate = true;
          return;
        }

        const hasStdoutActivity = update.terminalUpdate.dirtyRows.size > 0;
        if (hasStdoutActivity) {
          recordPtyStdoutActivity(ptyId);
        }
      }).then((unsubscribe) => {
        if (!state.showAggregateView || !nextPtyIds.has(ptyId)) {
          unsubscribe();
          clearPtyStdoutActivity(ptyId);
          return;
        }
        activitySubscriptions.set(ptyId, unsubscribe);
      }).catch(() => {
        clearPtyStdoutActivity(ptyId);
      });
    }
  };

  // Layout dimensions (memoized)
  const layout = createMemo(() =>
    calculateLayoutDimensions({ width: props.width, height: props.height })
  );

  const visibleListStart = createMemo(() => {
    const maxRows = layout().maxVisibleCards;
    const totalRows = state.flattenedTree.length;

    if (maxRows <= 0 || totalRows <= maxRows) {
      return 0;
    }

    const centeredStart = state.selectedIndex - Math.floor(maxRows / 2);
    return Math.max(0, Math.min(centeredStart, totalRows - maxRows));
  });

  const visibleItems = createMemo(() => {
    const start = visibleListStart();
    const end = start + layout().maxVisibleCards;
    return state.flattenedTree.slice(start, end);
  });

  const getSessionIdForItem = (item: FlattenedTreeItem | undefined): string | null => {
    if (!item) return null;
    if (item.node.type === 'session') return item.node.session.id;
    if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
    if (item.node.type === 'placeholder') return item.node.parentSessionId;
    return null;
  };

  const getItemAtListMouse = (event: OpenTUIMouseEvent): FlattenedTreeItem | undefined => {
    const relY = event.y - 1;
    if (relY < 0) return undefined;
    return visibleItems()[relY];
  };

  const beginSessionDrag = (sessionId: string) => {
    setDraggingSessionId(sessionId);
    setDragTargetSessionId(sessionId);
    setDidDragSession(false);
    setSuppressSessionToggle(false);
  };

  const clearSessionDrag = () => {
    setDraggingSessionId(null);
    setDragTargetSessionId(null);
    setDidDragSession(false);
  };

  const updateSessionDragTarget = (event: OpenTUIMouseEvent) => {
    const sourceSessionId = draggingSessionId();
    if (!sourceSessionId) return;

    const item = getItemAtListMouse(event);
    const targetSessionId = getSessionIdForItem(item);
    if (!targetSessionId) return;

    setDragTargetSessionId(targetSessionId);
    if (targetSessionId !== sourceSessionId) {
      setDidDragSession(true);
      setSuppressSessionToggle(true);
    }
  };

  const commitSessionDrag = async () => {
    const sourceSessionId = draggingSessionId();
    const targetSessionId = dragTargetSessionId();
    const dragged = didDragSession();
    const shouldReorder = dragged && sourceSessionId && targetSessionId && sourceSessionId !== targetSessionId;
    clearSessionDrag();
    if (dragged) {
      setTimeout(() => {
        setSuppressSessionToggle(false);
      }, 0);
    }
    if (shouldReorder) {
      await reorderSessions(sourceSessionId, targetSessionId);
    }
  };

  // Clear prefix timeout on unmount
  onCleanup(() => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
    }
    clearSessionDrag();
    setSuppressSessionToggle(false);
    for (const [ptyId, unsubscribe] of activitySubscriptions) {
      unsubscribe();
      clearPtyStdoutActivity(ptyId);
    }
    activitySubscriptions.clear();
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
      syncActivitySubscriptions();
      setShimmerEnabled(false);
      return;
    }

    // Enable shimmer when aggregate view opens
    setShimmerEnabled(true);
    syncActivitySubscriptions();

    if (state.selectedPtyId) {
      preloadEmulator(state.selectedPtyId);
    }
  });

  // Auto-load session PTYs when selecting a placeholder ("...") row
  createEffect(() => {
    if (!state.showAggregateView) return;

    const selectedItem = state.flattenedTree[state.selectedIndex];
    if (!selectedItem) return;

    if (
      selectedItem.node.type === 'placeholder' &&
      selectedItem.node.message === '...' &&
      selectedItem.parentSessionId
    ) {
      const sessionId = selectedItem.parentSessionId;
      const loadState = state.sessionLoadStates.get(sessionId);

      if (
        loadState?.status === 'unloaded' &&
        !state.loadAttemptedSessionIds.has(sessionId)
      ) {
        loadSessionPtys(sessionId);
      }
    }
  });

  const closeAggregateOverlay = () => {
    closeAggregateView();
    exitAggregateMode();
  };

  // Jump to the selected PTY's workspace and pane (supports PTY rows, session headers, and placeholders)
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

    const target = await resolveStoredSessionJumpTarget(selectedSessionId);
    if (!target) return false;

    closeAggregateOverlay();
    await switchSession(selectedSessionId);
    switchWorkspace(target.workspaceId);
    if (target.paneId) {
      focusPane(target.paneId);
    }
    return true;
  };

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

  const resolveStoredSessionJumpTarget = async (
    sessionId: string
  ): Promise<{ workspaceId: WorkspaceId; paneId: string | null } | null> => {
    const sessionData = await loadSessionData(sessionId);
    if (sessionData instanceof Error) {
      console.error('Failed to load session:', sessionData.message);
      return null;
    }

    const workspaceId = sessionData.activeWorkspaceId as WorkspaceId;
    const paneId = getPreferredPaneIdForWorkspace(sessionData.workspaces[workspaceId]);
    return { workspaceId, paneId };
  };

  const resolveCurrentSessionPaneCwd = async (): Promise<string | undefined> => {
    const workspace = layoutState.workspaces[layoutState.activeWorkspaceId];
    if (!workspace) return undefined;

    const livePanes: Array<{ id: string; ptyId?: string }> = [];
    if (workspace.mainPane) {
      livePanes.push(...collectPanes(workspace.mainPane));
    }
    for (const stackPane of workspace.stackPanes) {
      livePanes.push(...collectPanes(stackPane));
    }

    const candidatePane = [...livePanes].reverse().find((pane) => !!pane.ptyId) ?? null;
    if (!candidatePane?.ptyId) return undefined;

    const cwd = await getSessionCwd(candidatePane.ptyId).catch(() => undefined);
    return cwd || undefined;
  };

  const resolveStoredSessionPaneCwd = (
    sessionData: Exclude<Awaited<ReturnType<typeof loadSessionData>>, Error>
  ): string | undefined => {
    const activeWorkspace = sessionData.workspaces[sessionData.activeWorkspaceId];
    const lastPaneId = getLastPaneIdForWorkspace(activeWorkspace);
    if (!lastPaneId) return undefined;
    return sessionData.cwdMap.get(lastPaneId);
  };

  // Create a new pane in the selected session's active workspace
  const handleNewPaneInSession = async () => {
    const selectedSessionId = state.selectedSessionId;
    const selectedPtyId = state.selectedPtyId;

    if (!selectedSessionId && !selectedPtyId) return;

    const targetSessionId = selectedSessionId ?? findSessionForPty(selectedPtyId!)?.sessionId ?? sessionState.activeSessionId;
    if (!targetSessionId) return;

    let targetWorkspaceId: WorkspaceId = layoutState.activeWorkspaceId;
    let targetCwd: string | undefined;

    if (targetSessionId === sessionState.activeSessionId) {
      targetCwd = await resolveCurrentSessionPaneCwd();

      if (selectedPtyId) {
        const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        console.error('Failed to load session:', sessionData.message);
        return;
      }

      targetWorkspaceId = sessionData.activeWorkspaceId as WorkspaceId;
      targetCwd = resolveStoredSessionPaneCwd(sessionData);

      if (selectedPtyId) {
        const sessionLocation = findSessionForPty(selectedPtyId);
        if (sessionLocation && sessionLocation.sessionId === targetSessionId) {
          for (const [wsId, workspace] of Object.entries(sessionData.workspaces)) {
            if (!workspace) continue;

            const checkNode = (node: unknown): boolean => {
              if (!node) return false;
              const n = node as { type?: string; id?: string; first?: unknown; second?: unknown };
              if (n.type === 'split') {
                return checkNode(n.first) || checkNode(n.second);
              }
              return n.id === sessionLocation.paneId;
            };

            if (workspace.mainPane && checkNode(workspace.mainPane)) {
              targetWorkspaceId = Number(wsId) as WorkspaceId;
              break;
            }

            for (const pane of workspace.stackPanes) {
              if (checkNode(pane)) {
                targetWorkspaceId = Number(wsId) as WorkspaceId;
                break;
              }
            }
          }
        }
      }

      await switchSession(targetSessionId);
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const paneId = await createPaneWithPTY(targetCwd, 'shell');
    if (!paneId) {
      console.error('Failed to create pane in aggregate view');
    }
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
    getMatchedCount: () => state.flattenedTree.length,
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
    handleNewPaneInSession,
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
            title={` Sessions (${state.allSessions.size}) `}
            titleAlignment="left"
            onMouseDown={(e: { preventDefault: () => void }) => {
              e.preventDefault();
              if (state.previewMode) {
                exitPreviewMode();
              }
            }}
            onMouseDrag={(e: OpenTUIMouseEvent) => {
              e.preventDefault();
              updateSessionDragTarget(e);
            }}
            onMouseUp={(e: OpenTUIMouseEvent) => {
              e.preventDefault();
              void commitSessionDrag();
            }}
          >
            <box style={{ flexDirection: 'column' }}>
              <Show
                when={state.flattenedTree.length > 0}
                fallback={
                  <box style={{ height: layout().listInnerHeight, justifyContent: 'center', alignItems: 'center' }}>
                    <text fg={overlaySubtle()}>No sessions match filter</text>
                  </box>
                }
              >
                <For each={visibleItems()}>
                  {(item) => {
                    const node = () => item.node;
                    const isSelected = () => item.index === state.selectedIndex;
                    const textColors = {
                      foreground: overlayFg(),
                      muted: overlayMuted(),
                      subtle: overlaySubtle(),
                    };

                    const sessionIndent = () => '';
                    const ptyIndent = () => '    ';
                    const ptyTreePrefix = () => '•';

                    if (node().type === 'spacer') {
                      return <box style={{ height: 1 }} />;
                    }

                    return (
                      <Show
                        when={node().type === 'session'}
                        fallback={
                          <Show
                            when={node().type === 'pty'}
                            fallback={
                              <PlaceholderRow
                                treePrefix=""
                                indent={ptyIndent()}
                                maxWidth={layout().listInnerWidth}
                                aggregateTheme={theme.ui.aggregate}
                                textColors={textColors}
                                isSelected={isSelected()}
                                label={(node() as import('../contexts/aggregate-view-types').PlaceholderTreeNode).message}
                                onClick={() => {
                                  setSelectedIndex(item.index);
                                  const placeholderNode = node() as import('../contexts/aggregate-view-types').PlaceholderTreeNode;
                                  const sessionId = placeholderNode.parentSessionId;
                                  if (sessionId) {
                                    loadSessionPtys(sessionId);
                                  }
                                }}
                              />
                            }
                          >
                            <PtyTreeRow
                              pty={(node() as import('../contexts/aggregate-view-types').PtyTreeNode).ptyInfo}
                              isSelected={isSelected()}
                              maxWidth={layout().listInnerWidth}
                              treePrefix={ptyTreePrefix()}
                              indent={ptyIndent()}
                              aggregateTheme={theme.ui.aggregate}
                              shimmerTargetColor={hostBgColor()}
                              textColors={textColors}
                              onClick={() => {
                                const ptyNode = node() as import('../contexts/aggregate-view-types').PtyTreeNode;
                                selectPty(ptyNode.ptyInfo.ptyId);
                                if (state.previewMode) {
                                  exitPreviewMode();
                                }
                              }}
                            />
                          </Show>
                        }
                      >
                        <SessionTreeNode
                          sessionName={(node() as import('../contexts/aggregate-view-types').SessionTreeNode).session.name}
                          paneCount={(node() as import('../contexts/aggregate-view-types').SessionTreeNode).ptyCount}
                          treePrefix=""
                          indent={sessionIndent()}
                          isSelected={isSelected()}
                          isExpanded={(node() as import('../contexts/aggregate-view-types').SessionTreeNode).isExpanded}
                          isActive={(node() as import('../contexts/aggregate-view-types').SessionTreeNode).session.id === sessionState.activeSessionId}
                          isDropTarget={dragTargetSessionId() === (node() as import('../contexts/aggregate-view-types').SessionTreeNode).session.id && draggingSessionId() !== null}
                          isDragging={draggingSessionId() === (node() as import('../contexts/aggregate-view-types').SessionTreeNode).session.id}
                          maxWidth={layout().listInnerWidth}
                          aggregateTheme={theme.ui.aggregate}
                          textColors={textColors}
                          onMouseDown={() => {
                            setSelectedIndex(item.index);
                            const sessionNode = node() as import('../contexts/aggregate-view-types').SessionTreeNode;
                            beginSessionDrag(sessionNode.session.id);
                          }}
                          onMouseUp={() => {
                            const sessionNode = node() as import('../contexts/aggregate-view-types').SessionTreeNode;
                            if (!suppressSessionToggle() && !didDragSession() && sessionNode.loadState.status === 'loaded') {
                              toggleSessionExpanded(sessionNode.session.id);
                            }
                          }}
                        />
                      </Show>
                    );
                  }}
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

        {/* Footer status bar - hide filter area while previewing, but keep hints anchored on the right */}
        <box style={{ height: 1, flexDirection: 'row' }}>
          <Show
            when={!state.previewMode}
            fallback={
              <>
                <box style={{ width: footerWidths().filterWidth }} />
                <box style={{ width: footerWidths().hintsWidth + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <text fg={overlaySubtle()}>{truncateHint(hintsText(), footerWidths().hintsWidth)}</text>
                </box>
              </>
            }
          >
            <box style={{ width: footerWidths().filterWidth }}>
              <text fg={overlayFg()}>{filterText().slice(0, footerWidths().filterWidth)}</text>
            </box>
            <box style={{ width: footerWidths().hintsWidth + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
              <text fg={overlaySubtle()}>{truncateHint(hintsText(), footerWidths().hintsWidth)}</text>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  );
}
