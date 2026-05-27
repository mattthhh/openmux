import { describe, expect, it } from 'bun:test';

import { createOverlayVimMode } from '../../../src/components/app/overlay-vim-mode';
import type { CommandPaletteState } from '../../../src/components/CommandPalette';
import type { PaneRenameState } from '../../../src/components/PaneRenameOverlay';
import type { WorkspaceLabelState } from '../../../src/components/WorkspaceLabelOverlay';
import type { FileOpenerState } from '../../../src/components/FileOpener';
import type { SessionState } from '../../../src/core/operations/session-actions';
import type { VimInputMode } from '../../../src/core/vim-sequences';
import type { useConfig } from '../../../src/contexts/ConfigContext';
import type { useKeyboard } from '../../../src/contexts/KeyboardContext';
import type { useSession } from '../../../src/contexts/SessionContext';
import type { SearchContextValue } from '../../../src/contexts/search/types';

type ConfigContextValue = ReturnType<typeof useConfig>;
type KeyboardContextValue = ReturnType<typeof useKeyboard>;
type SessionContextValue = ReturnType<typeof useSession>;

const buildConfig = (vimMode: 'off' | 'overlays'): ConfigContextValue => ({
  config: () => ({ keyboard: { vimMode } }) as any,
  keybindings: () => ({}) as any,
  configPath: '',
  reloadConfig: () => {},
});

const createDeps = (vimMode: 'off' | 'overlays') => {
  const confirmation = { value: false };
  const commandPaletteState = { show: false, query: '', selectedIndex: 0 } as CommandPaletteState;
  const paneRenameState = { show: false, paneId: null, value: '' } as PaneRenameState;
  const workspaceLabelState = { show: false, workspaceId: null, value: '' } as WorkspaceLabelState;
  const fileOpenerState = {
    show: false,
    query: '',
    selectedIndex: 0,
    files: [],
    rootDir: '',
    loading: false,
  } as FileOpenerState;
  const sessionState = { showSessionPicker: false } as SessionState;
  const session = { showTemplateOverlay: false } as SessionContextValue;
  const aggregateState = { showAggregateView: false };
  const keyboardState = { state: { mode: 'normal' } } as KeyboardContextValue;
  const search = { searchState: null, vimMode: 'normal' } as SearchContextValue;

  const commandPaletteVimMode = () => 'normal' as VimInputMode;
  const paneRenameVimMode = () => 'insert' as VimInputMode;
  const workspaceLabelVimMode = () => 'normal' as VimInputMode;
  const sessionPickerVimMode = () => 'normal' as VimInputMode;
  const templateOverlayVimMode = () => 'normal' as VimInputMode;
  const aggregateVimMode = () => 'normal' as VimInputMode;
  const fileOpenerVimMode = () => 'normal' as VimInputMode;

  return {
    config: buildConfig(vimMode),
    confirmation,
    commandPaletteState,
    paneRenameState,
    workspaceLabelState,
    fileOpenerState,
    sessionState,
    session,
    aggregateState,
    keyboardState,
    search,
    commandPaletteVimMode,
    fileOpenerVimMode,
    paneRenameVimMode,
    workspaceLabelVimMode,
    sessionPickerVimMode,
    templateOverlayVimMode,
    aggregateVimMode,
  };
};

function buildOverlayVimMode(deps: ReturnType<typeof createDeps>) {
  return createOverlayVimMode({
    config: deps.config,
    confirmationVisible: () => deps.confirmation.value,
    commandPaletteState: deps.commandPaletteState,
    paneRenameState: deps.paneRenameState,
    workspaceLabelState: deps.workspaceLabelState,
    fileOpenerState: deps.fileOpenerState,
    session: deps.session,
    sessionState: deps.sessionState,
    aggregateState: deps.aggregateState,
    keyboardState: deps.keyboardState,
    search: deps.search,
    commandPaletteVimMode: deps.commandPaletteVimMode,
    fileOpenerVimMode: deps.fileOpenerVimMode,
    paneRenameVimMode: deps.paneRenameVimMode,
    workspaceLabelVimMode: deps.workspaceLabelVimMode,
    sessionPickerVimMode: deps.sessionPickerVimMode,
    templateOverlayVimMode: deps.templateOverlayVimMode,
    aggregateVimMode: deps.aggregateVimMode,
  });
}

describe('createOverlayVimMode', () => {
  it('litmus: returns null when overlay vim mode is disabled', () => {
    const deps = createDeps('off');
    deps.commandPaletteState.show = true;

    const overlayVimMode = buildOverlayVimMode(deps);

    expect(overlayVimMode()).toBeNull();
  });

  it('smoke: confirmation blocks overlay vim mode', () => {
    const deps = createDeps('overlays');
    deps.commandPaletteState.show = true;
    deps.confirmation.value = true;

    const overlayVimMode = buildOverlayVimMode(deps);

    expect(overlayVimMode()).toBeNull();
  });

  it('regular: honors overlay priority and search fallback', () => {
    const deps = createDeps('overlays');

    const overlayVimMode = buildOverlayVimMode(deps);

    deps.commandPaletteState.show = true;
    deps.paneRenameState.show = true;
    expect(overlayVimMode()).toBe('normal');

    deps.commandPaletteState.show = false;
    deps.workspaceLabelState.show = true;
    expect(overlayVimMode()).toBe('insert');

    deps.paneRenameState.show = false;
    deps.workspaceLabelState.show = false;
    deps.keyboardState.state.mode = 'search';
    deps.search.searchState = {} as SearchContextValue['searchState'];
    deps.search.vimMode = 'insert';
    expect(overlayVimMode()).toBe('insert');
  });

  it('aggregate copy mode hides aggregate vim badge', () => {
    const deps = createDeps('overlays');
    deps.aggregateState.showAggregateView = true;
    deps.keyboardState.state.mode = 'copy';

    const overlayVimMode = buildOverlayVimMode(deps);

    expect(overlayVimMode()).toBeNull();
  });
});
