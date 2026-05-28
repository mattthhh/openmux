/**
 * CommandPalette - modal overlay for command search and execution
 */

import { Show, For, createMemo, createEffect, createSignal } from 'solid-js';
import { type SetStoreFunction } from 'solid-js/store';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  eventToCombo,
  formatComboSet,
  formatKeyCombo,
  matchKeybinding,
  type ResolvedKeybindingMap,
  type ResolvedKeybindings,
} from '../core/keybindings';
import type { CommandPaletteCommand } from '../core/command-palette';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import type { KeyboardEvent } from '../effect/bridge';
import { filterCommands } from './command-palette-utils';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import { useOverlayColors } from './overlay-colors';
import { truncateHint } from './overlay-hints';

export interface CommandPaletteState {
  show: boolean;
  query: string;
  selectedIndex: number;
}

interface CommandPaletteProps {
  width: number;
  height: number;
  commands: CommandPaletteCommand[];
  state: CommandPaletteState;
  setState: SetStoreFunction<CommandPaletteState>;
  onExecute: (command: CommandPaletteCommand) => void;
  onVimModeChange?: (mode: VimInputMode) => void;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

function getCommandKeybinding(bindings: ResolvedKeybindings, action: string): string {
  const normalCombos = getCombos(bindings.normal, action);
  if (normalCombos.length > 0) {
    return formatKeyCombo(normalCombos[0]);
  }

  const prefixCombos = getCombos(bindings.prefix, action);
  if (prefixCombos.length > 0) {
    const prefixKey = formatKeyCombo(bindings.prefixKey);
    return `${prefixKey} ${formatKeyCombo(prefixCombos[0])}`;
  }

  return '';
}

export function CommandPalette(props: CommandPaletteProps) {
  const config = useConfig();
  const theme = useTheme();
  const {
    background: overlayBg,
    foreground: overlayFg,
    muted: overlayMuted,
    subtle: overlaySubtle,
    separator: overlaySeparator,
    match: overlayMatch,
  } = useOverlayColors();

  const hasQuery = () => props.state.query.trim().length > 0;
  const filteredCommands = createMemo(() => filterCommands(props.commands, props.state.query));
  const accentColor = () => theme.searchAccentColor;
  const resultCount = () => filteredCommands().length;
  const showResults = () => resultCount() > 0;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: [
      { keys: ['j'], action: 'command.palette.down' },
      { keys: ['k'], action: 'command.palette.up' },
      { keys: ['g', 'g'], action: 'command.palette.top' },
      { keys: ['shift+g'], action: 'command.palette.bottom' },
      { keys: ['enter'], action: 'command.palette.confirm' },
      { keys: ['q'], action: 'command.palette.close' },
    ],
  });

  const closePalette = () => {
    props.setState({ show: false, query: '', selectedIndex: 0 });
  };

  const updateQuery = (query: string) => {
    props.setState({ query, selectedIndex: 0 });
  };

  const moveSelection = (direction: 'up' | 'down') => {
    const count = filteredCommands().length;
    if (count === 0) return;

    const delta = direction === 'down' ? 1 : -1;
    const nextIndex = (props.state.selectedIndex + delta + count) % count;
    props.setState('selectedIndex', nextIndex);
  };

  const executeSelected = () => {
    const command = filteredCommands()[props.state.selectedIndex];
    if (!command) return;
    closePalette();
    props.onExecute(command);
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleAction = (action: string | null): boolean => {
    switch (action) {
      case 'command.palette.close':
        closePalette();
        return true;
      case 'command.palette.down':
        moveSelection('down');
        return true;
      case 'command.palette.up':
        moveSelection('up');
        return true;
      case 'command.palette.confirm':
        executeSelected();
        return true;
      case 'command.palette.delete':
        updateQuery(props.state.query.slice(0, -1));
        return true;
      case 'command.palette.top':
        props.setState('selectedIndex', 0);
        return true;
      case 'command.palette.bottom': {
        const count = filteredCommands().length;
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
    const bindings = config.keybindings().commandPalette;
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!vimEnabled()) {
      const action = matchKeybinding(bindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (vimMode() === 'insert') {
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      const action = matchKeybinding(bindings, keyEvent);
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
      const action = matchKeybinding(bindings, keyEvent);
      if (handleAction(action)) return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'commandPalette',
    isActive: () => props.state.show,
    handler: handleKeyDown,
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
        { keys: ['j'], action: 'command.palette.down' },
        { keys: ['k'], action: 'command.palette.up' },
        { keys: ['g', 'g'], action: 'command.palette.top' },
        { keys: ['shift+g'], action: 'command.palette.bottom' },
        { keys: ['enter'], action: 'command.palette.confirm' },
        { keys: ['q'], action: 'command.palette.close' },
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
    if (!hasQuery()) return 3;
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

  const visibleCommands = createMemo(() => {
    if (!showResults()) return [];
    const start = listStartIndex();
    return filteredCommands().slice(start, start + listHeight());
  });

  const commandBindings = createMemo(() => {
    const bindings = config.keybindings();
    const entries = filteredCommands().map(
      (command) => [command.id, getCommandKeybinding(bindings, command.action)] as const
    );
    return new Map(entries);
  });

  const keybindingColumnWidth = createMemo(() => {
    const commands = visibleCommands();
    if (commands.length === 0) return 0;
    const maxBinding = Math.max(
      ...commands.map((command) => commandBindings().get(command.id)?.length ?? 0),
      0
    );
    const minTitleWidth = 18;
    const available = Math.max(0, innerWidth() - minTitleWidth - 1);
    return Math.min(maxBinding, available);
  });

  const matchDisplay = () => {
    if (!hasQuery()) return '';
    if (resultCount() === 0) return '0 matches';
    return `${props.state.selectedIndex + 1}/${resultCount()}`;
  };

  const promptText = '> ';
  const spacerText = ' ';
  const cursorText = '_';

  const hintText = () => {
    if (vimEnabled()) {
      const modeHint = vimMode() === 'insert' ? 'esc:normal' : 'i:insert';
      return `j/k:nav gg/G:jump enter:run q:close ${modeHint}`;
    }
    const bindings = config.keybindings().commandPalette;
    const nav = formatComboSet([
      ...getCombos(bindings, 'command.palette.up'),
      ...getCombos(bindings, 'command.palette.down'),
    ]);
    const run = formatComboSet(getCombos(bindings, 'command.palette.confirm'));
    const close = formatComboSet(getCombos(bindings, 'command.palette.close'));
    return `${nav}:nav ${run}:run ${close}:close`;
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
        title=" Command Palette "
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

          <Show when={visibleCommands().length > 0}>
            <For each={visibleCommands()}>
              {(command, index) => (
                <box style={{ height: 1 }}>
                  <CommandRow
                    command={command}
                    isSelected={listStartIndex() + index() === props.state.selectedIndex}
                    maxWidth={innerWidth()}
                    keybinding={commandBindings().get(command.id) ?? ''}
                    keybindingWidth={keybindingColumnWidth()}
                    selection={theme.ui.listSelection}
                    colors={{
                      foreground: overlayFg(),
                      muted: overlayMuted(),
                      subtle: overlaySubtle(),
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

interface CommandRowProps {
  command: CommandPaletteCommand;
  isSelected: boolean;
  maxWidth: number;
  keybinding: string;
  keybindingWidth: number;
  selection: {
    foreground: string;
    background: string;
  };
  colors: {
    foreground: string;
    muted: string;
    subtle: string;
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

function fitRight(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) {
    if (width <= 3) return text.slice(0, width);
    return text.slice(0, width - 3) + '...';
  }
  return text.padStart(width);
}

function CommandRow(props: CommandRowProps) {
  const details = () => (props.command.description ? ` - ${props.command.description}` : '');
  const keybindingWidth = () => props.keybindingWidth;
  const keybindingText = () => fitRight(props.keybinding, keybindingWidth());
  const titleWidth = () =>
    Math.max(0, props.maxWidth - (keybindingWidth() ? keybindingWidth() + 1 : 0));
  const left = () => fitLine(`  ${props.command.title}${details()}`, titleWidth());
  const fg = () => (props.isSelected ? props.selection.foreground : props.colors.foreground);
  const bindingFg = () => (props.isSelected ? props.colors.muted : props.colors.subtle);
  const bg = () => (props.isSelected ? props.selection.background : undefined);

  return (
    <box style={{ flexDirection: 'row' }}>
      <text fg={fg()} bg={bg()}>
        {left()}
      </text>
      <Show when={keybindingWidth()}>
        <text fg={bindingFg()} bg={bg()}>
          {` ${keybindingText()}`}
        </text>
      </Show>
    </box>
  );
}
