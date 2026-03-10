import { beforeAll, describe, expect, it, vi } from "bun:test";

import type { AggregateKeyboardDeps } from "../../../src/components/aggregate/keyboard/types";
import { DEFAULT_KEYBINDINGS, resolveKeybindings } from "../../../src/core/keybindings";

let createAggregateKeyboardHandler: typeof import("../../../src/components/aggregate/keyboard-handlers").createAggregateKeyboardHandler;

vi.mock("../../../src/effect/bridge", () => ({
  writeToPty: vi.fn(),
}));

vi.mock("../../../src/terminal/key-encoder", () => ({
  encodeKeyForEmulator: vi.fn(() => null),
}));

beforeAll(async () => {
  ({ createAggregateKeyboardHandler } = await import("../../../src/components/aggregate/keyboard-handlers"));
});

function createDeps(overrides: Partial<AggregateKeyboardDeps> = {}) {
  let previewMode = true;
  let inSearchMode = false;
  let copyModeActive = false;
  let prefixActive = false;
  let vimMode: 'normal' | 'insert' = 'normal';
  let searchVimMode: 'normal' | 'insert' = 'normal';

  const keybindings = resolveKeybindings(DEFAULT_KEYBINDINGS);
  const handleEnterCopyMode = vi.fn();
  const handleCopyModeKeys = vi.fn(() => true);
  const setPrefixActive = vi.fn((value: boolean) => {
    prefixActive = value;
  });
  const clearPrefixTimeout = vi.fn();
  const startPrefixTimeout = vi.fn();
  const exitPreviewMode = vi.fn();
  const onToggleSessionPicker = vi.fn();
  const onToggleCommandPalette = vi.fn();
  const handleListEnter = vi.fn(() => true);
  const togglePreviewZoom = vi.fn();

  const deps: AggregateKeyboardDeps = {
    getPreviewMode: () => previewMode,
    getSelectedPtyId: () => 'pty-1',
    getFilterQuery: () => '',
    getSearchState: () => null,
    getInSearchMode: () => inSearchMode,
    getCopyModeActive: () => copyModeActive,
    getPrefixActive: () => prefixActive,
    getKeybindings: () => keybindings,
    getMatchedCount: () => 1,
    getVimEnabled: () => false,
    getVimMode: () => vimMode,
    setVimMode: (mode) => {
      vimMode = mode;
    },
    getSearchVimMode: () => searchVimMode,
    setSearchVimMode: (mode) => {
      searchVimMode = mode;
    },
    getVimHandlers: () => ({
      list: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
      preview: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
      search: { handleCombo: () => ({ action: null, pending: false }), reset: () => {} },
    }),
    getEmulatorSync: () => null,
    setFilterQuery: () => {},
    toggleShowInactive: () => {},
    setInSearchMode: (value) => {
      inSearchMode = value;
    },
    setPrefixActive,
    setSelectedIndex: () => {},
    closeAggregateView: vi.fn(),
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    enterPreviewMode: vi.fn(() => {
      previewMode = true;
    }),
    exitPreviewMode,
    togglePreviewZoom,
    exitAggregateMode: vi.fn(),
    exitSearchMode: vi.fn(),
    setSearchQuery: vi.fn(),
    nextMatch: vi.fn(),
    prevMatch: vi.fn(),
    handleEnterSearch: async () => {},
    handleEnterCopyMode,
    handleCopyModeKeys,
    handleJumpToPty: async () => false,
    handleListEnter,
    onToggleSessionPicker,
    onToggleCommandPalette,
    onRequestQuit: vi.fn(),
    onDetach: vi.fn(),
    onRequestKillPty: vi.fn(),
    clearPrefixTimeout,
    startPrefixTimeout,
    ...overrides,
  };

  return {
    deps,
    setCopyModeActive: (value: boolean) => {
      copyModeActive = value;
    },
    getPrefixActive: () => prefixActive,
    handleEnterCopyMode,
    handleCopyModeKeys,
    clearPrefixTimeout,
    exitPreviewMode,
    onToggleSessionPicker,
    onToggleCommandPalette,
    handleListEnter,
    togglePreviewZoom,
  };
}

describe("createAggregateKeyboardHandler", () => {
  it("enters copy mode from the configured prefix binding while previewing", () => {
    const setup = createDeps();
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "b", ctrl: true, eventType: "press" })).toBe(true);
    expect(setup.getPrefixActive()).toBe(true);

    expect(handler.handleKeyDown({ key: "[", eventType: "press" })).toBe(true);
    expect(setup.handleEnterCopyMode).toHaveBeenCalledTimes(1);
    expect(setup.getPrefixActive()).toBe(false);
    expect(setup.clearPrefixTimeout).toHaveBeenCalled();
  });

  it("routes aggregate preview keys to copy mode once copy mode is active", () => {
    const setup = createDeps();
    setup.setCopyModeActive(true);
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "q", eventType: "press" })).toBe(true);
    expect(setup.handleCopyModeKeys).toHaveBeenCalledWith({ key: "q", eventType: "press" });
    expect(setup.exitPreviewMode).not.toHaveBeenCalled();
  });

  it("enters copy mode via prefix+[ while in preview mode", () => {
    const setup = createDeps({
      getPreviewMode: () => true,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    // Step 1: Press prefix key (ctrl+b)
    const prefixResult = handler.handleKeyDown({ key: "b", ctrl: true, eventType: "press" });
    expect(prefixResult).toBe(true);
    expect(setup.getPrefixActive()).toBe(true);

    // Step 2: Press [ (while prefix is active)
    const copyResult = handler.handleKeyDown({ key: "[", eventType: "press" });
    expect(copyResult).toBe(true);
    expect(setup.handleEnterCopyMode).toHaveBeenCalledTimes(1);
    expect(setup.getPrefixActive()).toBe(false);
    expect(setup.clearPrefixTimeout).toHaveBeenCalled();
  });

  it("routes Enter in aggregate list mode through the selected-row handler", () => {
    const setup = createDeps({
      getPreviewMode: () => false,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "enter", eventType: "press" })).toBe(true);
    expect(setup.handleListEnter).toHaveBeenCalledTimes(1);
  });

  it("opens the shared session picker from aggregate list mode via the normal binding", () => {
    const setup = createDeps({
      getPreviewMode: () => false,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "s", alt: true, eventType: "press" })).toBe(true);
    expect(setup.onToggleSessionPicker).toHaveBeenCalledTimes(1);
  });

  it("opens the shared session picker from aggregate mode via the prefix binding", () => {
    const setup = createDeps({
      getPreviewMode: () => false,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "b", ctrl: true, eventType: "press" })).toBe(true);
    expect(handler.handleKeyDown({ key: "s", eventType: "press" })).toBe(true);
    expect(setup.onToggleSessionPicker).toHaveBeenCalledTimes(1);
    expect(setup.getPrefixActive()).toBe(false);
  });

  it("opens the shared command palette from aggregate list mode via the normal binding", () => {
    const setup = createDeps({
      getPreviewMode: () => false,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "p", alt: true, eventType: "press" })).toBe(true);
    expect(setup.onToggleCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("opens the shared command palette from aggregate mode via the prefix binding", () => {
    const setup = createDeps({
      getPreviewMode: () => false,
    });
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "b", ctrl: true, eventType: "press" })).toBe(true);
    expect(handler.handleKeyDown({ key: ":", shift: true, eventType: "press" })).toBe(true);
    expect(setup.onToggleCommandPalette).toHaveBeenCalledTimes(1);
    expect(setup.getPrefixActive()).toBe(false);
  });

  it("toggles aggregate preview zoom from the normal zoom binding while previewing", () => {
    const setup = createDeps();
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "z", alt: true, eventType: "press" })).toBe(true);
    expect(setup.togglePreviewZoom).toHaveBeenCalledTimes(1);
  });

  it("toggles aggregate preview zoom from the prefix zoom binding while previewing", () => {
    const setup = createDeps();
    const handler = createAggregateKeyboardHandler(setup.deps);

    expect(handler.handleKeyDown({ key: "b", ctrl: true, eventType: "press" })).toBe(true);
    expect(handler.handleKeyDown({ key: "z", eventType: "press" })).toBe(true);
    expect(setup.togglePreviewZoom).toHaveBeenCalledTimes(1);
    expect(setup.getPrefixActive()).toBe(false);
  });
});
