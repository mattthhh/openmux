import type { KeyboardEvent } from '../../../core/keyboard-event';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { ResolvedKeybindings } from '../../../core/keybindings';
import type { VimInputMode } from '../../../core/vim-sequences';

export type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export type VimHandlers = {
  list: VimSequenceHandler;
  preview: VimSequenceHandler;
  search: VimSequenceHandler;
};

/** Dependencies for the list-mode keyboard handler */
export interface ListDeps {
  getKeybindings: () => ResolvedKeybindings;
  getVimEnabled: () => boolean;
  getVimMode: () => VimInputMode;
  setVimMode: (mode: VimInputMode) => void;
  getVimHandlers: () => VimHandlers;

  getMatchedCount: () => number;
  toggleShowInactive: () => void;
  getSelectedPtyId: () => string | null;

  navigateUp: () => void;
  navigateDown: () => void;
  scrollListUp?: (amount?: number) => void;
  scrollListDown?: (amount?: number) => void;
  setSelectedIndex: (index: number) => void;
  setListScrollOffset?: (offset: number) => void;

  handleListEnter: () => boolean;
  handleJumpToPty: () => Promise<boolean>;
  handleNewPaneInSession: () => Promise<void>;

  closeAggregateView: () => void;
  exitAggregateMode: () => void;
  onRequestKillPty?: (ptyId: string) => void;
}

/** Dependencies for the search-mode keyboard handler */
export interface SearchDeps {
  getKeybindings: () => ResolvedKeybindings;
  getVimEnabled: () => boolean;
  getSearchVimMode: () => VimInputMode;
  setSearchVimMode: (mode: VimInputMode) => void;
  getVimHandlers: () => VimHandlers;

  getSearchState: () => { query: string } | null;
  exitSearchMode: (cancel: boolean) => void;
  setInSearchMode: (value: boolean) => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
}

/** Dependencies for the preview-mode keyboard handler */
export interface PreviewDeps {
  getPreviewPtyId: () => string | null;
  getEmulatorSync: (ptyId: string) => ITerminalEmulator | null;
  getKeybindings: () => ResolvedKeybindings;

  handleEnterSearch: () => Promise<void>;
  handleEnterCopyMode: () => void;
  closeAggregateView: () => void;
  exitAggregateMode: () => void;
  navigateToNextPty: () => void;
  navigateToPrevPty: () => void;
  handleNewPaneInSession: () => Promise<void>;
  onRequestKillPty?: (ptyId: string) => void;
  /** Snap focused PTY to bottom on key forward */
  requestSnapToBottom?: (ptyId: string) => void;
}

/** Dependencies for the global orchestrator (prefix, mode routing, copy mode) */
export interface GlobalDeps {
  getPreviewMode: () => boolean;
  getInSearchMode: () => boolean;
  getCopyModeActive: () => boolean;
  getPrefixActive: () => boolean;
  getKeybindings: () => ResolvedKeybindings;

  setPrefixActive: (value: boolean) => void;
  clearPrefixTimeout: () => void;
  startPrefixTimeout: () => void;

  closeAggregateView: () => void;
  exitAggregateMode: () => void;
  togglePreviewZoom: () => void;
  togglePtyPicker: () => void;

  handleEnterSearch: () => Promise<void>;
  handleEnterCopyMode: () => void;
  handleCopyModeKeys: (event: KeyboardEvent) => boolean;

  onRequestQuit?: () => void;
  onDetach?: () => void;
  onToggleCommandPalette?: () => void;
  onToggleFileOpener?: () => void;
  onToggleDiffOpener?: () => void;
  onToggleConsole?: () => void;
  onPaste?: () => void;
}

/**
 * AggregateKeyboardDeps is the union of all sub-handler deps.
 * Kept for backward compatibility with tests that construct a single deps object.
 */
export interface AggregateKeyboardDeps extends ListDeps, SearchDeps, PreviewDeps, GlobalDeps {
  requestSnapToBottom?: (ptyId: string) => void;
  getSelectedPtyId: () => string | null;
  enterPreviewMode: () => void;
  onToggleSessionPicker?: () => void;
  togglePtyPicker: () => void;
}
