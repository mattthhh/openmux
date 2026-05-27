/**
 * Overlay state container for App.
 */

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { VimInputMode } from '../../core/vim-sequences';
import { createCommandPaletteState } from './command-palette-state';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';
import type { FileOpenerState } from '../FileOpener';
import type { DiffOpenerState } from '../DiffOpener';

/**
 * Factory for creating vim mode signal pairs for overlays
 * Returns properly named accessors/setters for each overlay
 */
function createVimModeState(name: string) {
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  return {
    getter: vimMode,
    setter: setVimMode,
    name,
  };
}

export function createOverlayState() {
  const commandPalette = createCommandPaletteState();
  const [paneRenameState, setPaneRenameState] = createStore<PaneRenameState>({
    show: false,
    paneId: null,
    value: '',
  });
  const [workspaceLabelState, setWorkspaceLabelState] = createStore<WorkspaceLabelState>({
    show: false,
    workspaceId: null,
    value: '',
  });

  const [fileOpenerState, setFileOpenerState] = createStore<FileOpenerState>({
    show: false,
    query: '',
    selectedIndex: 0,
    files: [],
    rootDir: '',
    loading: false,
  });

  const [diffOpenerState, setDiffOpenerState] = createStore<DiffOpenerState>({
    show: false,
    query: '',
    selectedIndex: 0,
    targets: [],
    rootDir: '',
    loading: false,
  });

  // Vim mode state for each overlay using factory
  const commandPaletteVim = createVimModeState('commandPalette');
  const paneRenameVim = createVimModeState('paneRename');
  const workspaceLabelVim = createVimModeState('workspaceLabel');
  const sessionPickerVim = createVimModeState('sessionPicker');
  const templateOverlayVim = createVimModeState('templateOverlay');
  const aggregateVim = createVimModeState('aggregate');
  const fileOpenerVim = createVimModeState('fileOpener');
  const diffOpenerVim = createVimModeState('diffOpener');

  const [updateLabel, setUpdateLabel] = createSignal<string | null>(null);

  const openFileOpener = (rootDir: string) => {
    setFileOpenerState({
      show: true,
      query: '',
      selectedIndex: 0,
      files: [],
      rootDir,
      loading: true,
    });
  };

  const closeFileOpener = () => {
    setFileOpenerState({
      show: false,
      query: '',
      selectedIndex: 0,
      files: [],
      rootDir: '',
      loading: false,
    });
  };

  const toggleFileOpener = () => {
    if (fileOpenerState.show) {
      closeFileOpener();
    } else {
      // Default to process.cwd() when triggered without a specific root
      const cwd = process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
      openFileOpener(cwd);
    }
  };

  const openDiffOpener = (rootDir: string) => {
    setDiffOpenerState({
      show: true,
      query: '',
      selectedIndex: 0,
      targets: [],
      rootDir,
      loading: true,
    });
  };

  const closeDiffOpener = () => {
    setDiffOpenerState({
      show: false,
      query: '',
      selectedIndex: 0,
      targets: [],
      rootDir: '',
      loading: false,
    });
  };

  const toggleDiffOpener = () => {
    if (diffOpenerState.show) {
      closeDiffOpener();
    } else {
      const cwd = process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
      openDiffOpener(cwd);
    }
  };

  return {
    ...commandPalette,
    paneRenameState,
    setPaneRenameState,
    workspaceLabelState,
    setWorkspaceLabelState,
    commandPaletteVimMode: commandPaletteVim.getter,
    setCommandPaletteVimMode: commandPaletteVim.setter,
    paneRenameVimMode: paneRenameVim.getter,
    setPaneRenameVimMode: paneRenameVim.setter,
    workspaceLabelVimMode: workspaceLabelVim.getter,
    setWorkspaceLabelVimMode: workspaceLabelVim.setter,
    sessionPickerVimMode: sessionPickerVim.getter,
    setSessionPickerVimMode: sessionPickerVim.setter,
    templateOverlayVimMode: templateOverlayVim.getter,
    setTemplateOverlayVimMode: templateOverlayVim.setter,
    aggregateVimMode: aggregateVim.getter,
    setAggregateVimMode: aggregateVim.setter,
    fileOpenerVimMode: fileOpenerVim.getter,
    setFileOpenerVimMode: fileOpenerVim.setter,
    diffOpenerVimMode: diffOpenerVim.getter,
    setDiffOpenerVimMode: diffOpenerVim.setter,
    updateLabel,
    setUpdateLabel,
    fileOpenerState,
    setFileOpenerState,
    openFileOpener,
    closeFileOpener,
    toggleFileOpener,
    diffOpenerState,
    setDiffOpenerState,
    openDiffOpener,
    closeDiffOpener,
    toggleDiffOpener,
  };
}
