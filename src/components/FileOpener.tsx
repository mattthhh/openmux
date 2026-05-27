/**
 * FileOpener - modal overlay for fuzzy file search and opening
 */

import { Show, For, createMemo, createEffect, createSignal } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  eventToCombo,
  formatComboSet,
  matchKeybinding,
  type ResolvedKeybindingMap,
} from '../core/keybindings';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import type { KeyboardEvent } from '../effect/bridge';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import { useOverlayColors } from './overlay-colors';
import { truncateHint } from './overlay-hints';
import { filterFiles } from './file-opener-utils';
import { discoverFiles, type FileEntry } from '../core/file-opener';

export interface FileOpenerState {
  show: boolean;
  query: string;
  selectedIndex: number;
  files: FileEntry[];
  rootDir: string;
  loading: boolean;
}

interface FileOpenerProps {
  width: number;
  height: number;
  state: FileOpenerState;
  setState: SetStoreFunction<FileOpenerState>;
  onSelect: (entry: FileEntry) => void;
  onVimModeChange?: (mode: VimInputMode) => void;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function FileOpener(props: FileOpenerProps) {
  const theme = useTheme();
  const config = useConfig();
  const {
    background: overlayBg,
    foreground: overlayFg,
    muted: overlayMuted,
    subtle: overlaySubtle,
    separator: overlaySeparator,
    match: overlayMatch,
  } = useOverlayColors();

  const hasQuery = () => props.state.query.trim().length > 0;
  const filteredFiles = createMemo(() => filterFiles(props.state.files, props.state.query));
  const accentColor = () => theme.searchAccentColor;
  const resultCount = () => filteredFiles().length;
  const showResults = () => resultCount() > 0 && !props.state.loading;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: [
      { keys: ['j'], action: 'file.opener.down' },
      { keys: ['k'], action: 'file.opener.up' },
      { keys: ['g', 'g'], action: 'file.opener.top' },
      { keys: ['shift+g'], action: 'file.opener.bottom' },
      { keys: ['enter'], action: 'file.opener.confirm' },
      { keys: ['q'], action: 'file.opener.close' },
    ],
  });

  const closeOpener = () => {
    props.setState({ show: false, query: '', selectedIndex: 0, files: [], loading: false });
  };

  const updateQuery = (query: string) => {
    props.setState({ query, selectedIndex: 0 });
  };

  const moveSelection = (direction: 'up' | 'down') => {
    const count = filteredFiles().length;
    if (count === 0) return;
    const delta = direction === 'down' ? 1 : -1;
    const nextIndex = (props.state.selectedIndex + delta + count) % count;
    props.setState('selectedIndex', nextIndex);
  };

  const executeSelected = () => {
    const entry = filteredFiles()[props.state.selectedIndex];
    if (!entry) return;
    closeOpener();
    props.onSelect(entry);
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleAction = (action: string | null): boolean => {
    switch (action) {
      case 'file.opener.close':
        closeOpener();
        return true;
      case 'file.opener.down':
        moveSelection('down');
        return true;
      case 'file.opener.up':
        moveSelection('up');
        return true;
      case 'file.opener.confirm':
        executeSelected();
        return true;
      case 'file.opener.delete':
        updateQuery(props.state.query.slice(0, -1));
        return true;
      case 'file.opener.top':
        props.setState('selectedIndex', 0);
        return true;
      case 'file.opener.bottom': {
        const count = filteredFiles().length;
        if (count > 0) {
          props.setState('selectedIndex', count - 1);
        }
        return true;
      }
      default:
        return false;
    }
  };

  const handleInput = (event: KeyboardEvent): boolean => {
    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      updateQuery(props.state.query + input);
      return true;
    }
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const fileOpenerBindings = config.keybindings().fileOpener;
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!vimEnabled()) {
      const action = matchKeybinding(fileOpenerBindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (vimMode() === 'insert') {
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      const action = matchKeybinding(fileOpenerBindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      setVimMode('insert');
      vimHandler.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = vimHandler.handleCombo(combo);
    if (result.pending) return true;
    if (handleAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings =
      !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const action = matchKeybinding(fileOpenerBindings, keyEvent);
      if (handleAction(action)) return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'fileOpener',
    isActive: () => props.state.show,
    handler: handleKeyDown,
  });

  /** Discover files when the overlay opens */
  createEffect(() => {
    if (!props.state.show) return;
    if (props.state.files.length > 0) return;
    if (!props.state.rootDir) return;

    const settings = config.config().fileOpener;
    void discoverFiles(props.state.rootDir, settings).then((files) => {
      if (!props.state.show) return; // closed while discovering
      props.setState({ files, loading: false });
    });
  });

  createEffect(() => {
    if (!props.state.show) return;
    if (vimEnabled()) {
      setVimMode('normal');
    }
    vimHandler.reset();
  });

  createEffect(() => {
    props.onVimModeChange?.(vimMode());
  });

  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs;
    vimHandler.reset();
    vimHandler = createVimSequenceHandler({
      timeoutMs,
      sequences: [
        { keys: ['j'], action: 'file.opener.down' },
        { keys: ['k'], action: 'file.opener.up' },
        { keys: ['g', 'g'], action: 'file.opener.top' },
        { keys: ['shift+g'], action: 'file.opener.bottom' },
        { keys: ['enter'], action: 'file.opener.confirm' },
        { keys: ['q'], action: 'file.opener.close' },
      ],
    });
  });

  createEffect(() => {
    const count = resultCount();
    if (props.state.selectedIndex >= count) {
      props.setState('selectedIndex', Math.max(0, count - 1));
    }
  });

  const overlayWidth = () => Math.min(70, props.width - 4);
  const innerWidth = () => Math.max(1, overlayWidth() - 4);

  const listHeight = () => {
    if (!showResults()) return 0;
    const maxRows = Math.max(1, props.height - 7);
    const rowCount = resultCount();
    return Math.min(Math.max(1, rowCount), maxRows);
  };

  const overlayHeight = () => {
    if (props.state.loading) return 3;
    if (!showResults()) return 3;
    return Math.min(listHeight() + 3, props.height - 4);
  };
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => {
    const desiredCommandY = Math.floor(props.height * 0.15);
    const desired = Math.max(0, desiredCommandY - 1);
    const maxY = Math.max(0, props.height - overlayHeight());
    return Math.min(desired, maxY);
  };

  const listStartIndex = createMemo(() => {
    if (!showResults()) return 0;
    const count = resultCount();
    const visible = listHeight();
    if (count <= visible || visible === 0) return 0;
    const half = Math.floor(visible / 2);
    return Math.min(Math.max(0, props.state.selectedIndex - half), Math.max(0, count - visible));
  });

  const visibleFiles = createMemo(() => {
    if (!showResults()) return [];
    const start = listStartIndex();
    return filteredFiles().slice(start, start + listHeight());
  });

  const matchDisplay = () => {
    if (props.state.loading) return '...';
    if (resultCount() === 0) return '0 matches';
    return `${props.state.selectedIndex + 1}/${resultCount()}`;
  };

  const promptText = '> ';
  const spacerText = ' ';
  const cursorText = '_';

  const hintText = () => {
    if (vimEnabled()) {
      const modeHint = vimMode() === 'insert' ? 'esc:normal' : 'i:insert';
      return `j/k:nav gg/G:jump enter:open q:close ${modeHint}`;
    }
    const fileOpenerBindings = config.keybindings().fileOpener;
    const nav = formatComboSet([
      ...getCombos(fileOpenerBindings, 'file.opener.up'),
      ...getCombos(fileOpenerBindings, 'file.opener.down'),
    ]);
    const run = formatComboSet(getCombos(fileOpenerBindings, 'file.opener.confirm'));
    const close = formatComboSet(getCombos(fileOpenerBindings, 'file.opener.close'));
    return `${nav}:nav ${run}:open ${close}:close`;
  };

  const queryDisplay = () => props.state.query || ' ';

  const hintWidth = createMemo(() => {
    const reserved =
      promptText.length +
      spacerText.length * 2 +
      cursorText.length +
      matchDisplay().length +
      queryDisplay().length;
    return Math.max(0, innerWidth() - reserved);
  });

  const hintDisplay = () => truncateHint(hintText(), hintWidth());

  return (
    <Show when={props.state.show}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth(),
          height: overlayHeight(),
          border: true,
          borderStyle: 'rounded',
          borderColor: accentColor(),
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
          zIndex: 160,
        }}
        backgroundColor={overlayBg()}
        title=" Open File "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg={accentColor()}>{promptText}</text>
            <text fg={overlayFg()}>{queryDisplay()}</text>
            <text fg={accentColor()}>{cursorText}</text>
            <text fg={overlaySeparator()}>{spacerText}</text>
            <text fg={resultCount() > 0 ? overlayMatch() : overlaySubtle()}>{matchDisplay()}</text>
            <Show when={hintDisplay().length > 0}>
              <text fg={overlaySeparator()}>{spacerText}</text>
              <text fg={overlaySubtle()}>{hintDisplay()}</text>
            </Show>
          </box>

          <Show when={visibleFiles().length > 0}>
            <For each={visibleFiles()}>
              {(entry, index) => (
                <box style={{ height: 1 }}>
                  <FileRow
                    entry={entry}
                    isSelected={listStartIndex() + index() === props.state.selectedIndex}
                    maxWidth={innerWidth()}
                    query={hasQuery() ? props.state.query.trim().toLowerCase() : ''}
                    selection={theme.ui.listSelection}
                    colors={{
                      foreground: overlayFg(),
                      muted: overlayMuted(),
                      subtle: overlaySubtle(),
                      accent: accentColor(),
                    }}
                  />
                </box>
              )}
            </For>
          </Show>
        </box>
      </box>
    </Show>
  );
}

interface FileRowProps {
  entry: FileEntry;
  isSelected: boolean;
  maxWidth: number;
  query: string;
  selection: {
    foreground: string;
    background: string;
  };
  colors: {
    foreground: string;
    muted: string;
    subtle: string;
    accent: string;
  };
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) {
    if (width <= 3) return text.slice(0, width);
    return text.slice(0, width - 3) + '...';
  }
  return text.padEnd(width);
}

function FileRow(props: FileRowProps) {
  if (props.entry.isFolderAction) {
    const fg = () => (props.isSelected ? props.selection.foreground : props.colors.accent);
    const bg = () => (props.isSelected ? props.selection.background : undefined);
    const FOLDER_ICON = '';
    const text = () => fitLine('Open folder', props.maxWidth - 4);

    return (
      <text fg={fg()} bg={bg()}>
        {`  ${FOLDER_ICON} ${text()}`}
      </text>
    );
  }

  const dirPart = () => {
    const parts = props.entry.relativePath.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/') + '/';
  };
  const basename = () => {
    const parts = props.entry.relativePath.split('/');
    return parts[parts.length - 1] ?? '';
  };

  const fg = () => (props.isSelected ? props.selection.foreground : props.colors.foreground);
  const bg = () => (props.isSelected ? props.selection.background : undefined);

  const indent = '  ';
  const dir = dirPart();
  const base = basename();
  const fullLine = fitLine(`${indent}${dir}${base}`, props.maxWidth);

  return (
    <text fg={fg()} bg={bg()}>
      {fullLine}
    </text>
  );
}
