/**
 * Keyboard handlers for AggregateView
 * Handles keyboard input for list mode, preview mode, and search mode
 */

import type { KeyboardEvent } from '../../effect/bridge';
import { eventToCombo, matchKeybinding } from '../../core/keybindings';
import { createAggregateListHandler } from './keyboard/list';
import { createAggregatePreviewHandler } from './keyboard/preview';
import { createAggregateSearchHandler } from './keyboard/search';
import type { AggregateKeyboardDeps, ListDeps, SearchDeps, PreviewDeps } from './keyboard/types';

export type { AggregateKeyboardDeps } from './keyboard/types';
export type { ListDeps, SearchDeps, PreviewDeps, GlobalDeps } from './keyboard/types';

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
    togglePreviewZoom,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    onToggleCommandPalette,
    onToggleFileOpener,
    onToggleDiffOpener,
    onToggleConsole,
    onPaste,
  } = deps;

  const listDeps: ListDeps = {
    getKeybindings: deps.getKeybindings,
    getVimEnabled: deps.getVimEnabled,
    getVimMode: deps.getVimMode,
    setVimMode: deps.setVimMode,
    getVimHandlers: deps.getVimHandlers,
    getMatchedCount: deps.getMatchedCount,
    toggleShowInactive: deps.toggleShowInactive,
    getSelectedPtyId: deps.getSelectedPtyId,
    navigateUp: deps.navigateUp,
    navigateDown: deps.navigateDown,
    scrollListUp: deps.scrollListUp,
    scrollListDown: deps.scrollListDown,
    setSelectedIndex: deps.setSelectedIndex,
    setListScrollOffset: deps.setListScrollOffset,
    handleListEnter: deps.handleListEnter,
    handleJumpToPty: deps.handleJumpToPty,
    handleNewPaneInSession: deps.handleNewPaneInSession,
    closeAggregateView: deps.closeAggregateView,
    exitAggregateMode: deps.exitAggregateMode,
    onRequestKillPty: deps.onRequestKillPty,
  };

  const searchDeps: SearchDeps = {
    getKeybindings: deps.getKeybindings,
    getVimEnabled: deps.getVimEnabled,
    getSearchVimMode: deps.getSearchVimMode,
    setSearchVimMode: deps.setSearchVimMode,
    getVimHandlers: deps.getVimHandlers,
    getSearchState: deps.getSearchState,
    exitSearchMode: deps.exitSearchMode,
    setInSearchMode: deps.setInSearchMode,
    setSearchQuery: deps.setSearchQuery,
    nextMatch: deps.nextMatch,
    prevMatch: deps.prevMatch,
  };

  const previewDeps: PreviewDeps = {
    getPreviewPtyId: deps.getPreviewPtyId,
    getEmulatorSync: deps.getEmulatorSync,
    getKeybindings: deps.getKeybindings,
    handleEnterSearch: deps.handleEnterSearch,
    handleEnterCopyMode: deps.handleEnterCopyMode,
    closeAggregateView: deps.closeAggregateView,
    exitAggregateMode: deps.exitAggregateMode,
    navigateToNextPty: deps.navigateToNextPty,
    navigateToPrevPty: deps.navigateToPrevPty,
    handleNewPaneInSession: deps.handleNewPaneInSession,
    onRequestKillPty: deps.onRequestKillPty,
    requestSnapToBottom: deps.requestSnapToBottom,
  };

  const { handleSearchModeKeys } = createAggregateSearchHandler(searchDeps);
  const { handlePreviewModeKeys } = createAggregatePreviewHandler(previewDeps);
  const { handleListModeKeys } = createAggregateListHandler(listDeps);

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
    if (globalAction === 'command.palette.toggle') {
      onToggleCommandPalette?.();
      return true;
    }
    if (globalAction === 'file.opener.toggle') {
      onToggleFileOpener?.();
      return true;
    }
    if (globalAction === 'diff.opener.toggle') {
      onToggleDiffOpener?.();
      return true;
    }
    if (globalAction === 'session.picker.toggle') {
      deps.togglePtyPicker();
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
          closeAggregateView();
          exitAggregateMode();
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

      if (globalPrefixAction === 'command.palette.toggle') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onToggleCommandPalette?.();
        return true;
      }

      if (globalPrefixAction === 'file.opener.toggle') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onToggleFileOpener?.();
        return true;
      }

      if (globalPrefixAction === 'diff.opener.toggle') {
        setPrefixActive(false);
        clearPrefixTimeout();
        onToggleDiffOpener?.();
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
