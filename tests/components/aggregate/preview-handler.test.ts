import { beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import type { AggregateKeyboardDeps } from '../../../src/components/aggregate/keyboard/types';
import { DEFAULT_KEYBINDINGS, resolveKeybindings } from '../../../src/core/keybindings';
import { effectBridgeMocks } from '../../mocks/effect-bridge';

mock.module('../../../src/effect/bridge', () => effectBridgeMocks);
vi.mock('../../../src/terminal/key-encoder', () => ({
  encodeKeyForEmulator: vi.fn(() => 'encoded'),
}));

let createAggregatePreviewHandler: typeof import('../../../src/components/aggregate/keyboard/preview').createAggregatePreviewHandler;

beforeAll(async () => {
  ({ createAggregatePreviewHandler } =
    await import('../../../src/components/aggregate/keyboard/preview'));
});

function createDeps(overrides: Partial<AggregateKeyboardDeps> = {}): AggregateKeyboardDeps {
  const keybindings = resolveKeybindings(DEFAULT_KEYBINDINGS);

  return {
    getPreviewMode: () => true,
    getSelectedPtyId: () => 'saved:session-1:pane-1',
    getPreviewPtyId: () => 'pty-live',
    getFilterQuery: () => '',
    getSearchState: () => null,
    getInSearchMode: () => false,
    getCopyModeActive: () => false,
    getPrefixActive: () => false,
    getKeybindings: () => keybindings,
    getMatchedCount: () => 1,
    getVimEnabled: () => false,
    getVimMode: () => 'normal',
    setVimMode: () => {},
    getSearchVimMode: () => 'normal',
    setSearchVimMode: () => {},
    getVimHandlers: () => ({
      list: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
      preview: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
      search: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
    }),
    getEmulatorSync: () => null,
    setFilterQuery: () => {},
    toggleShowInactive: () => {},
    setInSearchMode: () => {},
    setPrefixActive: () => {},
    setSelectedIndex: () => {},
    closeAggregateView: () => {},
    navigateUp: () => {},
    navigateDown: () => {},
    navigateToPrevPty: () => {},
    navigateToNextPty: () => {},
    enterPreviewMode: () => {},
    exitPreviewMode: () => {},
    togglePreviewZoom: () => {},
    exitAggregateMode: () => {},
    exitSearchMode: () => {},
    setSearchQuery: () => {},
    nextMatch: () => {},
    prevMatch: () => {},
    handleEnterSearch: async () => {},
    handleEnterCopyMode: () => {},
    handleCopyModeKeys: () => true,
    handleJumpToPty: async () => false,
    handleNewPaneInSession: async () => {},
    handleListEnter: () => true,
    clearPrefixTimeout: () => {},
    startPrefixTimeout: () => {},
    ...overrides,
  };
}

describe('createAggregatePreviewHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards preview input to the resolved live PTY when the selected row is saved', () => {
    const handler = createAggregatePreviewHandler(createDeps());

    expect(
      handler.handlePreviewModeKeys({
        key: 'a',
        sequence: 'a',
        eventType: 'press',
      })
    ).toBe(true);

    expect(effectBridgeMocks.writeToPty).toHaveBeenCalledWith('pty-live', 'encoded');
  });

  it('does not forward input when no live preview PTY is available yet', () => {
    const handler = createAggregatePreviewHandler(
      createDeps({
        getPreviewPtyId: () => null,
      })
    );

    expect(
      handler.handlePreviewModeKeys({
        key: 'a',
        sequence: 'a',
        eventType: 'press',
      })
    ).toBe(true);

    expect(effectBridgeMocks.writeToPty).not.toHaveBeenCalled();
  });
});
