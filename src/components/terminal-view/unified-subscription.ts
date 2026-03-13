import { createEffect, on, onCleanup } from 'solid-js';
import type { TerminalCell, UnifiedTerminalUpdate } from '../../core/types';
import { subscribeUnifiedToPty, getEmulator } from '../../effect/bridge';
import { deferMacrotask } from '../../core/scheduling';
import { getKittyGraphicsRenderer } from '../../terminal/kitty-graphics';
import * as errore from 'errore';
import {
  attachVisibleEmulator,
  clearVisiblePty,
  registerVisiblePty,
  unregisterVisiblePty,
} from './visibility';
import type { TerminalViewState } from './view-state';

export interface UnifiedSubscriptionDeps {
  getPtyId: () => string;
  terminal: { isPtyActive: (ptyId: string) => boolean };
  renderer: { requestRender: () => void };
  viewState: TerminalViewState;
  setVersion: (updater: (value: number) => number) => void;
  kittyPaneKey: string;
  recentPrefetchWindow: number;
}

export function setupUnifiedSubscription(deps: UnifiedSubscriptionDeps): void {
  const {
    getPtyId,
    terminal,
    renderer,
    viewState,
    setVersion,
    kittyPaneKey,
    recentPrefetchWindow,
  } = deps;

  createEffect(
    on(
      getPtyId,
      (ptyId) => {
        let unsubscribe: (() => void) | null = null;
        let mounted = true;
        // Frame batching: coalesce multiple updates into single render per event loop tick.
        let renderRequested = false;

        // Cache for terminal rows (structural sharing).
        let cachedRows: TerminalCell[][] = [];

        const requestRenderFrame = () => {
          if (!renderRequested && mounted) {
            renderRequested = true;
            deferMacrotask(() => {
              if (mounted) {
                renderRequested = false;
                setVersion((v) => v + 1);
                renderer.requestRender();
              }
            });
          }
        };

        const executePrefetch = async () => {
          if (!viewState.pendingPrefetch || viewState.prefetchInProgress || !mounted) return;

          const { start, count } = viewState.pendingPrefetch;
          viewState.pendingPrefetch = null;
          viewState.prefetchInProgress = true;

          const currentEmulator = viewState.emulator;
          if (currentEmulator && 'prefetchScrollbackLines' in currentEmulator) {
            await errore.tryAsync<void, Error>({
              try: () => (currentEmulator as { prefetchScrollbackLines: (start: number, count: number) => Promise<void> })
                .prefetchScrollbackLines(start, count),
              catch: (e) => new Error('Prefetch failed', { cause: e }),
            });
          }

          if (mounted) {
            requestRenderFrame();
          }

          viewState.prefetchInProgress = false;
          if (viewState.pendingPrefetch && mounted) {
            executePrefetch();
          }
        };

        viewState.executePrefetchFn = executePrefetch;

        const init = async () => {
          registerVisiblePty(ptyId);

          const em = await getEmulator(ptyId);
          if (!mounted) return;

          viewState.emulator = em;

          // Set up subscription BEFORE enabling emulator updates.
          // This prevents a race where the emulator fires an immediate update
          // (e.g., after resize with needsFullRefresh) before we're listening.
          const unsubResult = await errore.tryAsync<() => void, Error>({
            try: () => subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
              if (!mounted) return;

              const { terminalUpdate } = update;
              if (terminalUpdate.isFull && terminalUpdate.fullState) {
                viewState.terminalState = terminalUpdate.fullState;
                cachedRows = [...terminalUpdate.fullState.cells];
              } else {
                const existingState = viewState.terminalState;
                if (existingState) {
                  for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
                    cachedRows[rowIdx] = newRow;
                  }
                  viewState.terminalState = {
                    ...existingState,
                    cells: cachedRows,
                    cursor: terminalUpdate.cursor,
                    alternateScreen: terminalUpdate.alternateScreen,
                    mouseTracking: terminalUpdate.mouseTracking,
                    cursorKeyMode: terminalUpdate.cursorKeyMode,
                  };
                }
              }

              viewState.scrollState = update.scrollState;

              if (viewState.lastScrollbackLength !== null && viewState.scrollState.viewportOffset > 0) {
                const scrollbackDelta = viewState.scrollState.scrollbackLength - viewState.lastScrollbackLength;
                if (scrollbackDelta > 0 && viewState.emulator) {
                  const start = Math.max(0, viewState.scrollState.scrollbackLength - recentPrefetchWindow);
                  for (let offset = start; offset < viewState.scrollState.scrollbackLength; offset++) {
                    viewState.emulator.getScrollbackLine(offset);
                  }
                }
              }
              viewState.lastScrollbackLength = viewState.scrollState.scrollbackLength;

              requestRenderFrame();
            }),
            catch: (e) => new Error('Failed to subscribe to PTY', { cause: e }),
          });
          if (unsubResult instanceof Error) return;

          unsubscribe = unsubResult;

          // Now safe to enable updates - subscription is active and will catch immediate updates
          attachVisibleEmulator(ptyId, em);

          requestRenderFrame();
        };

        init();

        onCleanup(() => {
          mounted = false;
          if (unsubscribe) {
            unsubscribe();
          }
          if (terminal.isPtyActive(ptyId)) {
            unregisterVisiblePty(ptyId, viewState.emulator);
          } else {
            clearVisiblePty(ptyId);
          }
          viewState.terminalState = null;
          viewState.emulator = null;
          viewState.executePrefetchFn = null;
          getKittyGraphicsRenderer()?.removePane(kittyPaneKey);
        });
      },
      { defer: false }
    )
  );
}
