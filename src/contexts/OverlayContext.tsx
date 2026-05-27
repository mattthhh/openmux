/**
 * OverlayContext - centralizes overlay state and confirmation workflows.
 */

import { createContext, useContext, type Accessor, type ParentProps } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { useRenderer } from '@opentui/solid';

import { useAggregateView } from './AggregateViewContext';
import { useConfig } from './ConfigContext';
import { useKeyboard } from './KeyboardContext';
import { useLayout } from './LayoutContext';
import { useSearch } from './SearchContext';
import { useSession } from './SessionContext';
import { useTerminal } from './TerminalContext';
import { createOverlayState } from '../components/app/overlay-state';
import { createOverlayVimMode } from '../components/app/overlay-vim-mode';
import {
  createConfirmationWorkflows,
  type ConfirmationWorkflows,
} from '../components/app/confirmation-workflows';
import { createExitHandlers } from '../components/app/exit-handlers';
import type { CommandPaletteState } from '../components/CommandPalette';
import type { PaneRenameState } from '../components/PaneRenameOverlay';
import type { WorkspaceLabelState } from '../components/WorkspaceLabelOverlay';
import type { FileOpenerState } from '../components/FileOpener';
import type { DiffOpenerState } from '../components/DiffOpener';
import type { VimInputMode } from '../core/vim-sequences';
import { getFocusedPtyId } from '../core/workspace-utils';
import { shutdownShim, disposeRuntime } from '../effect/bridge';

export interface OverlayContextValue {
  commandPaletteState: CommandPaletteState;
  setCommandPaletteState: SetStoreFunction<CommandPaletteState>;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  paneRenameState: PaneRenameState;
  setPaneRenameState: SetStoreFunction<PaneRenameState>;
  workspaceLabelState: WorkspaceLabelState;
  setWorkspaceLabelState: SetStoreFunction<WorkspaceLabelState>;
  fileOpenerState: FileOpenerState;
  setFileOpenerState: SetStoreFunction<FileOpenerState>;
  openFileOpener: (rootDir: string) => void;
  closeFileOpener: () => void;
  toggleFileOpener: () => void;
  diffOpenerState: DiffOpenerState;
  setDiffOpenerState: SetStoreFunction<DiffOpenerState>;
  openDiffOpener: (rootDir: string) => void;
  closeDiffOpener: () => void;
  toggleDiffOpener: () => void;
  commandPaletteVimMode: Accessor<VimInputMode>;
  setCommandPaletteVimMode: (mode: VimInputMode) => void;
  fileOpenerVimMode: Accessor<VimInputMode>;
  setFileOpenerVimMode: (mode: VimInputMode) => void;
  diffOpenerVimMode: Accessor<VimInputMode>;
  setDiffOpenerVimMode: (mode: VimInputMode) => void;
  paneRenameVimMode: Accessor<VimInputMode>;
  setPaneRenameVimMode: (mode: VimInputMode) => void;
  workspaceLabelVimMode: Accessor<VimInputMode>;
  setWorkspaceLabelVimMode: (mode: VimInputMode) => void;
  sessionPickerVimMode: Accessor<VimInputMode>;
  setSessionPickerVimMode: (mode: VimInputMode) => void;
  templateOverlayVimMode: Accessor<VimInputMode>;
  setTemplateOverlayVimMode: (mode: VimInputMode) => void;
  aggregateVimMode: Accessor<VimInputMode>;
  setAggregateVimMode: (mode: VimInputMode) => void;
  updateLabel: Accessor<string | null>;
  setUpdateLabel: (label: string | null) => void;
  overlayVimMode: Accessor<VimInputMode | null>;
  confirmationState: ConfirmationWorkflows['confirmationState'];
  confirmationHandlers: ConfirmationWorkflows['confirmationHandlers'];
  requestTemplateApplyConfirm: ConfirmationWorkflows['requestTemplateApplyConfirm'];
  requestTemplateOverwriteConfirm: ConfirmationWorkflows['requestTemplateOverwriteConfirm'];
  requestTemplateDeleteConfirm: ConfirmationWorkflows['requestTemplateDeleteConfirm'];
  requestSessionDeleteConfirm: ConfirmationWorkflows['requestSessionDeleteConfirm'];
  handleQuit: () => Promise<void>;
  handleDetach: () => Promise<void>;
  handleShimDetached: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function OverlayProvider(props: ParentProps) {
  const config = useConfig();
  const layout = useLayout();
  const terminal = useTerminal();
  const keyboardState = useKeyboard();
  const session = useSession();
  const search = useSearch();
  const { state: sessionState } = session;
  const { state: aggregateState } = useAggregateView();
  const renderer = useRenderer();

  const overlayState = createOverlayState();

  const exitHandlers = createExitHandlers({
    saveSession: session.saveSession,
    suspendSessionPersistence: session.suspendPersistence,
    shutdownShim,
    disposeRuntime,
    renderer,
  });

  const confirmationWorkflows = createConfirmationWorkflows({
    closePane: layout.closePane,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    destroyPTY: terminal.destroyPTY,
    enterConfirmMode: keyboardState.enterConfirmMode,
    exitConfirmMode: keyboardState.exitConfirmMode,
    onQuit: exitHandlers.handleQuit,
  });

  const overlayVimMode = createOverlayVimMode({
    config,
    confirmationVisible: () => confirmationWorkflows.confirmationState().visible,
    commandPaletteState: overlayState.commandPaletteState,
    paneRenameState: overlayState.paneRenameState,
    workspaceLabelState: overlayState.workspaceLabelState,
    fileOpenerState: overlayState.fileOpenerState,
    diffOpenerState: overlayState.diffOpenerState,
    session,
    sessionState,
    aggregateState,
    keyboardState,
    search,
    commandPaletteVimMode: overlayState.commandPaletteVimMode,
    fileOpenerVimMode: overlayState.fileOpenerVimMode,
    diffOpenerVimMode: overlayState.diffOpenerVimMode,
    paneRenameVimMode: overlayState.paneRenameVimMode,
    workspaceLabelVimMode: overlayState.workspaceLabelVimMode,
    sessionPickerVimMode: overlayState.sessionPickerVimMode,
    templateOverlayVimMode: overlayState.templateOverlayVimMode,
    aggregateVimMode: overlayState.aggregateVimMode,
  });

  const value: OverlayContextValue = {
    ...overlayState,
    overlayVimMode,
    confirmationState: confirmationWorkflows.confirmationState,
    confirmationHandlers: confirmationWorkflows.confirmationHandlers,
    requestTemplateApplyConfirm: confirmationWorkflows.requestTemplateApplyConfirm,
    requestTemplateOverwriteConfirm: confirmationWorkflows.requestTemplateOverwriteConfirm,
    requestTemplateDeleteConfirm: confirmationWorkflows.requestTemplateDeleteConfirm,
    requestSessionDeleteConfirm: confirmationWorkflows.requestSessionDeleteConfirm,
    handleQuit: exitHandlers.handleQuit,
    handleDetach: exitHandlers.handleDetach,
    handleShimDetached: exitHandlers.handleShimDetached,
  };

  return <OverlayContext.Provider value={value}>{props.children}</OverlayContext.Provider>;
}

export function useOverlays(): OverlayContextValue {
  const context = useContext(OverlayContext);
  if (!context) {
    throw new Error('useOverlays must be used within OverlayProvider');
  }
  return context;
}
