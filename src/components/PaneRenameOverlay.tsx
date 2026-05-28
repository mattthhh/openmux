/**
 * PaneRenameOverlay - modal overlay for renaming panes
 */

import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { type SetStoreFunction } from 'solid-js/store';
import { useConfig } from '../contexts/ConfigContext';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTitle } from '../contexts/TitleContext';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { eventToCombo } from '../core/keybindings';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import type { KeyboardEvent } from '../effect/bridge';
import { useOverlayColors } from './overlay-colors';
import { truncateHint } from './overlay-hints';
import { DEFAULT_PANE_TITLE, resolvePaneRename } from './pane-rename-utils';

const VIM_SEQUENCES = [
  { keys: ['enter'], action: 'pane.rename.confirm' },
  { keys: ['q'], action: 'pane.rename.close' },
];

export interface PaneRenameState {
  show: boolean;
  paneId: string | null;
  value: string;
}

interface PaneRenameOverlayProps {
  width: number;
  height: number;
  state: PaneRenameState;
  setState: SetStoreFunction<PaneRenameState>;
  onVimModeChange?: (mode: VimInputMode) => void;
}

export function PaneRenameOverlay(props: PaneRenameOverlayProps) {
  const config = useConfig();
  const theme = useTheme();
  const layout = useLayout();
  const titleContext = useTitle();
  const {
    background: overlayBg,
    foreground: overlayFg,
    separator: overlaySeparator,
    subtle: overlaySubtle,
  } = useOverlayColors();

  const accentColor = () => theme.pane.focusedBorderColor;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: VIM_SEQUENCES,
  });

  const closeOverlay = () => {
    props.setState({ show: false, paneId: null, value: '' });
  };

  const updateValue = (value: string) => {
    props.setState({ value });
  };

  const applyRename = () => {
    const paneId = props.state.paneId;
    if (!paneId) {
      closeOverlay();
      return;
    }
    const result = resolvePaneRename(props.state.value, DEFAULT_PANE_TITLE);
    layout.setPaneTitle(paneId, result.title);
    if (result.type === 'clear') {
      titleContext.clearManualTitle(paneId);
      closeOverlay();
      return;
    }
    titleContext.setManualTitle(paneId, result.title);
    closeOverlay();
  };

  const deleteLast = () => {
    if (!props.state.value) return;
    updateValue(props.state.value.slice(0, -1));
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const isConfirmKey = (event: KeyboardEvent) => {
    const combo = eventToCombo({
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });
    return combo === 'enter';
  };

  const handleInput = (event: KeyboardEvent): boolean => {
    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      updateValue(props.state.value + input);
      return true;
    }
    return true;
  };

  const handleAction = (action: string | null): boolean => {
    switch (action) {
      case 'pane.rename.close':
        closeOverlay();
        return true;
      case 'pane.rename.confirm':
        applyRename();
        return true;
      case 'pane.rename.delete':
        deleteLast();
        return true;
      default:
        return false;
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!vimEnabled()) {
      if (isConfirmKey(event)) {
        applyRename();
        return true;
      }
      if (isBareEscape(event)) {
        closeOverlay();
        return true;
      }
      if (event.key === 'backspace') {
        deleteLast();
        return true;
      }
      return handleInput(event);
    }

    if (vimMode() === 'insert') {
      if (isBareEscape(event)) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      if (isConfirmKey(event)) {
        applyRename();
        return true;
      }
      if (event.key === 'backspace') {
        deleteLast();
        return true;
      }
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

    if (isBareEscape(event)) {
      closeOverlay();
      return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'paneRename',
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
      sequences: VIM_SEQUENCES,
    });
  });

  const overlayWidth = () => Math.min(70, props.width - 4);
  const innerWidth = () => Math.max(1, overlayWidth() - 4);
  const overlayHeight = 3;
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => {
    const desiredCommandY = Math.floor(props.height * 0.15);
    const desired = Math.max(0, desiredCommandY - 1);
    const maxY = Math.max(0, props.height - overlayHeight);
    return Math.min(desired, maxY);
  };

  const promptText = 'name: ';
  const spacerText = ' ';
  const cursorText = '_';

  const valueDisplay = () => props.state.value || ' ';

  const hintText = () => {
    if (vimEnabled()) {
      const modeHint = vimMode() === 'insert' ? 'esc:normal' : 'i:insert';
      return `enter:save q:close ${modeHint} empty:shell`;
    }
    return 'enter:save esc:close backspace:del empty:shell';
  };

  const hintWidth = createMemo(() => {
    const reserved =
      promptText.length + spacerText.length * 2 + cursorText.length + valueDisplay().length;
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
          height: overlayHeight,
          border: true,
          borderStyle: 'rounded',
          borderColor: accentColor(),
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
          zIndex: 158,
        }}
        backgroundColor={overlayBg()}
        title=" Rename Pane "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg={accentColor()}>{promptText}</text>
          <text fg={overlayFg()}>{valueDisplay()}</text>
          <text fg={accentColor()}>{cursorText}</text>
          <Show when={hintDisplay().length > 0}>
            <text fg={overlaySeparator()}>{spacerText}</text>
            <text fg={overlaySubtle()}>{hintDisplay()}</text>
          </Show>
        </box>
      </box>
    </Show>
  );
}
