/**
 * PTY lifecycle handlers for TerminalContext
 * Handles creation, destruction, and exit events for PTY sessions
 */

import { createPtySession, destroyPty, destroyAllPtys } from '../../effect/bridge';
import { PtySpawnError } from '../../effect/errors';
import { getActiveSessionIdForShim, registerPtyPane } from '../../effect/bridge';
import {
  subscribeToPtyWithCaches,
  subscribeToPtyExit,
  clearPtyCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../../hooks/usePtySubscription';
import { deferMacrotask } from '../../core/scheduling';
import * as errore from 'errore';

export interface PtyLifecycleDeps {
  /** Map of ptyId -> paneId for current session */
  ptyToPaneMap: Map<string, string>;
  /** Map of sessionId -> Map<paneId, ptyId> for all sessions */
  sessionPtyMap: Map<string, Map<string, string>>;
  /** Reverse index: ptyId -> { sessionId, paneId } for O(1) lookups */
  ptyToSessionMap: Map<string, { sessionId: string; paneId: string }>;
  /** Unified caches for PTY state */
  ptyCaches: PtyCaches;
  /** Map of ptyId -> unsubscribe function */
  unsubscribeFns: Map<string, () => void>;
  /** Close pane by ID (from LayoutContext) */
  closePaneById: (paneId: string) => void;
  /** Set PTY ID for a pane (from LayoutContext) */
  setPanePty: (paneId: string, ptyId: string) => void;
  /** Create pane with PTY already attached (single render) */
  newPaneWithPty: (ptyId: string, title?: string) => string;
  /** Get estimated dimensions for a new pane */
  getNewPaneDimensions: () => { cols: number; rows: number };
  /** Get current cell metrics for pixel sizing */
  getCellMetrics?: () => { cellWidth: number; cellHeight: number } | null;
  /** Whether to cache scroll state locally */
  shouldCacheScrollState: boolean;
  /** Callback when a PTY is destroyed */
  onPtyDestroyed?: (ptyId: string) => void;
}

/**
 * Creates PTY lifecycle handlers for TerminalContext
 */
export function createPtyLifecycleHandlers(deps: PtyLifecycleDeps) {
  const {
    ptyToPaneMap,
    sessionPtyMap,
    ptyToSessionMap,
    ptyCaches,
    unsubscribeFns,
    closePaneById,
    setPanePty,
    newPaneWithPty,
    getNewPaneDimensions,
    getCellMetrics,
    shouldCacheScrollState,
    onPtyDestroyed,
  } = deps;

  const resolvePaneId = (ptyId: string, fallbackPaneId?: string): string | undefined => {
    return ptyToPaneMap.get(ptyId) ?? fallbackPaneId ?? ptyToSessionMap.get(ptyId)?.paneId;
  };

  /**
   * Cleanup stack for synchronous resource management.
   * Used in SolidJS onCleanup contexts where async cleanup isn't available.
   */
  class PtyCleanupStack {
    private cleanups: Array<() => void> = [];

    defer(cleanup: () => void): void {
      this.cleanups.push(cleanup);
    }

    execute(): void {
      // Execute in reverse order (LIFO)
      for (let i = this.cleanups.length - 1; i >= 0; i--) {
        try {
          this.cleanups[i]();
        } catch (error) {
          console.warn('Cleanup failed:', error);
        }
      }
      this.cleanups = [];
    }
  }

  const cleanupPty = (
    ptyId: string,
    options?: { paneId?: string; closePane?: boolean; destroy?: boolean }
  ): void => {
    const shouldClosePane = options?.closePane ?? true;
    const shouldDestroy = options?.destroy ?? true;
    const sessionInfo = ptyToSessionMap.get(ptyId);
    const targetPaneId = resolvePaneId(ptyId, options?.paneId);

    if (shouldClosePane && targetPaneId) {
      closePaneById(targetPaneId);
    }

    const stack = new PtyCleanupStack();

    // Resource cleanup in reverse order of creation:
    // Creation order: 1. subscription/caches → 2. pane mapping → 3. session mappings
    // Cleanup order:  3. session mappings → 2. pane mapping → 1. subscription/caches

    // 3. Session mappings (created 3rd, cleaned up 1st)
    if (sessionInfo) {
      const mapping = sessionPtyMap.get(sessionInfo.sessionId);
      if (mapping) {
        stack.defer(() => {
          mapping.delete(sessionInfo.paneId);
        });
      }
      stack.defer(() => {
        ptyToSessionMap.delete(ptyId);
      });
    }

    // 2. Pane mapping (created 2nd, cleaned up 2nd)
    stack.defer(() => {
      ptyToPaneMap.delete(ptyId);
    });

    // 1. Subscription and caches (created 1st, cleaned up 3rd)
    const unsub = unsubscribeFns.get(ptyId);
    if (unsub) {
      stack.defer(() => {
        unsub();
      });
      stack.defer(() => {
        unsubscribeFns.delete(ptyId);
      });
    }
    stack.defer(() => {
      clearPtyCaches(ptyId, ptyCaches);
    });

    // Destroy PTY (runs after all other cleanups)
    if (shouldDestroy) {
      stack.defer(() => {
        destroyPty(ptyId);
      });
    }

    // Callback after cleanup
    stack.defer(() => {
      onPtyDestroyed?.(ptyId);
    });

    stack.execute();
  };

  /**
   * Handle PTY exit (when shell exits via Ctrl+D, `exit`, etc.)
   * Cleans up subscriptions, caches, and mappings, then closes the pane
   */
  const handlePtyExit = (ptyId: string, paneId: string): void => {
    // Pty service already destroys sessions on exit; avoid double-destroy.
    cleanupPty(ptyId, { paneId, closePane: true, destroy: false });
  };

  /**
   * Handle PTY destroyed lifecycle event (already destroyed in service)
   */
  const handlePtyDestroyed = (ptyId: string): void => {
    cleanupPty(ptyId, { closePane: true, destroy: false });
  };

  /**
   * Create a new PTY session for a pane
   */
  const createPTY = async (
    paneId: string,
    cols: number,
    rows: number,
    cwd?: string
  ): Promise<string> => {
    const metrics = getCellMetrics?.() ?? null;
    const pixelWidth = metrics ? cols * metrics.cellWidth : undefined;
    const pixelHeight = metrics ? rows * metrics.cellHeight : undefined;

    // Ghostty-vt is initialized per PTY session
    const result = await createPtySession({ cols, rows, cwd, pixelWidth, pixelHeight });
    if (result instanceof PtySpawnError) {
      console.error('Failed to create PTY:', result.message);
      return '';
    }
    const ptyId = result;

    // Track the mapping immediately
    ptyToPaneMap.set(ptyId, paneId);

    const sessionId = getActiveSessionIdForShim();
    if (sessionId) {
      const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
      mapping.set(paneId, ptyId);
      sessionPtyMap.set(sessionId, mapping);
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
      registerPtyPane(sessionId, paneId, ptyId).catch((e) => {
        console.warn(`[pty-lifecycle] Failed to register PTY pane ${paneId} -> ${ptyId}:`, e);
      });
    }

    // Update the pane with the PTY ID FIRST - this triggers TerminalView mounting
    // TerminalView has its own subscription, so we can defer the context subscription
    setPanePty(paneId, ptyId);

    const exitUnsubResult = await errore.tryAsync<() => void, Error>({
      try: () => subscribeToPtyExit(ptyId, paneId, handlePtyExit),
      catch: (e) => new Error('Failed to subscribe to PTY exit', { cause: e }),
    });
    if (exitUnsubResult instanceof Error) {
      cleanupPty(ptyId, { paneId, closePane: true, destroy: true });
      return '';
    }
    const exitUnsub = exitUnsubResult;
    unsubscribeFns.set(ptyId, exitUnsub);

    // Defer subscription setup to next frame to avoid blocking the render
    // This spreads out the work and prevents stutter
    deferMacrotask(async () => {
      if (!ptyToPaneMap.has(ptyId)) {
        return;
      }
      const unsubResult = await errore.tryAsync<() => void, Error>({
        try: () =>
          subscribeToPtyWithCaches(ptyId, paneId, ptyCaches, handlePtyExit, {
            cacheScrollState: shouldCacheScrollState,
            skipExit: true,
          }),
        catch: (e) => new Error('Failed to subscribe to PTY', { cause: e }),
      });
      if (unsubResult instanceof Error) {
        return;
      }
      const unsub = unsubResult;
      if (!ptyToPaneMap.has(ptyId)) {
        unsub();
        return;
      }
      unsubscribeFns.set(ptyId, () => {
        exitUnsub();
        unsub();
      });
    });

    return ptyId;
  };

  /**
   * Create a new pane with PTY in a single render (no stutter)
   * This creates the PTY first, then creates the pane with PTY already attached.
   * @param cwd - Optional working directory for the PTY
   * @param title - Optional title for the pane
   */
  const createPaneWithPTY = async (
    cwd?: string,
    title?: string
  ): Promise<{ paneId: string; ptyId: string } | null> => {
    // Get estimated dimensions for the new pane
    const { cols, rows } = getNewPaneDimensions();
    const metrics = getCellMetrics?.() ?? null;
    const pixelWidth = metrics ? cols * metrics.cellWidth : undefined;
    const pixelHeight = metrics ? rows * metrics.cellHeight : undefined;

    // Create PTY first (async - this is the expensive part)
    const result = await createPtySession({ cols, rows, cwd, pixelWidth, pixelHeight });
    if (result instanceof PtySpawnError) {
      console.error('Failed to create PTY:', result.message);
      return null;
    }
    const ptyId = result;

    // Create pane with PTY already attached - SINGLE render!
    const paneId = newPaneWithPty(ptyId, title);

    // Track the mapping
    ptyToPaneMap.set(ptyId, paneId);

    const exitUnsubResult = await errore.tryAsync<() => void, Error>({
      try: () => subscribeToPtyExit(ptyId, paneId, handlePtyExit),
      catch: (e) => new Error('Failed to subscribe to PTY exit', { cause: e }),
    });
    if (exitUnsubResult instanceof Error) {
      cleanupPty(ptyId, { paneId, closePane: true, destroy: true });
      return null;
    }
    const exitUnsub = exitUnsubResult;
    unsubscribeFns.set(ptyId, exitUnsub);

    const sessionId = getActiveSessionIdForShim();
    if (sessionId) {
      const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
      mapping.set(paneId, ptyId);
      sessionPtyMap.set(sessionId, mapping);
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
      registerPtyPane(sessionId, paneId, ptyId).catch((e) => {
        console.warn(`[pty-lifecycle] Failed to register PTY pane ${paneId} -> ${ptyId}:`, e);
      });
    }

    // Defer subscription setup to next frame to avoid blocking the render
    deferMacrotask(async () => {
      if (!ptyToPaneMap.has(ptyId)) {
        return;
      }
      const unsubResult = await errore.tryAsync<() => void, Error>({
        try: () =>
          subscribeToPtyWithCaches(ptyId, paneId, ptyCaches, handlePtyExit, {
            cacheScrollState: shouldCacheScrollState,
            skipExit: true,
          }),
        catch: (e) => new Error('Failed to subscribe to PTY', { cause: e }),
      });
      if (unsubResult instanceof Error) {
        return;
      }
      const unsub = unsubResult;
      if (!ptyToPaneMap.has(ptyId)) {
        unsub();
        return;
      }
      unsubscribeFns.set(ptyId, () => {
        exitUnsub();
        unsub();
      });
    });

    return { paneId, ptyId };
  };

  /**
   * Destroy a PTY session (also closes associated pane if one exists)
   * @param options.skipPaneClose - Skip closing the pane (use when pane is already closed)
   */
  const handleDestroyPTY = (ptyId: string, options?: { skipPaneClose?: boolean }): void => {
    cleanupPty(ptyId, {
      closePane: !options?.skipPaneClose,
      destroy: true,
    });
  };

  /**
   * Destroy all PTY sessions
   */
  const handleDestroyAllPTYs = (): void => {
    const stack = new PtyCleanupStack();

    // Unsubscribe all and clear caches
    for (const [, unsub] of unsubscribeFns.entries()) {
      stack.defer(() => {
        unsub();
      });
    }
    stack.defer(() => {
      unsubscribeFns.clear();
    });
    stack.defer(() => {
      clearAllPtyCaches(ptyCaches);
    });

    // Trigger callbacks for all PTYs
    for (const ptyId of ptyToPaneMap.keys()) {
      stack.defer(() => {
        onPtyDestroyed?.(ptyId);
      });
    }

    // Clear maps in reverse order: session -> ptyToSession -> ptyToPane
    stack.defer(() => {
      sessionPtyMap.clear();
    });
    stack.defer(() => {
      ptyToSessionMap.clear();
    });
    stack.defer(() => {
      ptyToPaneMap.clear();
    });

    // Destroy all PTYs (runs last)
    stack.defer(() => {
      destroyAllPtys();
    });

    stack.execute();
  };

  return {
    handlePtyExit,
    handlePtyDestroyed,
    createPTY,
    createPaneWithPTY,
    handleDestroyPTY,
    handleDestroyAllPTYs,
  };
}
