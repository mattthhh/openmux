/**
 * Shim PTY Service Implementation
 * Proxies PTY operations through the background shim process.
 */
import * as ShimClient from '../../../shim/client';
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import { PtyCwdError, PtyNotFoundError } from '../../errors';
import type { PtyId } from '../../types';
import type { PtySession } from '../../models';
import type { GitInfo } from './helpers';
import type { GetPtyGitInfoOptions, PtyService, PtyTitleChangeEvent } from './interface';

/**
 * Create shim PTY service - proxies PTY operations through the background shim process.
 */
export function createShimPtyService(): PtyService {
  let shimReady = false;
  let cwdBatchFallbackLogged = false;
  const pendingCwdRequests = new Map<
    string,
    Array<{ resolve: (value: string | PtyCwdError) => void }>
  >();
  let flushCwdBatchScheduled = false;

  const shimReadyPromise = ShimClient.waitForShim().then(() => {
    shimReady = true;
  });

  async function ensureShim(): Promise<void> {
    if (!shimReady) {
      await shimReadyPromise;
    }
  }

  function scheduleFlushCwdBatch(): void {
    if (flushCwdBatchScheduled) {
      return;
    }

    flushCwdBatchScheduled = true;
    queueMicrotask(() => {
      flushCwdBatchScheduled = false;
      void flushCwdBatch();
    });
  }

  async function flushCwdBatch(): Promise<void> {
    const batch = new Map(pendingCwdRequests);
    pendingCwdRequests.clear();

    const ptyIds = [...batch.keys()];
    if (ptyIds.length === 0) {
      return;
    }

    const resolveBatch = (values: Map<string, string | PtyCwdError>): void => {
      for (const [ptyId, requests] of batch) {
        const value =
          values.get(ptyId) ??
          new PtyCwdError({
            ptyId,
            reason: 'Shim returned no CWD for batched lookup',
          });
        for (const request of requests) {
          request.resolve(value);
        }
      }
    };

    const batchErrorForAll = (reason: string, cause?: unknown): Map<string, PtyCwdError> =>
      new Map(
        ptyIds.map((ptyId) => [
          ptyId,
          new PtyCwdError({
            ptyId,
            reason,
            cause,
          }),
        ])
      );

    const batchedValues = await (async (): Promise<Map<string, string | PtyCwdError>> => {
      const ensureError = await ensureShim().then(
        () => null,
        (error) => error
      );
      if (ensureError) {
        return batchErrorForAll('Failed to connect to shim before batched CWD lookup', ensureError);
      }

      const batchResult = await ShimClient.getPtyCwds(ptyIds)
        .then((values) => new Map<string, string | PtyCwdError>(values))
        .catch(async (error) => {
          if (!cwdBatchFallbackLogged) {
            cwdBatchFallbackLogged = true;
            console.warn(
              '[shim-pty] Batch CWD lookup unavailable, falling back to per-PTY requests:',
              error
            );
          }

          const fallbackEntries = await Promise.all(
            ptyIds.map(async (ptyId) => {
              const value = await ShimClient.getPtyCwd(ptyId).catch(
                (fallbackError) =>
                  new PtyCwdError({
                    ptyId,
                    reason: 'Fallback single-PTY CWD lookup failed',
                    cause: fallbackError,
                  })
              );
              return [ptyId, value] as const;
            })
          );

          return new Map<string, string | PtyCwdError>(fallbackEntries);
        });

      return batchResult;
    })().catch((error) => batchErrorForAll('Batched CWD lookup failed', error));

    resolveBatch(batchedValues);
  }

  function queueCwdLookup(ptyId: string): Promise<string | PtyCwdError> {
    return new Promise((resolve) => {
      const requests = pendingCwdRequests.get(ptyId) ?? [];
      requests.push({ resolve });
      pendingCwdRequests.set(ptyId, requests);
      scheduleFlushCwdBatch();
    });
  }

  function getEmulator(id: PtyId, options: { sync: true }): ITerminalEmulator | null;
  function getEmulator(
    id: PtyId,
    options?: { sync?: false }
  ): Promise<PtyNotFoundError | ITerminalEmulator>;
  function getEmulator(
    id: PtyId,
    options: { sync?: boolean } = {}
  ): ITerminalEmulator | null | Promise<PtyNotFoundError | ITerminalEmulator> {
    if (options.sync) {
      return null;
    }

    return (async () => {
      await ensureShim();
      return ShimClient.getEmulator(String(id));
    })();
  }

  function subscribeToTitle(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)>;
  function subscribeToTitle(callback: (event: PtyTitleChangeEvent) => void): () => void;
  function subscribeToTitle(
    idOrCallback: PtyId | ((event: PtyTitleChangeEvent) => void),
    maybeCallback?: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)> | (() => void) {
    if (typeof idOrCallback === 'function') {
      let unsubscribe: (() => void) | null = null;
      void ensureShim().then(() => {
        unsubscribe = ShimClient.subscribeToAllTitles((event) => {
          idOrCallback({ ptyId: event.ptyId as PtyId, title: event.title });
        });
      });
      return () => {
        unsubscribe?.();
      };
    }

    return (async () => {
      await ensureShim();
      return ShimClient.subscribeToTitle(
        String(idOrCallback),
        maybeCallback as (title: string) => void
      );
    })();
  }

  return {
    create: async (options) => {
      await ensureShim();
      const ptyId = await ShimClient.createPty({
        cols: options.cols as number,
        rows: options.rows as number,
        cwd: options.cwd,
        pixelWidth: options.pixelWidth as number | undefined,
        pixelHeight: options.pixelHeight as number | undefined,
      });
      return ptyId as PtyId;
    },
    write: async (id, data) => {
      await ensureShim();
      await ShimClient.writePty(String(id), data);
    },
    sendFocusEvent: async (id, focused) => {
      await ensureShim();
      await ShimClient.sendFocusEvent(String(id), focused);
    },
    resize: async (id, cols, rows, pixelWidth, pixelHeight) => {
      await ensureShim();
      await ShimClient.resizePty(
        String(id),
        cols as number,
        rows as number,
        pixelWidth as number | undefined,
        pixelHeight as number | undefined
      );
    },
    getCwd: async (id) => {
      return queueCwdLookup(String(id));
    },
    destroy: async (id) => {
      await ensureShim();
      await ShimClient.destroyPty(String(id));
    },
    getSession: async (id) => {
      await ensureShim();
      const session = await ShimClient.getSessionInfo(String(id));
      if (!session) {
        return new PtyNotFoundError({ ptyId: id });
      }

      const runtimeSession = session as typeof session & {
        title?: string;
        lastCommand?: string;
      };

      return {
        id: runtimeSession.id as PtyId,
        pid: runtimeSession.pid,
        cols: runtimeSession.cols as import('../../types').Cols,
        rows: runtimeSession.rows as import('../../types').Rows,
        cwd: runtimeSession.cwd,
        shell: runtimeSession.shell,
        title: runtimeSession.title,
        lastCommand: runtimeSession.lastCommand,
      } satisfies PtySession;
    },
    getTerminalState: async (id) => {
      await ensureShim();
      const state = await ShimClient.getTerminalState(String(id));
      if (!state) {
        return new PtyNotFoundError({ ptyId: id });
      }
      return state as TerminalState;
    },
    subscribe: async (id, callback) => {
      await ensureShim();
      return ShimClient.subscribeUnified(
        String(id),
        callback as (update: UnifiedTerminalUpdate) => void
      );
    },
    onExit: async (id, callback) => {
      await ensureShim();
      return ShimClient.subscribeExit(String(id), callback);
    },
    getScrollState: async (id) => {
      await ensureShim();
      const state = await ShimClient.getScrollState(String(id));
      if (!state) {
        return new PtyNotFoundError({ ptyId: id });
      }
      return state;
    },
    setScrollOffset: async (id, offset) => {
      await ensureShim();
      await ShimClient.setScrollOffset(String(id), offset);
    },
    setUpdateEnabled: async (id, enabled) => {
      await ensureShim();
      await ShimClient.setUpdateEnabled(String(id), enabled);
    },
    getEmulator,
    setHostColors: async (colors: TerminalColors) => {
      await ensureShim();
      await ShimClient.setHostColors(colors);
    },
    destroyAll: async () => {
      await ensureShim();
      await ShimClient.destroyAllPtys();
    },
    listAll: async () => {
      await ensureShim();
      const ids = await ShimClient.listAllPtys();
      return ids.map((value) => value as PtyId);
    },
    getForegroundProcess: async (id) => {
      await ensureShim();
      return ShimClient.getForegroundProcess(String(id));
    },
    getGitInfo: async (id, options: GetPtyGitInfoOptions = {}): Promise<GitInfo | undefined> => {
      await ensureShim();
      const info = await ShimClient.getGitInfo(String(id));
      if (!info || !options.includeDiffStats) {
        return info;
      }
      const diffStats = await ShimClient.getGitDiffStats(String(id));
      return { ...info, diffStats };
    },
    subscribeToLifecycle: (callback) => {
      void ensureShim().then(() => {
        ShimClient.subscribeToLifecycle((event) => {
          callback({ type: event.type, ptyId: event.ptyId as PtyId });
        });
      });
      return () => {};
    },
    subscribeToTitle,
    subscribeToAllActivity: (callback) => {
      let unsubscribe: (() => void) | null = null;
      void ensureShim().then(() => {
        unsubscribe = ShimClient.subscribeToActivity((event: { ptyId: string }) => {
          callback({ ptyId: event.ptyId as PtyId });
        });
      });
      return () => {
        unsubscribe?.();
      };
    },
    dispose: () => {
      // Shim service doesn't need cleanup - it's a proxy.
    },
  };
}
