import type { TerminalCell, TerminalState, TerminalScrollState } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { PrefetchRequest } from './row-fetching';

export interface TerminalViewState {
  terminalState: TerminalState | null;
  scrollState: TerminalScrollState;
  emulator: ITerminalEmulator | null;
  lastScrollbackLength: number | null;
  pendingPrefetch: PrefetchRequest | null;
  prefetchInProgress: boolean;
  executePrefetchFn: (() => void) | null;
  lastStableViewportOffset: number;
  lastStableScrollbackLength: number;
  lastStableRowCache: (TerminalCell[] | null)[] | null;
  lastObservedViewportOffset: number;
  lastObservedScrollbackLength: number;
  /** Pooled row cache array — reused across frames to avoid per-render allocation */
  pooledRowCache: (TerminalCell[] | null)[];
}

export function createTerminalViewState(): TerminalViewState {
  return {
    terminalState: null,
    scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
    emulator: null,
    lastScrollbackLength: null,
    pendingPrefetch: null,
    prefetchInProgress: false,
    executePrefetchFn: null,
    lastStableViewportOffset: 0,
    lastStableScrollbackLength: 0,
    lastStableRowCache: null,
    lastObservedViewportOffset: 0,
    lastObservedScrollbackLength: 0,
    pooledRowCache: [],
  };
}
