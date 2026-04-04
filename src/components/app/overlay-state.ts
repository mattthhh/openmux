/**
 * Overlay state container for App.
 */

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { VimInputMode } from '../../core/vim-sequences';
import { createCommandPaletteState } from './command-palette-state';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';

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

  // Vim mode state for each overlay using factory
  const commandPaletteVim = createVimModeState('commandPalette');
  const paneRenameVim = createVimModeState('paneRename');
  const workspaceLabelVim = createVimModeState('workspaceLabel');
  const sessionPickerVim = createVimModeState('sessionPicker');
  const templateOverlayVim = createVimModeState('templateOverlay');
  const aggregateVim = createVimModeState('aggregate');

  const [updateLabel, setUpdateLabel] = createSignal<string | null>(null);

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
    updateLabel,
    setUpdateLabel,
  };
}
