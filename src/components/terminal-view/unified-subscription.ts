import { createEffect, on, onCleanup } from 'solid-js';
import type { TerminalCell, UnifiedTerminalUpdate } from '../../core/types';
import { subscribeUnifiedToPty, getEmulator } from '../../effect/bridge';
import { getKittyGraphicsRenderer } from '../../terminal/kitty-graphics';
import * as errore from 'errore';
import { TerminalSubscriptionError } from '../../effect/errors';
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
            // Use queueMicrotask for frame batching with tighter timing than setTimeout(0).
            // Multiple PTY updates within the same event loop tick are coalesced
            // (renderRequested flag prevents duplicate scheduling), while microtasks
            // run before the next macrotask for lower latency than deferMacrotask.
            // This matches the pattern from the original React TerminalView optimization
            // (commit c96bbf6e) while preserving the coalescing guarantee from commit 7c14a024.
            queueMicrotask(() => {
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
            await errore.tryAsync<void, TerminalSubscriptionError>({
              try: () =>
                (
                  currentEmulator as {
                    prefetchScrollbackLines: (start: number, count: number) => Promise<void>;
                  }
                ).prefetchScrollbackLines(start, count),
              catch: (e) =>
                new TerminalSubscriptionError({
                  operation: 'prefetch',
                  ptyId,
                  reason: String(e),
                  cause: e,
                }),
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
          const unsubResult = await errore.tryAsync<() => void, TerminalSubscriptionError>({
            try: () =>
              subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
                if (!mounted) return;

                const { terminalUpdate } = update;
                if (terminalUpdate.isFull && terminalUpdate.fullState) {
                  viewState.terminalState = terminalUpdate.fullState;
                  cachedRows = [...terminalUpdate.fullState.cells];
                  getKittyGraphicsRenderer()?.invalidatePty(ptyId);
                } else {
                  const existingState = viewState.terminalState;
                  if (existingState) {
                    for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
                      cachedRows[rowIdx] = newRow;
                    }
                    // Only create a new state object if something actually changed.
                    // Cursor position changes on every keypress, scroll changes on output,
                    // and modes change on DECSET/DECRST — all need re-rendering.
                    const cursorChanged =
                      existingState.cursor.x !== terminalUpdate.cursor.x ||
                      existingState.cursor.y !== terminalUpdate.cursor.y ||
                      existingState.cursor.visible !== terminalUpdate.cursor.visible;
                    const modesChanged =
                      existingState.alternateScreen !== terminalUpdate.alternateScreen ||
                      existingState.mouseTracking !== terminalUpdate.mouseTracking ||
                      existingState.cursorKeyMode !== terminalUpdate.cursorKeyMode;
                    const rowsChanged = terminalUpdate.dirtyRows.size > 0;

                    if (rowsChanged || cursorChanged || modesChanged) {
                      viewState.terminalState = {
                        ...existingState,
                        cells: rowsChanged ? cachedRows : existingState.cells,
                        cursor: terminalUpdate.cursor,
                        alternateScreen: terminalUpdate.alternateScreen,
                        mouseTracking: terminalUpdate.mouseTracking,
                        cursorKeyMode: terminalUpdate.cursorKeyMode,
                      };
                    }
                  }
                }

                viewState.scrollState = update.scrollState;

                if (
                  viewState.lastScrollbackLength !== null &&
                  viewState.scrollState.viewportOffset > 0
                ) {
                  const scrollbackDelta =
                    viewState.scrollState.scrollbackLength - viewState.lastScrollbackLength;
                  if (scrollbackDelta > 0 && viewState.emulator) {
                    const start = Math.max(
                      0,
                      viewState.scrollState.scrollbackLength - recentPrefetchWindow
                    );
                    for (
                      let offset = start;
                      offset < viewState.scrollState.scrollbackLength;
                      offset++
                    ) {
                      viewState.emulator.getScrollbackLine(offset);
                    }
                  }
                }
                viewState.lastScrollbackLength = viewState.scrollState.scrollbackLength;

                requestRenderFrame();
              }),
            catch: (e) =>
              new TerminalSubscriptionError({
                operation: 'subscribe',
                ptyId,
                reason: String(e),
                cause: e,
              }),
          });
          if (unsubResult instanceof Error) return;

          // Guard: if the component was cleaned up while awaiting subscription setup,
          // unsubscribe immediately to prevent a dangling subscription and stale
          // attachVisibleEmulator call that would re-enable update notifications
          // for the old PTY after cleanup has already run.
          if (!mounted) {
            unsubResult();
            return;
          }

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
