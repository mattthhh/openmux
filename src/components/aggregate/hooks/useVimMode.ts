/**
 * useVimMode - Hook for managing vim mode state and sequence handlers in AggregateView.
 *
 * Handles vim mode toggling, sequence handlers for list/preview/search modes,
 * and integration with keyboard configuration.
 */

import { createSignal, createEffect, onCleanup, type Accessor } from 'solid-js';
import {
  createVimSequenceHandler,
  type VimInputMode,
  type VimSequence,
} from '../../../core/vim-sequences';
import { useConfig } from '../../../contexts/ConfigContext';

/** Configuration for vim sequence handlers per mode */
interface VimHandlerConfig {
  /** Timeout in milliseconds for sequence matching */
  timeoutMs: number;
  /** Sequences for list navigation mode */
  listSequences: VimSequence[];
  /** Sequences for preview mode */
  previewSequences: VimSequence[];
  /** Sequences for search mode */
  searchSequences: VimSequence[];
}

/** Vim handler instances for each mode */
export interface VimHandlers {
  /** Handler for list navigation sequences (j/k, gg, G, etc.) */
  list: ReturnType<typeof createVimSequenceHandler>;
  /** Handler for preview mode sequences (q to exit, etc.) */
  preview: ReturnType<typeof createVimSequenceHandler>;
  /** Handler for search mode sequences (n/N for next/prev, etc.) */
  search: ReturnType<typeof createVimSequenceHandler>;
}

/** Result of useVimMode hook */
interface UseVimModeResult {
  /** Current vim mode ('normal' or 'insert') */
  mode: Accessor<VimInputMode>;
  /** Set vim mode directly */
  setMode: (mode: VimInputMode) => void;
  /** Get vim handlers for all modes */
  getHandlers: () => VimHandlers;
  /** Reset all handlers and buffer states */
  resetHandlers: () => void;
  /** Check if vim mode is enabled based on config */
  isEnabled: Accessor<boolean>;
}

/** Default sequence configurations */
const DEFAULT_LIST_SEQUENCES: VimSequence[] = [
  { keys: ['j'], action: 'aggregate.list.down' },
  { keys: ['k'], action: 'aggregate.list.up' },
  { keys: ['g', 'g'], action: 'aggregate.list.top' },
  { keys: ['shift+g'], action: 'aggregate.list.bottom' },
  { keys: ['enter'], action: 'aggregate.list.preview' },
  { keys: ['q'], action: 'aggregate.list.close' },
  { keys: ['n'], action: 'aggregate.list.new.pane' },
];

const DEFAULT_PREVIEW_SEQUENCES: VimSequence[] = [
  { keys: ['q'], action: 'aggregate.preview.exit' },
];

const DEFAULT_SEARCH_SEQUENCES: VimSequence[] = [
  { keys: ['n'], action: 'aggregate.search.next' },
  { keys: ['shift+n'], action: 'aggregate.search.prev' },
  { keys: ['enter'], action: 'aggregate.search.confirm' },
  { keys: ['q'], action: 'aggregate.search.cancel' },
];

const DEFAULT_TIMEOUT_MS = 500;

/**
 * Build vim handlers with custom sequences.
 *
 * @param config - Configuration for sequence handlers
 * @returns VimHandlers instance with list, preview, and search handlers
 */
function buildVimHandlers(config: VimHandlerConfig): VimHandlers {
  return {
    list: createVimSequenceHandler({
      timeoutMs: config.timeoutMs,
      sequences: config.listSequences,
    }),
    preview: createVimSequenceHandler({
      timeoutMs: config.timeoutMs,
      sequences: config.previewSequences,
    }),
    search: createVimSequenceHandler({
      timeoutMs: config.timeoutMs,
      sequences: config.searchSequences,
    }),
  };
}

/**
 * Hook for managing vim mode state and sequence handlers in AggregateView.
 *
 * @param options - Hook options
 * @param options.isAggregateVisible - Whether aggregate view is currently visible
 * @returns UseVimModeResult with mode state and handlers
 *
 * @example
 * ```tsx
 * const { mode, setMode, getHandlers, resetHandlers, isEnabled } = useVimMode({
 *   isAggregateVisible: () => state.showAggregateView,
 * });
 * ```
 */
export function useVimMode(options: { isAggregateVisible: Accessor<boolean> }): UseVimModeResult {
  const config = useConfig();

  // Track vim mode state
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');

  // Check if vim mode is enabled in config
  const isEnabled = () => config.config().keyboard.vimMode === 'overlays';

  // Build initial handlers
  let vimHandlers = buildVimHandlers({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    listSequences: DEFAULT_LIST_SEQUENCES,
    previewSequences: DEFAULT_PREVIEW_SEQUENCES,
    searchSequences: DEFAULT_SEARCH_SEQUENCES,
  });

  // Rebuild handlers when config timeout changes
  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Reset existing handlers before rebuilding
    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();

    vimHandlers = buildVimHandlers({
      timeoutMs,
      listSequences: DEFAULT_LIST_SEQUENCES,
      previewSequences: DEFAULT_PREVIEW_SEQUENCES,
      searchSequences: DEFAULT_SEARCH_SEQUENCES,
    });
  });

  // Reset handlers when aggregate view opens
  createEffect(() => {
    if (!options.isAggregateVisible()) return;

    if (isEnabled()) {
      setVimMode('normal');
    }

    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();
  });

  // Cleanup timeouts on unmount
  onCleanup(() => {
    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();
  });

  const getHandlers = () => vimHandlers;

  const resetHandlers = () => {
    vimHandlers.list.reset();
    vimHandlers.preview.reset();
    vimHandlers.search.reset();
  };

  return {
    mode: vimMode,
    setMode: setVimMode,
    getHandlers,
    resetHandlers,
    isEnabled,
  };
}
