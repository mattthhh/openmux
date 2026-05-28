/**
 * SearchOverlay - search input overlay for terminal pane search
 *
 * Displays at the bottom of the screen when search mode is active.
 * Shows search query, match count, and navigation hints.
 */

import { Show, type Accessor } from 'solid-js';
import { useConfig } from '../contexts/ConfigContext';
import { useSearch } from '../contexts/SearchContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatComboSet, type ResolvedKeybindingMap } from '../core/keybindings';
import type { SearchState } from '../contexts/search/types';
import { useOverlayColors } from './overlay-colors';
import { truncateHint } from './overlay-hints';

interface SearchOverlayProps {
  width: number;
  height: number;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function SearchOverlay(props: SearchOverlayProps) {
  const theme = useTheme();
  const config = useConfig();
  // Keep search context to access searchState reactively (it's a getter)
  const search = useSearch();
  const {
    background: overlayBg,
    foreground: overlayFg,
    separator: overlaySeparator,
    subtle: overlaySubtle,
    match: overlayMatch,
  } = useOverlayColors();
  const accentColor = () => theme.searchAccentColor;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';

  // Calculate overlay dimensions
  const overlayWidth = () => Math.min(props.width - 4, 60);
  const innerWidth = () => Math.max(1, overlayWidth() - 4);
  const overlayHeight = 3;
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => props.height - overlayHeight - 1;

  // Build match count display
  const matchDisplay = () => {
    const state = search.searchState;
    if (!state) return '';
    const { query, matches, currentMatchIndex } = state;
    if (query === '') {
      return '';
    } else if (matches.length === 0) {
      return '0 matches';
    } else {
      return `${currentMatchIndex + 1}/${matches.length}`;
    }
  };

  const hintText = () => {
    if (vimEnabled()) {
      const modeHint = search.vimMode === 'insert' ? 'esc:normal' : 'i:insert';
      return `n/N:nav enter:confirm q:cancel ${modeHint}`;
    }
    const bindings = config.keybindings().search;
    const nav = formatComboSet([
      ...getCombos(bindings, 'search.next'),
      ...getCombos(bindings, 'search.prev'),
    ]);
    const cancel = formatComboSet(getCombos(bindings, 'search.cancel'));
    return `${nav}:nav ${cancel}:cancel`;
  };

  const promptText = '/ ';
  const spacerText = ' ';
  const cursorText = '_';

  const queryDisplay = (query: string) => query || ' ';

  const hintWidth = () => {
    const reserved =
      promptText.length +
      spacerText.length * 2 +
      cursorText.length +
      matchDisplay().length +
      queryDisplay(search.searchState?.query ?? '').length;
    return Math.max(0, innerWidth() - reserved);
  };

  const hintDisplay = () => truncateHint(hintText(), hintWidth());

  return (
    <Show when={search.searchState}>
      {(state: Accessor<SearchState>) => (
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
            padding: 0,
            paddingLeft: 1,
            paddingRight: 1,
            zIndex: 150,
          }}
          backgroundColor={overlayBg()}
          title=" Search "
          titleAlignment="center"
        >
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg={accentColor()}>{promptText}</text>
            <text fg={overlayFg()}>{queryDisplay(state().query)}</text>
            <text fg={accentColor()}>{cursorText}</text>
            <text fg={overlaySeparator()}>{spacerText}</text>
            <text fg={state().matches.length > 0 ? overlayMatch() : overlaySubtle()}>
              {matchDisplay()}
            </text>
            <Show when={hintDisplay().length > 0}>
              <text fg={overlaySeparator()}>{spacerText}</text>
              <text fg={overlaySubtle()}>{hintDisplay()}</text>
            </Show>
          </box>
        </box>
      )}
    </Show>
  );
}
