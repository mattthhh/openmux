/**
 * Keyboard handlers for AggregateView
 * Handles keyboard input for list mode, preview mode, and search mode
 */

import type { KeyboardEvent } from '../../effect/bridge';
import { eventToCombo, matchKeybinding } from '../../core/keybindings';
import { createAggregateListHandler } from './keyboard/list';
import { createAggregatePreviewHandler } from './keyboard/preview';
import { createAggregateSearchHandler } from './keyboard/search';
import type { AggregateKeyboardDeps } from './keyboard/types';

export type { AggregateKeyboardDeps } from './keyboard/types';

/**
 * Creates keyboard handler for AggregateView
 */
export function createAggregateKeyboardHandler(deps: AggregateKeyboardDeps) {
  const {
    getPreviewMode,
    getInSearchMode,
    getCopyModeActive,
    getPrefixActive,
    getKeybindings,
    setPrefixActive,
    clearPrefixTimeout,
    startPrefixTimeout,
    onRequestQuit,
    onDetach,
    closeAggregateView,
    exitAggregateMode,
    exitPreviewMode,
    togglePreviewZoom,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    onToggleSessionPicker,
    onToggleCommandPalette,
    onToggleConsole,
    onPaste,
  } = deps;

  const { handleSearchModeKeys } = createAggregateSearchHandler(deps);
  const { handlePreviewModeKeys } = createAggregatePreviewHandler(deps);
  const { handleListModeKeys } = createAggregateListHandler(deps);

  /**
   * Main keyboard handler for AggregateView
   */
  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const keybindings = getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };
    const combo = eventToCombo(keyEvent);

    if (getCopyModeActive()) {
      return handleCopyModeKeys(event);
    }

    // Handle search mode first (when active in preview)
    if (getInSearchMode() && getPreviewMode()) {
      return handleSearchModeKeys(event);
    }

    if (event.eventType === 'release') {
      if (getPreviewMode()) {
        return handlePreviewModeKeys(event);
      }
      return true;
    }

    // Global prefix key handling (works in both list and preview mode)
    if (combo === keybindings.prefixKey) {
      setPrefixActive(true);
      clearPrefixTimeout();
      startPrefixTimeout();
      return true;
    }

    const globalAction = matchKeybinding(keybindings.normal, keyEvent);
    if (globalAction === 'session.picker.toggle') {
      onToggleSessionPicker?.();
      return true;
    }
    if (globalAction === 'command.palette.toggle') {
      onToggleCommandPalette?.();
      return true;
    }
    if (globalAction === 'pane.zoom' && getPreviewMode()) {
      togglePreviewZoom();
      return true;
    }

    // Prefix commands (work in both list and preview mode)
    if (getPrefixActive()) {
      const prefixAction = matchKeybinding(keybindings.aggregate.prefix, keyEvent);

      if (prefixAction) {
        setPrefixActive(false);
        clearPrefixTimeout();
      }

      switch (prefixAction) {
        case 'aggregate.prefix.quit':
          onRequestQuit?.();
          return true;
        case 'aggregate.prefix.detach':
          onDetach?.();
          return true;
        case 'aggregate.prefix.exit':
          if (getPreviewMode()) {
            exitPreviewMode();
          } else {
            closeAggregateView();
            exitAggregateMode();
          }
          return true;
        case 'aggregate.prefix.search':
          if (getPreviewMode()) {
            handleEnterSearch();
          }
          return true;
        case 'aggregate.prefix.console.toggle':
          onToggleConsole?.();
          return true;
        default:
          if (prefixAction) {
            return true;
          }
      }

      const globalPrefixAction = matchKeybinding(keybindings.prefix, keyEvent);
      if (globalPrefixAction === 'copy.mode' && getPreviewMode()) {
        setPrefixActive(false);
        clearPrefixTimeout();
        handleEnterCopyMode();
        return true;
      }

      if (globalPrefixAction === 'session.picker.toggle') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onToggleSessionPicker?.();
        return true;
      }

      if (globalPrefixAction === 'command.palette.toggle') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onToggleCommandPalette?.();
        return true;
      }

      if (globalPrefixAction === 'pane.zoom' && getPreviewMode()) {
        setPrefixActive(false);
        clearPrefixTimeout();
        togglePreviewZoom();
        return true;
      }

      if (globalPrefixAction === 'clipboard.paste') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onPaste?.();
        return true;
      }

      setPrefixActive(false);
      clearPrefixTimeout();
    }

    // In preview mode, most keys go to the PTY
    if (getPreviewMode()) {
      return handlePreviewModeKeys(event);
    }

    // List mode keyboard handling
    return handleListModeKeys(event);
  };

  return {
    handleKeyDown,
    handleSearchModeKeys,
    handlePreviewModeKeys,
    handleListModeKeys,
  };
}
