/**
 * PTY subscriptions and metadata helpers.
 */
import type { UnifiedTerminalUpdate } from '../../../core/types';
import type { PtyNotFoundError } from '../../errors';
import type { PtyId } from '../../types';
import type { InternalPtySession } from './types';
import type { GitInfo } from './helpers';
import { getCurrentScrollState } from './notification';
import { getGitInfo } from './helpers';
import type { SubscriptionRegistry } from './subscription-manager';
import type { GetPtyGitInfoOptions, PtyTitleChangeEvent } from './interface';

export interface SubscriptionsDeps {
  getSessionOrFail: (id: PtyId) => Promise<InternalPtySession | PtyNotFoundError>;
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>;
  globalTitleRegistry: SubscriptionRegistry<PtyTitleChangeEvent>;
  globalActivityRegistry: SubscriptionRegistry<{ ptyId: PtyId }>;
  globalForegroundProcessChangeRegistry: SubscriptionRegistry<{
    ptyId: PtyId;
    processName: string;
  }>;
}

export function createSubscriptions(deps: SubscriptionsDeps) {
  const {
    getSessionOrFail,
    lifecycleRegistry,
    globalTitleRegistry,
    globalActivityRegistry,
    globalForegroundProcessChangeRegistry,
  } = deps;

  async function subscribe(
    id: PtyId,
    callback: (update: UnifiedTerminalUpdate) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id);
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError;
    }

    const session = sessionOrError;
    session.unifiedSubscribers.add(callback);

    const scrollState = getCurrentScrollState(session);
    const fullState = session.emulator.getTerminalState();
    const initialUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: fullState.cursor,
        scrollState,
        cols: fullState.cols,
        rows: fullState.rows,
        isFull: true,
        fullState,
        alternateScreen: fullState.alternateScreen,
        mouseTracking: fullState.mouseTracking,
        cursorKeyMode: fullState.cursorKeyMode ?? 'normal',
        inBandResize: session.emulator.getMode(2048),
      },
      scrollState,
    };
    callback(initialUpdate);

    return () => {
      session.unifiedSubscribers.delete(callback);
    };
  }

  async function onExit(
    id: PtyId,
    callback: (exitCode: number) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id);
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError;
    }

    const session = sessionOrError;
    session.exitCallbacks.add(callback);

    return () => {
      session.exitCallbacks.delete(callback);
    };
  }

  async function getForegroundProcess(id: PtyId): Promise<PtyNotFoundError | string | undefined> {
    const sessionOrError = await getSessionOrFail(id);
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError;
    }

    return sessionOrError.pty.getForegroundProcessName() ?? undefined;
  }

  async function getGitInfoFn(
    id: PtyId,
    options: GetPtyGitInfoOptions = {}
  ): Promise<PtyNotFoundError | GitInfo | undefined> {
    const sessionOrError = await getSessionOrFail(id);
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError;
    }

    const cwd =
      sessionOrError.cwdReported === true
        ? sessionOrError.cwd
        : (sessionOrError.pty.getCwd() ?? sessionOrError.cwd);
    if (!cwd) return undefined;

    if (sessionOrError.cwdReported !== true) {
      sessionOrError.cwd = cwd;
    }

    return getGitInfo(cwd, { includeDiffStats: options.includeDiffStats });
  }

  function subscribeToLifecycle(
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ): () => void {
    return lifecycleRegistry.subscribe(callback);
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
      return globalTitleRegistry.subscribe(idOrCallback);
    }

    return (async () => {
      const sessionOrError = await getSessionOrFail(idOrCallback);
      if (sessionOrError instanceof Error) {
        return sessionOrError as PtyNotFoundError;
      }

      const callback = maybeCallback as (title: string) => void;
      const session = sessionOrError;
      session.titleSubscribers.add(callback);

      const currentTitle = session.emulator.getTitle();
      if (currentTitle) {
        callback(currentTitle);
      }

      return () => {
        session.titleSubscribers.delete(callback);
      };
    })();
  }

  function subscribeToAllActivity(callback: (event: { ptyId: PtyId }) => void): () => void {
    return globalActivityRegistry.subscribe(callback);
  }

  function subscribeToForegroundProcessChange(
    callback: (event: { ptyId: PtyId; processName: string }) => void
  ): () => void {
    return globalForegroundProcessChangeRegistry.subscribe(callback);
  }

  return {
    subscribe,
    onExit,
    getForegroundProcess,
    getGitInfo: getGitInfoFn,
    subscribeToLifecycle,
    subscribeToTitle,
    subscribeToAllActivity,
    subscribeToForegroundProcessChange,
  };
}
