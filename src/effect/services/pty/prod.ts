/**
 * Production PTY Service Implementation
 * Full PTY management with native zig-pty and libghostty-vt
 */
import path from 'node:path';
import {
  getHostColors,
  getDefaultColors,
  setHostColors as setHostColorsCache,
  type TerminalColors,
} from '../../../terminal/terminal-colors';
import { ScrollbackArchiveManager } from '../../../terminal/scrollback-archive';
import { SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL } from '../../../terminal/scrollback-config';
import { getConfigDir } from '../../../core/user-config';
import { PtySpawnError, PtyNotFoundError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import { disposeGitHelpers } from './helpers';
import { createSubscriptionRegistry } from './subscription-manager';
import { createSession } from './session-factory';
import { createOperations } from './operations';
import { createSubscriptions } from './subscriptions';
import { PtyState } from './state';
import type { PtyService, PtyTitleChangeEvent, PtyCwdChangeEvent } from './interface';

/** Configuration for PTY service */
export interface PtyServiceConfig {
  defaultShell: string;
  /** Clipboard writer injected from services — avoids circular dep through bridge */
  copyToClipboard: (text: string) => Promise<boolean>;
}

/**
 * Create production PTY service.
 */
export function createPtyService(config: PtyServiceConfig, _fs?: unknown): PtyService {
  const state = new PtyState();

  type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: PtyId };
  type ActivityEvent = { ptyId: PtyId };
  type ForegroundProcessChangeEvent = { ptyId: PtyId; processName: string };
  type CwdChangeEvent = PtyCwdChangeEvent;

  const lifecycleRegistry = createSubscriptionRegistry<LifecycleEvent>();
  const globalTitleRegistry = createSubscriptionRegistry<PtyTitleChangeEvent>();
  const globalActivityRegistry = createSubscriptionRegistry<ActivityEvent>();

  // Per-PTY activity debounce: fire at most once per ACTIVITY_DEBOUNCE_MS per PTY.
  // Without this, every data chunk from every PTY calls notifySync(), which
  // synchronously walks all subscribers. Under heavy output (find / -ls, builds),
  // that's thousands of synchronous subscriber iterations per second per PTY.
  // The subscribers (aggregate view shimmer, activity-based refresh) only need
  // to know THAT a PTY was recently active — not on every individual chunk.
  const ACTIVITY_DEBOUNCE_MS = 200;
  const activityDebounceTimers = new Map<PtyId, ReturnType<typeof setTimeout>>();
  const activityDebounced = (ptyId: PtyId) => {
    if (activityDebounceTimers.has(ptyId)) return;
    globalActivityRegistry.notifySync({ ptyId });
    activityDebounceTimers.set(
      ptyId,
      setTimeout(() => {
        activityDebounceTimers.delete(ptyId);
      }, ACTIVITY_DEBOUNCE_MS)
    );
  };
  const globalForegroundProcessChangeRegistry =
    createSubscriptionRegistry<ForegroundProcessChangeEvent>();
  const globalCwdChangeRegistry = createSubscriptionRegistry<CwdChangeEvent>();
  const scrollbackArchiveRoot =
    process.env.OPENMUX_SCROLLBACK_ARCHIVE_DIR ?? path.join(getConfigDir(), 'scrollback');
  const scrollbackArchiveManager = new ScrollbackArchiveManager(
    SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL,
    scrollbackArchiveRoot
  );

  const operations = createOperations({
    sessions: state,
    lifecycleRegistry,
  });

  const handleExit = (ptyId: PtyId, _exitCode: number) => {
    const timer = activityDebounceTimers.get(ptyId);
    if (timer) {
      clearTimeout(timer);
      activityDebounceTimers.delete(ptyId);
    }
    void operations.destroy(ptyId);
  };

  async function create(options: {
    cols: Cols;
    rows: Rows;
    cwd?: string;
    env?: Record<string, string>;
    pixelWidth?: number;
    pixelHeight?: number;
  }): Promise<PtySpawnError | PtyId> {
    const colors = getHostColors() ?? getDefaultColors();
    const result = await createSession(
      {
        colors,
        defaultShell: config.defaultShell,
        scrollbackArchiveManager,
        scrollbackArchiveRoot,
        onLifecycleEvent: (event) => lifecycleRegistry.notify(event),
        onTitleChange: (ptyId, title) => globalTitleRegistry.notifySync({ ptyId, title }),
        onActivity: activityDebounced,
        onForegroundProcessChange: (ptyId, processName) =>
          globalForegroundProcessChangeRegistry.notifySync({ ptyId, processName }),
        onCwdChange: (ptyId, cwd) => globalCwdChangeRegistry.notifySync({ ptyId, cwd }),
        onExit: handleExit,
        copyToClipboard: config.copyToClipboard,
      },
      options
    );

    if (result instanceof PtySpawnError) {
      return result;
    }

    const { id, session } = result;
    state.set(id, session);
    lifecycleRegistry.notify({ type: 'created', ptyId: id });
    return id;
  }

  const subscriptions = createSubscriptions({
    getSessionOrFail: (id: PtyId) => {
      const session = state.get(id);
      if (!session) {
        return Promise.resolve(new PtyNotFoundError({ ptyId: id }));
      }
      return Promise.resolve(session);
    },
    lifecycleRegistry,
    globalTitleRegistry,
    globalActivityRegistry,
    globalForegroundProcessChangeRegistry,
    globalCwdChangeRegistry,
  });

  async function setHostColors(colors: TerminalColors): Promise<void> {
    setHostColorsCache(colors);
    for (const id of state.keys()) {
      const session = state.get(id);
      if (!session) continue;
      session.emulator.setColors?.(colors);
      session.scrollbackArchive.clearCache();
    }
  }

  function dispose(): void {
    // Clean up activity debounce timers
    for (const timer of activityDebounceTimers.values()) {
      clearTimeout(timer);
    }
    activityDebounceTimers.clear();
    void operations.destroyAll();
    disposeGitHelpers();
  }

  /**
   * Garbage-collect stale scrollback archive directories from previous runs.
   * Safe to call at startup — only removes directories whose PTY IDs are
   * not in the current live set. Runs in batches to avoid I/O burst.
   */
  async function gcStaleScrollbackDirectories(): Promise<number> {
    const activePtyIds = new Set(state.keys());
    return scrollbackArchiveManager.gcStaleDirectories(activePtyIds);
  }

  return {
    create,
    write: operations.write,
    sendFocusEvent: operations.sendFocusEvent,
    resize: operations.resize,
    getCwd: operations.getCwd,
    destroy: operations.destroy,
    getSession: operations.getSession,
    getTerminalState: operations.getTerminalState,
    subscribe: subscriptions.subscribe,
    onExit: subscriptions.onExit,
    getScrollState: operations.getScrollState,
    setScrollOffset: operations.setScrollOffset,
    setUpdateEnabled: operations.setUpdateEnabled,
    getEmulator: operations.getEmulator,
    setHostColors,
    destroyAll: operations.destroyAll,
    listAll: operations.listAll,
    getForegroundProcess: subscriptions.getForegroundProcess,
    getGitInfo: subscriptions.getGitInfo,
    subscribeToLifecycle: subscriptions.subscribeToLifecycle,
    subscribeToTitle: subscriptions.subscribeToTitle,
    subscribeToAllActivity: subscriptions.subscribeToAllActivity,
    subscribeToForegroundProcessChange: subscriptions.subscribeToForegroundProcessChange,
    subscribeToCwdChange: subscriptions.subscribeToCwdChange,
    dispose,
  };
}
