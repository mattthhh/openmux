/**
 * DiffOpener - modal overlay for selecting a git diff target
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
import { filterDiffTargets } from './diff-opener-utils';
import { discoverDiffTargets, type DiffTarget } from '../core/diff-opener';

export interface DiffOpenerState {
  show: boolean;
  query: string;
  selectedIndex: number;
  targets: DiffTarget[];
  rootDir: string;
  loading: boolean;
}

interface DiffOpenerProps {
  width: number;
  height: number;
  state: DiffOpenerState;
  setState: SetStoreFunction<DiffOpenerState>;
  onSelect: (target: DiffTarget) => void;
  onVimModeChange?: (mode: VimInputMode) => void;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function DiffOpener(props: DiffOpenerProps) {
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
  const filteredTargets = createMemo(() =>
    filterDiffTargets(props.state.targets, props.state.query)
  );
  const accentColor = () => theme.searchAccentColor;
  const resultCount = () => filteredTargets().length;
  const showResults = () => resultCount() > 0 && !props.state.loading;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: [
      { keys: ['j'], action: 'diff.opener.down' },
      { keys: ['k'], action: 'diff.opener.up' },
      { keys: ['g', 'g'], action: 'diff.opener.top' },
      { keys: ['shift+g'], action: 'diff.opener.bottom' },
      { keys: ['enter'], action: 'diff.opener.confirm' },
      { keys: ['q'], action: 'diff.opener.close' },
    ],
  });

  const closeOpener = () => {
    props.setState({ show: false, query: '', selectedIndex: 0, targets: [], loading: false });
  };

  const updateQuery = (query: string) => {
    props.setState({ query, selectedIndex: 0 });
  };

  const moveSelection = (direction: 'up' | 'down') => {
    const nonSeparator = filteredTargets().filter((t) => !t.isSeparator);
    const count = nonSeparator.length;
    if (count === 0) return;

    const currentTarget = filteredTargets()[props.state.selectedIndex];
    const currentIdx = currentTarget ? nonSeparator.indexOf(currentTarget) : -1;
    const delta = direction === 'down' ? 1 : -1;
    const nextIdx = (currentIdx + delta + count) % count;
    const nextTarget = nonSeparator[nextIdx]!;
    const globalIdx = filteredTargets().indexOf(nextTarget);
    props.setState('selectedIndex', globalIdx);
  };

  const executeSelected = () => {
    const target = filteredTargets()[props.state.selectedIndex];
    if (!target || target.isSeparator) return;
    closeOpener();
    props.onSelect(target);
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleAction = (action: string | null): boolean => {
    switch (action) {
      case 'diff.opener.close':
        closeOpener();
        return true;
      case 'diff.opener.down':
        moveSelection('down');
        return true;
      case 'diff.opener.up':
        moveSelection('up');
        return true;
      case 'diff.opener.confirm':
        executeSelected();
        return true;
      case 'diff.opener.delete':
        updateQuery(props.state.query.slice(0, -1));
        return true;
      case 'diff.opener.top':
        props.setState('selectedIndex', 0);
        return true;
      case 'diff.opener.bottom': {
        const nonSeparator = filteredTargets().filter((t) => !t.isSeparator);
        if (nonSeparator.length > 0) {
          const last = nonSeparator[nonSeparator.length - 1]!;
          const globalIdx = filteredTargets().indexOf(last);
          props.setState('selectedIndex', globalIdx);
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
    const diffOpenerBindings = config.keybindings().diffOpener;
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!vimEnabled()) {
      const action = matchKeybinding(diffOpenerBindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (vimMode() === 'insert') {
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      const action = matchKeybinding(diffOpenerBindings, keyEvent);
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
      const action = matchKeybinding(diffOpenerBindings, keyEvent);
      if (handleAction(action)) return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'diffOpener',
    isActive: () => props.state.show,
    handler: handleKeyDown,
  });

  createEffect(() => {
    if (!props.state.show) return;
    if (props.state.targets.length > 0) return;
    if (!props.state.rootDir) return;

    void discoverDiffTargets(props.state.rootDir).then((targets) => {
      if (!props.state.show) return;
      props.setState({ targets, loading: false });
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
        { keys: ['j'], action: 'diff.opener.down' },
        { keys: ['k'], action: 'diff.opener.up' },
        { keys: ['g', 'g'], action: 'diff.opener.top' },
        { keys: ['shift+g'], action: 'diff.opener.bottom' },
        { keys: ['enter'], action: 'diff.opener.confirm' },
        { keys: ['q'], action: 'diff.opener.close' },
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
    const maxVisible = 15;
    const maxRows = Math.min(Math.max(1, props.height - 7), maxVisible);
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

  const visibleTargets = createMemo(() => {
    if (!showResults()) return [];
    const start = listStartIndex();
    return filteredTargets().slice(start, start + listHeight());
  });

  const matchDisplay = () => {
    if (props.state.loading) return '...';
    const nonSeparator = filteredTargets().filter((t) => !t.isSeparator);
    if (nonSeparator.length === 0) return '0 targets';
    const current = filteredTargets()[props.state.selectedIndex];
    const idx = current && !current.isSeparator ? nonSeparator.indexOf(current) + 1 : 0;
    return `${idx}/${nonSeparator.length}`;
  };

  const promptText = '> ';
  const spacerText = ' ';
  const cursorText = '_';

  const hintText = () => {
    if (vimEnabled()) {
      const modeHint = vimMode() === 'insert' ? 'esc:normal' : 'i:insert';
      return `j/k:nav gg/G:jump enter:open q:close ${modeHint}`;
    }
    const diffOpenerBindings = config.keybindings().diffOpener;
    const nav = formatComboSet([
      ...getCombos(diffOpenerBindings, 'diff.opener.up'),
      ...getCombos(diffOpenerBindings, 'diff.opener.down'),
    ]);
    const run = formatComboSet(getCombos(diffOpenerBindings, 'diff.opener.confirm'));
    const close = formatComboSet(getCombos(diffOpenerBindings, 'diff.opener.close'));
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
        title=" Diff "
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

          <Show when={visibleTargets().length > 0}>
            <For each={visibleTargets()}>
              {(target, index) => (
                <box style={{ height: 1 }}>
                  <DiffRow
                    target={target}
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

interface DiffRowProps {
  target: DiffTarget;
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

const DIFF_ICON = '\uF4A0';
const BRANCH_ICON = '\uE725';
const COMMIT_ICON = '\uF417';

function DiffRow(props: DiffRowProps) {
  if (props.target.isSeparator) {
    const sep = '\u2500'.repeat(Math.max(0, props.maxWidth - 4));
    return <text fg={props.colors.subtle}>{`  ${sep}`}</text>;
  }

  const fg = () => (props.isSelected ? props.selection.foreground : props.colors.foreground);
  const bg = () => (props.isSelected ? props.selection.background : undefined);

  const icon =
    props.target.type === 'branch'
      ? BRANCH_ICON
      : props.target.type === 'lastCommit'
        ? COMMIT_ICON
        : DIFF_ICON;
  const label = props.target.label;
  const countStr = props.target.fileCount !== undefined ? ` (${props.target.fileCount})` : '';
  const fullLine = fitLine(`  ${icon} ${label}${countStr}`, props.maxWidth);

  return (
    <text fg={fg()} bg={bg()}>
      {fullLine}
    </text>
  );
}
