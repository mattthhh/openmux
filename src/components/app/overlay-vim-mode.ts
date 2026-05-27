import type { Accessor } from 'solid-js';
import type { CommandPaletteState } from '../CommandPalette';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';
import type { FileOpenerState } from '../FileOpener';
import type { DiffOpenerState } from '../DiffOpener';
import type { VimInputMode } from '../../core/vim-sequences';
import type { SearchContextValue } from '../../contexts/search/types';
import type { SessionState } from '../../core/operations/session-actions';
import type { useConfig } from '../../contexts/ConfigContext';
import type { useKeyboard } from '../../contexts/KeyboardContext';
import type { useSession } from '../../contexts/SessionContext';

export function createOverlayVimMode(params: {
  config: ReturnType<typeof useConfig>;
  confirmationVisible: Accessor<boolean>;
  commandPaletteState: CommandPaletteState;
  paneRenameState: PaneRenameState;
  workspaceLabelState: WorkspaceLabelState;
  fileOpenerState: FileOpenerState;
  diffOpenerState: DiffOpenerState;
  session: ReturnType<typeof useSession>;
  sessionState: SessionState;
  aggregateState: { showAggregateView: boolean };
  keyboardState: ReturnType<typeof useKeyboard>;
  search: SearchContextValue;
  commandPaletteVimMode: Accessor<VimInputMode>;
  fileOpenerVimMode: Accessor<VimInputMode>;
  diffOpenerVimMode: Accessor<VimInputMode>;
  paneRenameVimMode: Accessor<VimInputMode>;
  workspaceLabelVimMode: Accessor<VimInputMode>;
  sessionPickerVimMode: Accessor<VimInputMode>;
  templateOverlayVimMode: Accessor<VimInputMode>;
  aggregateVimMode: Accessor<VimInputMode>;
}): Accessor<VimInputMode | null> {
  const {
    config,
    confirmationVisible,
    commandPaletteState,
    paneRenameState,
    workspaceLabelState,
    fileOpenerState,
    diffOpenerState,
    session,
    sessionState,
    aggregateState,
    keyboardState,
    search,
    commandPaletteVimMode,
    fileOpenerVimMode,
    diffOpenerVimMode,
    paneRenameVimMode,
    workspaceLabelVimMode,
    sessionPickerVimMode,
    templateOverlayVimMode,
    aggregateVimMode,
  } = params;

  return () => {
    if (config.config().keyboard.vimMode !== 'overlays') return null;
    if (confirmationVisible()) return null;
    if (commandPaletteState.show) return commandPaletteVimMode();
    if (fileOpenerState.show) return fileOpenerVimMode();
    if (diffOpenerState.show) return diffOpenerVimMode();
    if (paneRenameState.show) return paneRenameVimMode();
    if (workspaceLabelState.show) return workspaceLabelVimMode();
    if (session.showTemplateOverlay) return templateOverlayVimMode();
    if (sessionState.showSessionPicker) return sessionPickerVimMode();
    if (aggregateState.showAggregateView) {
      if (keyboardState.state.mode === 'copy') return null;
      return aggregateVimMode();
    }
    if (keyboardState.state.mode === 'search' && search.searchState) {
      return search.vimMode;
    }
    return null;
  };
}
