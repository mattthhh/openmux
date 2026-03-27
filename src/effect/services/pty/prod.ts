/**
 * Production PTY Service Implementation
 * Full PTY management with native zig-pty and libghostty-vt
 */
import path from 'node:path';
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import {
  getHostColors,
  getDefaultColors,
  setHostColors as setHostColorsCache,
  type TerminalColors,
} from '../../../terminal/terminal-colors';
import { ScrollbackArchiveManager } from '../../../terminal/scrollback-archive';
import { SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL } from '../../../terminal/scrollback-config';
import { getConfigDir } from '../../../core/user-config';
import { PtySpawnError, PtyNotFoundError, type PtyCwdError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import type { PtySession } from '../../models';
import { makePtyId } from '../../types';
import type { InternalPtySession } from './types';
import type { GitDiffStats, GitInfo } from './helpers';
import { disposeGitHelpers } from './helpers';
import { createSubscriptionRegistry } from './subscription-manager';
import { createSession } from './session-factory';
import { createOperations } from './operations';
import { createSubscriptions } from './subscriptions';
import { PtyState } from './state';
import type { PtyService } from './interface';

/** Configuration for PTY service */
export interface PtyServiceConfig {
  defaultShell: string;
}

/**
 * Create production PTY service
 */
export function createPtyService(config: PtyServiceConfig, _fs?: unknown): PtyService {
  // Internal session storage
  const state = new PtyState();

  // Lifecycle event types
  type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: PtyId };
  type TitleChangeEvent = { ptyId: PtyId; title: string };

  // Subscription registries with synchronous cleanup support
  const lifecycleRegistry = createSubscriptionRegistry<LifecycleEvent>();
  const globalTitleRegistry = createSubscriptionRegistry<TitleChangeEvent>();
  const scrollbackArchiveManager = new ScrollbackArchiveManager(
    SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL
  );
  const scrollbackArchiveRoot =
    process.env.OPENMUX_SCROLLBACK_ARCHIVE_DIR ?? path.join(getConfigDir(), 'scrollback');

  // Create operations using factory
  const operations = createOperations({
    sessions: state as unknown as Map<PtyId, InternalPtySession>,
    lifecycleRegistry,
  });

  const handleExit = (ptyId: PtyId, _exitCode: number) => {
    void operations.destroy(ptyId);
  };

  // Create session factory
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
        onExit: handleExit,
      },
      options
    );

    if (result instanceof PtySpawnError) {
      return result;
    }

    const { id, session } = result;

    // Store session
    state.set(id, session);

    // Emit lifecycle event
    lifecycleRegistry.notify({ type: 'created', ptyId: id });

    return id;
  }

  // Create subscriptions using factory
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
    // Destroy all sessions first
    void operations.destroyAll();
    // Clean up git helper resources
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
    subscribeToScroll: subscriptions.subscribeToScroll,
    subscribeUnified: subscriptions.subscribeUnified,
    onExit: subscriptions.onExit,
    getScrollState: operations.getScrollState,
    setScrollOffset: operations.setScrollOffset,
    setUpdateEnabled: operations.setUpdateEnabled,
    getEmulator: operations.getEmulator,
    getEmulatorSync: operations.getEmulatorSync,
    setHostColors,
    destroyAll: operations.destroyAll,
    listAll: operations.listAll,
    getForegroundProcess: subscriptions.getForegroundProcess,
    getGitBranch: subscriptions.getGitBranch,
    getGitInfo: subscriptions.getGitInfo,
    getGitDiffStats: subscriptions.getGitDiffStats,
    subscribeToLifecycle: subscriptions.subscribeToLifecycle,
    getTitle: operations.getTitle,
    getLastCommand: operations.getLastCommand,
    subscribeToTitleChange: subscriptions.subscribeToTitleChange,
    subscribeToAllTitleChanges: subscriptions.subscribeToAllTitleChanges,
    dispose,
  };
}
