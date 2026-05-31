/**
 * Centralized app action handlers.
 *
 * Creates the complete set of action handlers used by both keyboard
 * input (`useKeyboardHandler`) and command palette (`executeCommandAction`).
 *
 * Action logic is split into focused modules under `./actions/`:
 * - copy-mode-actions: copy mode entry/exit, vim state, key handling
 * - search-actions: search mode entry, vim state
 * - opener-actions: file opener and diff opener toggling/selection
 * - config-actions: console, vim mode, prefix-only, host colors
 */

import { getFocusedPane } from '../../core/workspace-utils';
import { handleNormalModeAction } from '../../contexts/keyboard/handlers';
import type { KeyboardContextValue, KeyboardHandlerOptions } from '../../contexts/keyboard/types';
import type { CommandPaletteCommand } from '../../core/command-palette';
import type { AggregateCommandActions } from './actions/types';
import {
  createCopyModeActions,
  createSearchActions,
  createOpenerActions,
  createConfigActions,
} from './actions';
import type { useConfig } from '../../contexts/ConfigContext';
import type { LayoutContextValue } from '../../contexts/LayoutContext';
import type { TerminalContextValue } from '../../contexts/TerminalContext';
import type { SessionContextValue } from '../../contexts/SessionContext';
import type { TitleContextValue } from '../../contexts/TitleContext';
import type { CopyModeContextValue } from '../../contexts/copy-mode/types';
import type { SelectionContextValue } from '../../contexts/SelectionContext';
import type { OverlayContextValue } from '../../contexts/OverlayContext';
import type { SearchContextValue } from '../../contexts/search/types';
import type { AggregateViewState } from '../../contexts/aggregate-view-types';
import type { VimInputMode } from '../../core/vim-sequences';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { DiffTarget } from '../../core/diff-opener';
import type { FileEntry } from '../../core/file-opener';

export type { AggregateCommandActions } from './actions/types';

type VimHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface AppActionsDeps {
  config: ReturnType<typeof useConfig>;
  layout: LayoutContextValue;
  terminal: TerminalContextValue;
  session: SessionContextValue;
  titleContext: TitleContextValue;
  copyMode: CopyModeContextValue;
  selection: SelectionContextValue;
  search: SearchContextValue;
  keyboardState: KeyboardContextValue;
  overlays: OverlayContextValue;
  aggregateState: AggregateViewState;
  aggregateActions: AggregateCommandActions;
  renderer: { console: { toggle: () => void; getCachedLogs: () => string } };
  openAggregateView: () => void;
  getActivePtyId: () => string | undefined;
  handleNewPane: () => void;
  handleSplitPane: (direction: 'horizontal' | 'vertical') => void;
}

export function useAppActions(deps: AppActionsDeps): {
  /** Single source of truth for all action handlers */
  actions: KeyboardHandlerOptions;
  /** Dispatch a command-palette action */
  executeCommandAction(action: string): void;
  /** Execute a command palette command */
  handleCommandPaletteExecute(command: CommandPaletteCommand): void;
  /** Handle file opener selection */
  handleFileOpenerSelect(entry: FileEntry): Promise<void>;
  /** Toggle file opener */
  handleToggleFileOpener(): void;
  /** Handle diff opener selection */
  handleDiffOpenerSelect(target: DiffTarget): Promise<void>;
  /** Toggle diff opener */
  handleToggleDiffOpener(): void;
  /** Paste from clipboard */
  handlePaste(): void;
  /** Enter search mode */
  handleEnterSearch(): Promise<void>;
  /** Enter copy mode */
  handleEnterCopyMode(): void;
  /** Exit copy mode */
  handleExitCopyMode(): void;
  /** Handle keyboard input in copy mode */
  handleCopyModeKey(event: KeyboardEvent): void;
  /** Get current search vim input mode */
  getSearchVimMode(): VimInputMode;
  /** Set search vim input mode */
  setSearchVimMode(mode: VimInputMode): void;
  /** Get the vim handler for search keyboard input */
  getSearchVimHandler(): VimHandler;
  /** Get the vim handler for copy mode keyboard input */
  getCopyVimHandler(): VimHandler;
} {
  const {
    config,
    layout,
    terminal,
    titleContext,
    copyMode,
    selection,
    search,
    keyboardState,
    overlays,
    aggregateState,
    aggregateActions,
    renderer,
    openAggregateView,
    getActivePtyId,
    handleNewPane,
    handleSplitPane,
  } = deps;

  const handlePaste = () => {
    terminal.pasteToFocused();
  };

  // Delegate to focused action modules
  const configActions = createConfigActions({
    config,
    terminal,
    renderer,
  });

  const openerActions = createOpenerActions({
    config,
    terminal,
    overlays,
    aggregateState,
    aggregateActions,
  });

  const searchActions = createSearchActions({
    config,
    search,
    selection,
  });

  const copyModeActions = createCopyModeActions({
    config,
    keyboardState,
    copyMode,
    selection,
    getActivePtyId,
    pasteCallback: handlePaste,
  });

  const handlePaneRenameOpen = () => {
    const focusedPane = getFocusedPane(layout.activeWorkspace);
    if (!focusedPane) return;
    const currentTitle = titleContext.getTitle(focusedPane.id) ?? focusedPane.title ?? 'shell';
    overlays.setPaneRenameState({
      show: true,
      paneId: focusedPane.id,
      value: currentTitle,
    });
  };

  const handleWorkspaceLabelOpen = () => {
    const workspace = layout.activeWorkspace;
    const currentLabel = workspace.label ?? '';
    overlays.setWorkspaceLabelState({
      show: true,
      workspaceId: workspace.id,
      value: currentLabel,
    });
  };

  const executeAggregateCommandAction = (action: string): boolean => {
    switch (action) {
      case 'aggregate.zoom':
        aggregateActions.togglePreviewZoom();
        return true;
      case 'aggregate.new.pane':
        void aggregateActions.handleNewPaneInSession();
        return true;
      case 'aggregate.kill': {
        const ptyId = aggregateActions.getSelectedPtyId();
        if (ptyId) aggregateActions.killSelectedPty(ptyId);
        return true;
      }
      case 'aggregate.search':
        void aggregateActions.enterPreviewSearch();
        return true;
      case 'aggregate.copy':
        aggregateActions.enterPreviewCopyMode();
        return true;
      case 'aggregate.rename':
        aggregateActions.renameSelectedPty();
        return true;
      case 'aggregate.paste':
        aggregateActions.pasteToPreviewPty();
        return true;
      case 'aggregate.toggle.scope':
        aggregateActions.toggleShowInactive();
        return true;
      case 'aggregate.toggle.picker':
        aggregateActions.openPtyPicker();
        return true;
      case 'aggregate.jump':
        void aggregateActions.handleJumpToPty();
        return true;
      case 'aggregate.expand.all':
        aggregateActions.expandAllSessions();
        return true;
      case 'aggregate.collapse.all':
        aggregateActions.collapseAllSessions();
        return true;
      case 'aggregate.toggle':
        aggregateActions.closeAggregateView();
        return true;
      default:
        return false;
    }
  };

  const executeCommandAction = (action: string) => {
    // When aggregate view is open, route aggregate-scoped actions first
    if (aggregateState.showAggregateView) {
      if (executeAggregateCommandAction(action)) return;
    }

    handleNormalModeAction(
      action,
      keyboardState,
      layout,
      layout.activeWorkspace.layoutMode,
      actions
    );
  };

  const handleCommandPaletteExecute = (command: CommandPaletteCommand) => {
    executeCommandAction(command.action);
  };

  const getFocusedPtyIdForLayout = () => {
    const ws = layout.activeWorkspace;
    if (ws.focusedPaneId) {
      // Walk the layout tree to find the pane's ptyId
      const allPanes = layout.panes;
      const pane = allPanes.find((p) => p.id === ws.focusedPaneId);
      return pane?.ptyId;
    }
    return undefined;
  };

  // Single source of truth for all action handlers
  const actions: KeyboardHandlerOptions = {
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: overlays.handleQuit,
    onDetach: overlays.handleDetach,
    onRequestQuit: overlays.confirmationHandlers.handleRequestQuit,
    onRequestClosePane: overlays.confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: deps.session.togglePicker,
    onToggleTemplateOverlay: deps.session.toggleTemplateOverlay,
    onEnterSearch: () => searchActions.handleEnterSearch(getFocusedPtyIdForLayout),
    onEnterCopyMode: copyModeActions.handleEnterCopyMode,
    onToggleConsole: configActions.handleToggleConsole,
    onDumpConsoleLogs: configActions.handleDumpConsoleLogs,
    onToggleAggregateView: openAggregateView,
    onToggleCommandPalette: overlays.toggleCommandPalette,
    onToggleFileOpener: openerActions.handleToggleFileOpener,
    onToggleDiffOpener: openerActions.handleToggleDiffOpener,
    onToggleVimMode: configActions.handleToggleVimMode,
    onTogglePrefixOnly: configActions.handleTogglePrefixOnly,
    onRefreshHostColors: configActions.handleRefreshHostColors,
    onRenamePane: handlePaneRenameOpen,
    onLabelWorkspace: handleWorkspaceLabelOpen,
  };

  return {
    actions,
    executeCommandAction,
    handleCommandPaletteExecute,
    handleFileOpenerSelect: openerActions.handleFileOpenerSelect,
    handleToggleFileOpener: openerActions.handleToggleFileOpener,
    handleDiffOpenerSelect: openerActions.handleDiffOpenerSelect,
    handleToggleDiffOpener: openerActions.handleToggleDiffOpener,
    handlePaste,
    handleEnterSearch: () => searchActions.handleEnterSearch(getFocusedPtyIdForLayout),
    handleEnterCopyMode: copyModeActions.handleEnterCopyMode,
    handleExitCopyMode: copyModeActions.handleExitCopyMode,
    handleCopyModeKey: copyModeActions.handleCopyModeKey,
    getSearchVimMode: searchActions.getSearchVimMode,
    setSearchVimMode: searchActions.setSearchVimMode,
    getSearchVimHandler: searchActions.getSearchVimHandler,
    getCopyVimHandler: copyModeActions.getCopyVimHandler,
  };
}
