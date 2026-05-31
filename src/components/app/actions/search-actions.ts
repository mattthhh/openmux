/**
 * Search action handlers.
 *
 * Encapsulates search mode entry, vim state, and query management.
 */

import { createSearchVimState } from '../search-vim';
import type { useConfig } from '../../../contexts/ConfigContext';
import type { useSearch } from '../../../contexts/SearchContext';
import type { SelectionContextValue } from '../../../contexts/SelectionContext';
import type { VimInputMode } from '../../../core/vim-sequences';

type VimHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface SearchActionsDeps {
  config: ReturnType<typeof useConfig>;
  search: ReturnType<typeof useSearch>;
  selection: SelectionContextValue;
}

export interface SearchActions {
  handleEnterSearch: (getFocusedPtyId: () => string | undefined) => Promise<void>;
  getSearchVimMode: () => VimInputMode;
  setSearchVimMode: (mode: VimInputMode) => void;
  getSearchVimHandler: () => VimHandler;
}

export function createSearchActions(deps: SearchActionsDeps): SearchActions {
  const { config, search, selection } = deps;

  const searchVimState = createSearchVimState({ config, search });

  const handleEnterSearch = async (getFocusedPtyId: () => string | undefined) => {
    selection.clearAllSelections();
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      await search.enterSearchMode(focusedPtyId);
    }
  };

  return {
    handleEnterSearch,
    getSearchVimMode: searchVimState.getSearchVimMode,
    setSearchVimMode: searchVimState.setSearchVimMode,
    getSearchVimHandler: searchVimState.getSearchVimHandler,
  };
}
