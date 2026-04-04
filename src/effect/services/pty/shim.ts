/**
 * Shim PTY Service Implementation
 * Proxies PTY operations through the background shim process
 */
import * as ShimClient from '../../../shim/client';
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import { PtyNotFoundError } from '../../errors';
import type { PtyId } from '../../types';
import type { PtySession } from '../../models';
import type { GitDiffStats, GitInfo } from './helpers';
import type { PtyService } from './interface';

/**
 * Create shim PTY service - proxies PTY operations through the background shim process
 */
export function createShimPtyService(): PtyService {
  // Ensure shim client is ready
  let shimReady = false;
  const shimReadyPromise = ShimClient.waitForShim().then(() => {
    shimReady = true;
  });

  async function ensureShim(): Promise<void> {
    if (!shimReady) {
      await shimReadyPromise;
    }
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
      await ensureShim();
      return await ShimClient.getPtyCwd(String(id));
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
      return {
        id: session.id as PtyId,
        pid: session.pid,
        cols: session.cols as import('../../types').Cols,
        rows: session.rows as import('../../types').Rows,
        cwd: session.cwd,
        shell: session.shell,
      };
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
      return ShimClient.subscribeState(String(id), callback);
    },
    subscribeToScroll: async (id, callback) => {
      await ensureShim();
      return ShimClient.subscribeScroll(String(id), callback);
    },
    subscribeUnified: async (id, callback) => {
      await ensureShim();
      return ShimClient.subscribeUnified(String(id), callback);
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
    getEmulator: async (id) => {
      await ensureShim();
      return ShimClient.getEmulator(String(id));
    },
    getEmulatorSync: () => null,
    setHostColors: async (colors) => {
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
      return await ShimClient.getForegroundProcess(String(id));
    },
    getGitBranch: async (id) => {
      await ensureShim();
      return await ShimClient.getGitBranch(String(id));
    },
    getGitInfo: async (id) => {
      await ensureShim();
      return await ShimClient.getGitInfo(String(id));
    },
    getGitDiffStats: async (id) => {
      await ensureShim();
      return await ShimClient.getGitDiffStats(String(id));
    },
    subscribeToLifecycle: (callback) => {
      void ensureShim().then(() => {
        // This is synchronous return, but ShimClient.subscribeToLifecycle returns void
        // So we call it here for side effects
        ShimClient.subscribeToLifecycle((event) => {
          callback({ type: event.type, ptyId: event.ptyId as PtyId });
        });
      });
      // Return a no-op cleanup for now
      return () => {};
    },
    getTitle: async (id) => {
      await ensureShim();
      return await ShimClient.getTitle(String(id));
    },
    getLastCommand: async (id) => {
      await ensureShim();
      return await ShimClient.getLastCommand(String(id));
    },
    subscribeToTitleChange: async (id, callback) => {
      await ensureShim();
      return ShimClient.subscribeToTitle(String(id), callback);
    },
    subscribeToAllTitleChanges: (callback) => {
      let unsubscribe: (() => void) | null = null;
      void ensureShim().then(() => {
        unsubscribe = ShimClient.subscribeToAllTitles((event) => {
          callback({ ptyId: event.ptyId as PtyId, title: event.title });
        });
      });
      return () => {
        unsubscribe?.();
      };
    },
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
      // Shim service doesn't need cleanup - it's a proxy
    },
  };
}
