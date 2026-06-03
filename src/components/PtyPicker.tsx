/**
 * PtyPicker - fuzzy-finder overlay for PTY selection inside the aggregate view.
 *
 * Shows ALL PTYs in the same session-grouped order as the sidebar, with
 * active PTYs visually highlighted and inactive ones dimmed. No default
 * filter — the full list is always visible.
 *
 * Vim mode is respected: when vim mode is enabled, starts in normal mode
 * (j/k to navigate, i to enter insert/filter mode). When vim mode is
 * off, typing immediately filters.
 *
 * Uses the shared MRU stack (AggregateViewContext.ptyMru) for alt-tab
 * selection. On open, pushes the current selectedPtyId to MRU (ensuring
 * freshness), then walks MRU[1...] to find the "previous" PTY.
 *
 * Reads PTYs from AggregateViewContext.flattenedTree to match sidebar
 * order — no mutations on the aggregate view itself beyond
 * selectPty/enterPreviewMode/pushPtyMru.
 */

import { Show, For, createEffect, createSignal, createMemo, untrack } from 'solid-js';
import { useAggregateView, type PtyInfo } from '../contexts/AggregateViewContext';
import type { FlattenedTreeItem } from '../contexts/aggregate-view-types';
import { useTheme } from '../contexts/ThemeContext';
import { useConfig } from '../contexts/ConfigContext';
import { eventToCombo, matchKeybinding } from '../core/keybindings';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import type { KeyboardEvent } from '../effect/bridge';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import { useOverlayColors } from './overlay-colors';
import { truncateHint } from './overlay-hints';
import { isActivePty } from '../contexts/aggregate/filter';
import { getDirectoryName } from './aggregate/utils';

interface PtyPickerProps {
  width: number;
  height: number;
  activePtyId: string | null;
  onVimModeChange?: (mode: VimInputMode) => void;
}

/** Extract PTYs from flattened tree in sidebar order (session-grouped). */
function extractPtysInTreeOrder(items: FlattenedTreeItem[]): PtyInfo[] {
  const ptys: PtyInfo[] = [];
  for (const item of items) {
    if (item.node.type === 'pty') {
      ptys.push(item.node.ptyInfo);
    }
  }
  return ptys;
}

function filterPickerPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return ptys;

  const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    const title = pty.title?.toLowerCase() ?? '';
    return terms.some(
      (term) =>
        cwd.includes(term) ||
        branch.includes(term) ||
        process.includes(term) ||
        title.includes(term)
    );
  });
}

function formatPtyLabel(pty: PtyInfo): string {
  const directoryName = getDirectoryName(pty.cwd).trim();
  const processBase = pty.foregroundProcess?.trim().split('/').pop()?.trim() ?? '';
  const shellBase = pty.shell?.trim().split('/').pop()?.toLowerCase() ?? '';
  const title = pty.title?.trim() ?? '';

  const isShellProcess = !processBase || processBase.toLowerCase() === shellBase;
  const baseLabel = directoryName || title || shellBase || 'shell';

  if (isShellProcess || processBase === baseLabel) {
    return baseLabel;
  }

  return `${baseLabel} (${processBase})`;
}

/** Fixed overlay height — never grows beyond this regardless of PTY count */
const MAX_OVERLAY_HEIGHT = 20;

export function PtyPicker(props: PtyPickerProps) {
  const theme = useTheme();
  const config = useConfig();
  const aggregate = useAggregateView();

  const {
    background: overlayBg,
    foreground: overlayFg,
    subtle: overlaySubtle,
    separator: overlaySeparator,
  } = useOverlayColors();
  const accentColor = () => theme.pane.focusedBorderColor;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');

  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: [
      { keys: ['j'], action: 'pty.picker.down' },
      { keys: ['k'], action: 'pty.picker.up' },
      { keys: ['g', 'g'], action: 'pty.picker.top' },
      { keys: ['shift+g'], action: 'pty.picker.bottom' },
      { keys: ['q'], action: 'pty.picker.close' },
    ],
  });

  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  /** Snapshot of PTYs taken when the picker opens — stays stable while open */
  const [snapshotPtys, setSnapshotPtys] = createSignal<PtyInfo[]>([]);

  /** PTYs in sidebar tree order, filtered by search query if present. */
  const pickerPtys = createMemo(() => {
    const ptys = snapshotPtys();
    const query = searchQuery();
    if (query.trim()) {
      return filterPickerPtys(ptys, query);
    }
    return ptys;
  });

  /** Take a snapshot and auto-select when the picker opens */
  createEffect(() => {
    if (!aggregate.state.showPtyPicker) return;

    // Snapshot PTYs from the flattened tree so the picker uses the same
    // session-grouped order as the sidebar — no re-sorting, no instability.
    const treePtys = untrack(() => extractPtysInTreeOrder(aggregate.state.flattenedTree));
    setSnapshotPtys(treePtys);
    setSearchQuery('');
    vimHandler.reset();

    if (vimEnabled()) {
      setVimMode('normal');
    }

    // Push the current selection to MRU immediately. This ensures the MRU
    // is fresh even if the debounce hasn't fired yet (e.g., user opened
    // the picker right after a sidebar click or j/k navigation).
    const currentPtyId = untrack(() => aggregate.state.selectedPtyId);
    if (currentPtyId) {
      aggregate.pushPtyMru(currentPtyId);
    }

    // Read MRU inside untrack to prevent the pushPtyMru write above
    // from triggering this effect to re-run.
    const mru = untrack(() => aggregate.state.ptyMru);

    const trySelect = (ptyId: string | null) => {
      if (!ptyId) return -1;
      return treePtys.findIndex((p) => p.ptyId === ptyId);
    };

    /**
     * Alt-tab selection using MRU stack:
     * - MRU[0] is the most recently settled PTY (just pushed above = "current")
     * - MRU[1] is the second most recently settled (= "previous" — the alt-tab target)
     * - Walk from MRU[1] onward; the first entry found in the sorted list wins.
     * - If the MRU is exhausted, fall back to the first PTY that isn't
     *   the workspace's active PTY, then first PTY overall.
     */
    for (let i = 1; i < mru.length; i++) {
      const candidateId = mru[i];
      const idx = trySelect(candidateId);
      if (idx >= 0) {
        setSelectedIndex(idx);
        return;
      }
    }

    // Fallback: first PTY that isn't the workspace's active PTY
    const activeId = untrack(() => props.activePtyId);
    if (activeId) {
      const altIdx = treePtys.findIndex((p) => p.ptyId !== activeId);
      if (altIdx >= 0) {
        setSelectedIndex(altIdx);
        return;
      }
    }

    // Last resort: first PTY
    setSelectedIndex(0);
  });

  /** Clamp selection when the filtered list changes */
  createEffect(() => {
    const count = pickerPtys().length;
    const current = selectedIndex();
    if (count === 0) {
      setSelectedIndex(0);
    } else if (current >= count) {
      setSelectedIndex(count - 1);
    }
  });

  const navigateUp = () => {
    const idx = selectedIndex();
    if (idx > 0) setSelectedIndex(idx - 1);
  };

  const navigateDown = () => {
    const idx = selectedIndex();
    const count = pickerPtys().length;
    if (idx < count - 1) setSelectedIndex(idx + 1);
  };

  const handleSelect = () => {
    const pty = pickerPtys()[selectedIndex()];
    if (!pty) return;
    // The debounce in AggregateStateManager will push to MRU after
    // the user settles on this PTY. No immediate push here.
    aggregate.closePtyPicker();
    aggregate.selectPty(pty.ptyId);
    aggregate.enterPreviewMode();
  };

  const handleAction = (action: string | null): boolean => {
    switch (action) {
      case 'pty.picker.close':
        aggregate.closePtyPicker();
        return true;
      case 'pty.picker.down':
        navigateDown();
        return true;
      case 'pty.picker.up':
        navigateUp();
        return true;
      case 'pty.picker.select':
        handleSelect();
        return true;
      case 'pty.picker.top':
        setSelectedIndex(0);
        return true;
      case 'pty.picker.bottom': {
        const count = pickerPtys().length;
        if (count > 0) setSelectedIndex(count - 1);
        return true;
      }
      case 'pty.picker.filter.delete':
        setSearchQuery(searchQuery().slice(0, -1));
        return true;
      default:
        return false;
    }
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const { key } = event;
    const bindings = config.keybindings().ptyPicker;
    const keyEvent = {
      key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    // Vim mode: insert mode
    if (vimEnabled() && vimMode() === 'insert') {
      if (isBareEscape(event)) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      const action = matchKeybinding(bindings.list, keyEvent);
      if (handleAction(action)) return true;
      if (key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
        setSearchQuery(searchQuery() + key);
        return true;
      }
      return true;
    }

    // Non-vim mode or vim normal mode
    if (isBareEscape(event)) {
      aggregate.closePtyPicker();
      return true;
    }

    const action = matchKeybinding(bindings.list, keyEvent);
    if (handleAction(action)) return true;

    if (vimEnabled()) {
      if (key === 'i' && !event.ctrl && !event.alt && !event.meta) {
        setVimMode('insert');
        vimHandler.reset();
        return true;
      }

      const combo = eventToCombo(keyEvent);
      const result = vimHandler.handleCombo(combo);
      if (result.pending) return true;
      if (handleAction(result.action)) return true;

      return true;
    }

    if (key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      setSearchQuery(searchQuery() + key);
      return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'ptyPicker',
    isActive: () => aggregate.state.showPtyPicker,
    handler: handleKeyDown,
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
        { keys: ['j'], action: 'pty.picker.down' },
        { keys: ['k'], action: 'pty.picker.up' },
        { keys: ['g', 'g'], action: 'pty.picker.top' },
        { keys: ['shift+g'], action: 'pty.picker.bottom' },
        { keys: ['q'], action: 'pty.picker.close' },
      ],
    });
  });

  // Fixed-size layout
  const overlayWidth = () => Math.min(56, props.width - 4);
  const overlayHeight = () => Math.min(MAX_OVERLAY_HEIGHT, props.height - 4);
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight()) / 2);

  const buildHintText = () => {
    if (vimEnabled()) {
      const modeHint = vimMode() === 'insert' ? 'esc:normal' : 'i:filter';
      return `j/k:nav gg/G:jump q:close enter:preview ${modeHint} esc:close`;
    }
    return `↑↓:nav enter:preview bs:clear esc:close`;
  };

  const hintWidth = () => Math.max(1, overlayWidth() - 4);
  const hintDisplay = () => truncateHint(buildHintText(), hintWidth());

  // Scrollable viewport inside the fixed overlay
  const maxVisibleRows = () => Math.max(0, overlayHeight() - 6);
  const scrollOffset = () => {
    const idx = selectedIndex();
    const max = maxVisibleRows();
    if (idx < max) return 0;
    return idx - max + 1;
  };
  const visiblePtys = () => {
    const offset = scrollOffset();
    return pickerPtys().slice(offset, offset + maxVisibleRows());
  };
  const visibleStartIndex = () => scrollOffset();

  const activePtyId = () => props.activePtyId;

  return (
    <Show when={aggregate.state.showPtyPicker}>
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
          zIndex: 150,
        }}
        backgroundColor={overlayBg()}
        title=" PTYs "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          {/* Search bar */}
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg={overlaySubtle()}>Search: </text>
            <text fg={overlayFg()}>{searchQuery() + '_'}</text>
          </box>

          {/* Separator */}
          <box style={{ height: 1 }}>
            <text fg={overlaySeparator()}>{'─'.repeat(overlayWidth() - 4)}</text>
          </box>

          {/* PTY list (scrollable) */}
          <box style={{ height: maxVisibleRows(), flexDirection: 'column' }}>
            <Show
              when={pickerPtys().length > 0}
              fallback={
                <box style={{ height: 1 }}>
                  <text fg={overlaySubtle()}>
                    {searchQuery().trim() ? '  No matches' : '  No PTYs'}
                  </text>
                </box>
              }
            >
              <For each={visiblePtys()}>
                {(pty, localIndex) => (
                  <box style={{ height: 1 }}>
                    <PtyRow
                      pty={pty}
                      isSelected={localIndex() + visibleStartIndex() === selectedIndex()}
                      isActivePty={pty.ptyId === activePtyId()}
                      isActiveProcess={isActivePty(pty)}
                      maxWidth={overlayWidth() - 4}
                      textColor={overlayFg()}
                      activeColor={accentColor()}
                      subtleColor={overlaySubtle()}
                      selection={theme.ui.listSelection}
                    />
                  </box>
                )}
              </For>
            </Show>
          </box>

          {/* Footer with hints */}
          <box style={{ height: 1 }}>
            <text fg={overlaySeparator()}>{'─'.repeat(overlayWidth() - 4)}</text>
          </box>
          <box style={{ height: 1 }}>
            <text fg={overlaySubtle()}>{hintDisplay()}</text>
          </box>
        </box>
      </box>
    </Show>
  );
}

interface PtyRowProps {
  pty: PtyInfo;
  isSelected: boolean;
  isActivePty: boolean;
  isActiveProcess: boolean;
  maxWidth: number;
  textColor: string;
  activeColor: string;
  subtleColor: string;
  selection: {
    foreground: string;
    background: string;
  };
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) return text.slice(0, width);
  return text.padEnd(width);
}

function PtyRow(props: PtyRowProps) {
  const activeMarker = () => (props.isActivePty ? '●' : ' ');

  const label = () => formatPtyLabel(props.pty);

  const truncatedLabel = () => {
    const text = label();
    const width = props.maxWidth - 4;
    if (text.length > width) return text.slice(0, Math.max(0, width - 3)) + '...';
    return text.padEnd(width);
  };

  const nameColor = () =>
    props.isSelected
      ? props.selection.foreground
      : props.isActivePty
        ? props.activeColor
        : props.isActiveProcess
          ? props.textColor
          : props.subtleColor;
  const bgColor = () => (props.isSelected ? props.selection.background : undefined);

  const line = () => fitLine(` ${activeMarker()} ${truncatedLabel()}`, props.maxWidth);

  return (
    <text fg={nameColor()} bg={bgColor()}>
      {line()}
    </text>
  );
}
