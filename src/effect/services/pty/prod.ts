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
  const globalForegroundProcessChangeRegistry =
    createSubscriptionRegistry<ForegroundProcessChangeEvent>();
  const globalCwdChangeRegistry = createSubscriptionRegistry<CwdChangeEvent>();
  const scrollbackArchiveManager = new ScrollbackArchiveManager(
    SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL
  );
  const scrollbackArchiveRoot =
    process.env.OPENMUX_SCROLLBACK_ARCHIVE_DIR ?? path.join(getConfigDir(), 'scrollback');

  const operations = createOperations({
    sessions: state,
    lifecycleRegistry,
  });

  const handleExit = (ptyId: PtyId, _exitCode: number) => {
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
        onActivity: (ptyId) => globalActivityRegistry.notifySync({ ptyId }),
        onForegroundProcessChange: (ptyId, processName) =>
          globalForegroundProcessChangeRegistry.notifySync({ ptyId, processName }),
        onCwdChange: (ptyId, cwd) => globalCwdChangeRegistry.notifySync({ ptyId, cwd }),
        onExit: handleExit,
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
    void operations.destroyAll();
    disposeGitHelpers();
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
