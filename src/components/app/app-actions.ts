/**
 * Centralized app action handlers.
 *
 * Creates the complete set of action handlers used by both keyboard
 * input (`useKeyboardHandler`) and command palette (`executeCommandAction`).
 * Eliminates the duplication of the same 15+ callbacks across both consumers.
 */

import { createEffect } from 'solid-js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as errore from 'errore';
import { FileSystemError } from '../../effect/errors';
import { getFocusedPane, getFocusedPtyId } from '../../core/workspace-utils';
import { setKeyboardVimMode, setKeyboardPrefixOnly } from '../../core/user-config';
import { handleNormalModeAction } from '../../contexts/keyboard/handlers';
import type { KeyboardContextValue, KeyboardHandlerOptions } from '../../contexts/keyboard/types';
import type { CommandPaletteCommand } from '../../core/command-palette';
import { openInFileManager, buildEditorCommand } from '../../core/file-opener';
import { createSearchVimState } from './search-vim';
import { createCopyModeVimState } from './copy-mode-vim';
import { createCopyModeKeyHandler } from './copy-mode-keyboard';
import { setCopyModeExitCallback } from '../../terminal/focused-pty-registry';
import type { VimInputMode } from '../../core/vim-sequences';
import type { useConfig } from '../../contexts/ConfigContext';
import type { useSearch } from '../../contexts/SearchContext';
import type { LayoutContextValue } from '../../contexts/LayoutContext';
import type { TerminalContextValue } from '../../contexts/TerminalContext';
import type { SessionContextValue } from '../../contexts/SessionContext';
import type { TitleContextValue } from '../../contexts/TitleContext';
import type { CopyModeContextValue } from '../../contexts/copy-mode/types';
import type { SelectionContextValue } from '../../contexts/SelectionContext';
import type { OverlayContextValue } from '../../contexts/OverlayContext';
import type { AggregateViewState } from '../../contexts/aggregate-view-types';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { FileEntry } from '../../core/file-opener';

/** Callbacks for aggregate-view-scoped actions. */
export interface AggregateCommandActions {
  togglePreviewZoom: () => void;
  handleNewPaneInSession: () => Promise<void>;
  handleJumpToPty: () => Promise<boolean>;
  handleOpenFileInSession: (entry: {
    absolutePath: string;
    isFolderAction: boolean;
    rootDir?: string;
  }) => Promise<void>;
  killSelectedPty: (ptyId: string) => void;
  navigateUp: () => void;
  navigateDown: () => void;
  navigateToPrevPty: () => void;
  navigateToNextPty: () => void;
  toggleShowInactive: () => void;
  openPtyPicker: () => void;
  toggleSessionExpanded: (sessionId: string) => void;
  expandAllSessions: () => void;
  collapseAllSessions: () => void;
  enterPreviewSearch: () => Promise<void>;
  enterPreviewCopyMode: () => void;
  renameSelectedPty: () => void;
  pasteToPreviewPty: () => void;
  getSelectedPtyId: () => string | null;
  closeAggregateView: () => void;
}

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
  search: ReturnType<typeof useSearch>;
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
    session,
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

  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  const handleDumpConsoleLogs = () => {
    const result = errore.try<void, FileSystemError>({
      try: () => {
        const logs = renderer.console.getCachedLogs();
        const timestamp = Date.now();
        const filename = `openmux-console-${timestamp}.log`;
        const filepath = path.join(os.tmpdir(), filename);
        fs.writeFileSync(filepath, logs, 'utf8');
        console.info(`Console logs dumped to: ${filepath}`);
      },
      catch: (cause) =>
        new FileSystemError({
          operation: 'write',
          path: os.tmpdir(),
          reason: `Failed to dump console logs: ${String(cause)}`,
          cause,
        }),
    });
    if (result instanceof FileSystemError) {
      console.error(result.message, result.cause);
    }
  };

  const handleToggleVimMode = () => {
    const current = config.config().keyboard.vimMode;
    const next = current === 'overlays' ? 'off' : 'overlays';
    setKeyboardVimMode(next);
    config.reloadConfig();
  };

  const handleTogglePrefixOnly = () => {
    const current = config.config().keyboard.prefixOnly;
    setKeyboardPrefixOnly(!current);
    config.reloadConfig();
  };

  const handleRefreshHostColors = () => {
    terminal.refreshHostColors({ forceApply: true }).catch((error: unknown) => {
      console.warn('[openmux] Failed to refresh host colors:', error);
    });
  };

  const handleToggleFileOpener = async () => {
    if (overlays.fileOpenerState.show) {
      overlays.closeFileOpener();
      return;
    }

    // In aggregate view, resolve CWD from the selected PTY
    if (aggregateState.showAggregateView) {
      const ptyId = aggregateActions.getSelectedPtyId();
      if (ptyId) {
        const cwd = await terminal.getSessionCwd(ptyId).catch(() => null);
        if (cwd) {
          overlays.openFileOpener(cwd);
          return;
        }
      }
    }

    // Fallback: resolve CWD from the focused pane's PTY
    const cwd = await terminal.getFocusedCwd().catch(() => null);
    const rootDir = cwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
    overlays.openFileOpener(rootDir);
  };

  const handleFileOpenerSelect = async (entry: FileEntry) => {
    if (entry.isFolderAction) {
      void openInFileManager(entry.absolutePath);
      return;
    }

    // In aggregate view, delegate to the state manager which handles
    // pending insertions, autoswitch, and editor command injection
    // while staying in the aggregate view.
    if (aggregateState.showAggregateView) {
      void aggregateActions.handleOpenFileInSession({
        ...entry,
        rootDir: overlays.fileOpenerState.rootDir || process.cwd(),
      });
      return;
    }

    // Workspace mode: create pane directly in the active workspace
    const fileOpenerSettings = config.config().fileOpener;
    const commandParts = buildEditorCommand(fileOpenerSettings, entry.absolutePath);
    const fullCommand = `${fileOpenerSettings.editor} ${commandParts.join(' ')}`;
    // Use the rootDir (where the file opener was invoked) as CWD,
    // not the directory containing the file
    const cwd = overlays.fileOpenerState.rootDir || process.cwd();

    const result = await terminal.createPaneWithPTY(cwd);
    if (!result) return;

    terminal.writeToPTY(result.ptyId, `${fullCommand}\n`);
  };

  const searchVimState = createSearchVimState({ config, search });
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => keyboardState.state.mode === 'copy',
  });

  const handleEnterSearch = async () => {
    selection.clearAllSelections();
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    if (focusedPtyId) {
      await search.enterSearchMode(focusedPtyId);
    }
  };

  const handleEnterCopyMode = () => {
    selection.clearAllSelections();
    const focusedPtyId = getActivePtyId();
    if (!focusedPtyId) {
      keyboardState.exitCopyMode();
      return;
    }
    copyMode.enterCopyMode(focusedPtyId);
  };

  const handleExitCopyMode = () => {
    copyMode.exitCopyMode();
    keyboardState.exitCopyMode();
  };

  // Wire copy mode exit so bracketed paste can exit copy mode before pasting
  createEffect(() => {
    const active = keyboardState.state.mode === 'copy';
    setCopyModeExitCallback(active ? handleExitCopyMode : null);
  });

  const handleCopyModeKey = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: handleExitCopyMode,
    pasteCallback: handlePaste,
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

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

  // Single source of truth for all action handlers
  const actions: KeyboardHandlerOptions = {
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: overlays.handleQuit,
    onDetach: overlays.handleDetach,
    onRequestQuit: overlays.confirmationHandlers.handleRequestQuit,
    onRequestClosePane: overlays.confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: session.togglePicker,
    onToggleTemplateOverlay: session.toggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onEnterCopyMode: handleEnterCopyMode,
    onToggleConsole: handleToggleConsole,
    onDumpConsoleLogs: handleDumpConsoleLogs,
    onToggleAggregateView: openAggregateView,
    onToggleCommandPalette: overlays.toggleCommandPalette,
    onToggleFileOpener: handleToggleFileOpener,
    onToggleVimMode: handleToggleVimMode,
    onTogglePrefixOnly: handleTogglePrefixOnly,
    onRefreshHostColors: handleRefreshHostColors,
    onRenamePane: handlePaneRenameOpen,
    onLabelWorkspace: handleWorkspaceLabelOpen,
  };

  return {
    actions,
    executeCommandAction,
    handleCommandPaletteExecute,
    handleFileOpenerSelect,
    handleToggleFileOpener,
    handlePaste,
    handleEnterSearch,
    handleEnterCopyMode,
    handleExitCopyMode,
    handleCopyModeKey,
    getSearchVimMode: searchVimState.getSearchVimMode,
    setSearchVimMode: searchVimState.setSearchVimMode,
    getSearchVimHandler: searchVimState.getSearchVimHandler,
    getCopyVimHandler: copyModeVimState.getCopyVimHandler,
  };
}
