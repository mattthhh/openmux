/**
 * PTY Subscriptions - event subscription handlers (errore version)
 */
import type { TerminalState, UnifiedTerminalUpdate } from "../../../core/types"
import type { PtyNotFoundError } from "../../errors"
import type { PtyId } from "../../types"
import type { InternalPtySession } from "./types"
import type { GitInfo, GitDiffStats } from "./helpers"
import { getCurrentScrollState } from "./notification"
import { getGitInfo, getGitDiffStats } from "./helpers"
import type { SubscriptionRegistry } from "./subscription-manager"

export interface SubscriptionsDeps {
  getSessionOrFail: (id: PtyId) => Promise<InternalPtySession | PtyNotFoundError>
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>
  globalTitleRegistry: SubscriptionRegistry<{ ptyId: PtyId; title: string }>
}

export function createSubscriptions(deps: SubscriptionsDeps) {
  const { getSessionOrFail, lifecycleRegistry, globalTitleRegistry } = deps

  async function subscribe(
    id: PtyId,
    callback: (state: TerminalState) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError

    session.subscribers.add(callback)
    callback(session.emulator.getTerminalState())

    return () => {
      session.subscribers.delete(callback)
    }
  }

  async function subscribeToScroll(
    id: PtyId,
    callback: () => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    session.scrollSubscribers.add(callback)

    return () => {
      session.scrollSubscribers.delete(callback)
    }
  }

  async function subscribeUnified(
    id: PtyId,
    callback: (update: UnifiedTerminalUpdate) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    session.unifiedSubscribers.add(callback)

    // Send initial full state
    const scrollState = getCurrentScrollState(session)
    const fullState = session.emulator.getTerminalState()
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
    }
    callback(initialUpdate)

    return () => {
      session.unifiedSubscribers.delete(callback)
    }
  }

  async function onExit(
    id: PtyId,
    callback: (exitCode: number) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError

    session.exitCallbacks.add(callback)

    return () => {
      session.exitCallbacks.delete(callback)
    }
  }

  async function getForegroundProcess(id: PtyId): Promise<PtyNotFoundError | string | undefined> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    // Use native zig-pty method directly (no subprocess spawning)
    return session.pty.getForegroundProcessName() ?? undefined
  }

  async function getGitBranchFn(id: PtyId): Promise<PtyNotFoundError | string | undefined> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    // Use native zig-pty method directly (no subprocess spawning)
    const cwd = session.pty.getCwd()
    if (!cwd) return undefined
    const info = await getGitInfo(cwd)
    return info?.branch
  }

  async function getGitInfoFn(id: PtyId): Promise<PtyNotFoundError | GitInfo | undefined> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    const cwd = session.pty.getCwd()
    if (!cwd) return undefined
    return await getGitInfo(cwd)
  }

  async function getGitDiffStatsFn(id: PtyId): Promise<PtyNotFoundError | GitDiffStats | undefined> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    const cwd = session.pty.getCwd()
    if (!cwd) return undefined
    return await getGitDiffStats(cwd)
  }

  function subscribeToLifecycle(
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ): (() => void) {
    return lifecycleRegistry.subscribe(callback)
  }

  async function subscribeToTitleChange(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)> {
    const sessionOrError = await getSessionOrFail(id)
    if (sessionOrError instanceof Error) {
      return sessionOrError as PtyNotFoundError
    }
    const session = sessionOrError
    session.titleSubscribers.add(callback)
    // Immediately call with current title if set
    const currentTitle = session.emulator.getTitle()
    if (currentTitle) {
      callback(currentTitle)
    }
    return () => {
      session.titleSubscribers.delete(callback)
    }
  }

  function subscribeToAllTitleChanges(
    callback: (event: { ptyId: PtyId; title: string }) => void
  ): (() => void) {
    return globalTitleRegistry.subscribe(callback)
  }

  return {
    subscribe,
    subscribeToScroll,
    subscribeUnified,
    onExit,
    getForegroundProcess,
    getGitBranch: getGitBranchFn,
    getGitInfo: getGitInfoFn,
    getGitDiffStats: getGitDiffStatsFn,
    subscribeToLifecycle,
    subscribeToTitleChange,
    subscribeToAllTitleChanges,
  }
}
