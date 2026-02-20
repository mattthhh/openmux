/**
 * PTY service for managing terminal pseudo-terminal sessions (errore version).
 * Wraps zig-pty with native libghostty-vt parsing.
 */
import path from "node:path"
import type { TerminalState, UnifiedTerminalUpdate } from "../../core/types"
import type { ITerminalEmulator } from "../../terminal/emulator-interface"
import { getHostColors, getDefaultColors, setHostColors as setHostColorsCache, type TerminalColors } from "../../terminal/terminal-colors"
import { ScrollbackArchiveManager } from "../../terminal/scrollback-archive"
import { SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL } from "../../terminal/scrollback-config"
import { getConfigDir } from "../../core/user-config"
import { PtyNotFoundError, PtySpawnError, type PtyCwdError } from "../errors"
import type { PtyId, Cols, Rows } from "../types"
import type { PtySession } from "../models"
import { makePtyId } from "../types"

/** Configuration for PTY service */
export interface PtyServiceConfig {
  defaultShell: string
}
import * as ShimClient from "../../shim/client"

import type { InternalPtySession } from "./pty/types"
import type { GitDiffStats, GitInfo } from "./pty/helpers"
import { disposeGitHelpers } from "./pty/helpers"
import { createSubscriptionRegistry } from "./pty/subscription-manager"
import { createSession } from "./pty/session-factory"
import { createOperations } from "./pty/operations"
import { createSubscriptions } from "./pty/subscriptions"

/** PTY Service interface */
export interface PtyService {
  /** Create a new PTY session */
  create(options: {
    cols: Cols
    rows: Rows
    cwd?: string
    env?: Record<string, string>
    pixelWidth?: number
    pixelHeight?: number
  }): Promise<PtySpawnError | PtyId>

  /** Write data to a PTY */
  write(id: PtyId, data: string): Promise<PtyNotFoundError | void>

  /** Send focus event if focus tracking is enabled */
  sendFocusEvent(id: PtyId, focused: boolean): Promise<PtyNotFoundError | void>

  /** Resize a PTY */
  resize(
    id: PtyId,
    cols: Cols,
    rows: Rows,
    pixelWidth?: number,
    pixelHeight?: number
  ): Promise<PtyNotFoundError | void>

  /** Get current working directory of a PTY's shell process */
  getCwd(id: PtyId): Promise<PtyNotFoundError | PtyCwdError | string>

  /** Destroy a PTY session */
  destroy(id: PtyId): Promise<void>

  /** Get session info */
  getSession(id: PtyId): Promise<PtyNotFoundError | PtySession>

  /** Get terminal state */
  getTerminalState(id: PtyId): Promise<PtyNotFoundError | TerminalState>

  /** Subscribe to terminal state updates */
  subscribe(
    id: PtyId,
    callback: (state: TerminalState) => void
  ): Promise<PtyNotFoundError | (() => void)>

  /** Subscribe to scroll state changes (lightweight - no state rebuild) */
  subscribeToScroll(
    id: PtyId,
    callback: () => void
  ): Promise<PtyNotFoundError | (() => void)>

  /**
   * Subscribe to unified updates (terminal + scroll combined).
   * More efficient than separate subscriptions - eliminates race conditions
   * and reduces render cycles.
   */
  subscribeUnified(
    id: PtyId,
    callback: (update: UnifiedTerminalUpdate) => void
  ): Promise<PtyNotFoundError | (() => void)>

  /** Subscribe to PTY exit events */
  onExit(
    id: PtyId,
    callback: (exitCode: number) => void
  ): Promise<PtyNotFoundError | (() => void)>

  /** Get scroll state */
  getScrollState(id: PtyId): Promise<
    PtyNotFoundError | {
      viewportOffset: number
      scrollbackLength: number
      isAtBottom: boolean
      isAtScrollbackLimit?: boolean
    }
  >

  /** Set scroll offset */
  setScrollOffset(id: PtyId, offset: number): Promise<PtyNotFoundError | void>

  /** Enable or disable terminal update notifications (visibility gating) */
  setUpdateEnabled(id: PtyId, enabled: boolean): Promise<PtyNotFoundError | void>

  /** Get emulator for direct access (e.g., scrollback lines) */
  getEmulator(id: PtyId): Promise<PtyNotFoundError | ITerminalEmulator>

  /** Apply host terminal colors to all active emulators */
  setHostColors(colors: TerminalColors): Promise<void>

  /** Destroy all sessions */
  destroyAll(): Promise<void>

  /** List all active PTY IDs */
  listAll(): Promise<PtyId[]>

  /** Get foreground process name for a PTY */
  getForegroundProcess(id: PtyId): Promise<PtyNotFoundError | string | undefined>

  /** Get git branch for a PTY's current directory */
  getGitBranch(id: PtyId): Promise<PtyNotFoundError | string | undefined>

  /** Get git branch + dirty state for a PTY's current directory */
  getGitInfo(id: PtyId): Promise<PtyNotFoundError | GitInfo | undefined>

  /** Get git diff stats for a PTY's current directory */
  getGitDiffStats(id: PtyId): Promise<PtyNotFoundError | GitDiffStats | undefined>

  /** Subscribe to PTY lifecycle events (created/destroyed) */
  subscribeToLifecycle(
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ): (() => void)

  /** Get current terminal title for a PTY */
  getTitle(id: PtyId): Promise<PtyNotFoundError | string>

  /** Get last shell command captured for a PTY */
  getLastCommand(id: PtyId): Promise<PtyNotFoundError | string | undefined>

  /** Subscribe to terminal title changes for a PTY */
  subscribeToTitleChange(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)>

  /** Subscribe to title changes across ALL PTYs (for aggregate view) */
  subscribeToAllTitleChanges(
    callback: (event: { ptyId: PtyId; title: string }) => void
  ): (() => void)

  /** Dispose the PTY service and clean up all resources */
  dispose(): void
}

/** State container for PTY sessions */
class PtyState {
  private sessions = new Map<PtyId, InternalPtySession>()

  get(id: PtyId): InternalPtySession | undefined {
    return this.sessions.get(id)
  }

  set(id: PtyId, session: InternalPtySession): void {
    this.sessions.set(id, session)
  }

  delete(id: PtyId): boolean {
    return this.sessions.delete(id)
  }

  has(id: PtyId): boolean {
    return this.sessions.has(id)
  }

  keys(): IterableIterator<PtyId> {
    return this.sessions.keys()
  }

  get size(): number {
    return this.sessions.size
  }
}

/**
 * Create production PTY service
 */
export function createPtyService(config: PtyServiceConfig, _fs?: unknown): PtyService {
  // Internal session storage
  const state = new PtyState()

  // Lifecycle event types
  type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: PtyId }
  type TitleChangeEvent = { ptyId: PtyId; title: string }

  // Subscription registries with synchronous cleanup support
  const lifecycleRegistry = createSubscriptionRegistry<LifecycleEvent>()
  const globalTitleRegistry = createSubscriptionRegistry<TitleChangeEvent>()
  const scrollbackArchiveManager = new ScrollbackArchiveManager(
    SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL
  )
  const scrollbackArchiveRoot = process.env.OPENMUX_SCROLLBACK_ARCHIVE_DIR ??
    path.join(getConfigDir(), "scrollback")

  // Helper to get a session or fail
  function getSessionOrFail(id: PtyId): InternalPtySession | PtyNotFoundError {
    const session = state.get(id)
    if (!session) {
      return new PtyNotFoundError({ ptyId: id })
    }
    return session
  }

  // Create operations using factory
  const operations = createOperations({
    sessions: state as unknown as Map<PtyId, InternalPtySession>,
    lifecycleRegistry,
  })

  const handleExit = (ptyId: PtyId, _exitCode: number) => {
    void operations.destroy(ptyId)
  }

  // Create session factory
  async function create(options: {
    cols: Cols
    rows: Rows
    cwd?: string
    env?: Record<string, string>
    pixelWidth?: number
    pixelHeight?: number
  }): Promise<PtySpawnError | PtyId> {
    const colors = getHostColors() ?? getDefaultColors()
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
    )

    if (result instanceof PtySpawnError) {
      return result
    }

    const { id, session } = result

    // Store session
    state.set(id, session)

    // Emit lifecycle event
    lifecycleRegistry.notify({ type: 'created', ptyId: id })

    return id
  }

  // Create subscriptions using factory
  const subscriptions = createSubscriptions({
    getSessionOrFail: (id: PtyId) => {
      const result = getSessionOrFail(id)
      if (result instanceof PtyNotFoundError) {
        return Promise.resolve(result)
      }
      return Promise.resolve(result)
    },
    lifecycleRegistry,
    globalTitleRegistry,
  })

  async function setHostColors(colors: TerminalColors): Promise<void> {
    setHostColorsCache(colors)
    for (const id of state.keys()) {
      const session = state.get(id)
      if (!session) continue
      session.emulator.setColors?.(colors)
      session.scrollbackArchive.clearCache()
    }
  }

  function dispose(): void {
    // Destroy all sessions first
    void operations.destroyAll()
    // Clean up git helper resources
    disposeGitHelpers()
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
  }
}

/**
 * Create shim PTY service - proxies PTY operations through the background shim process
 */
export function createShimPtyService(): PtyService {
  // Ensure shim client is ready
  let shimReady = false
  const shimReadyPromise = ShimClient.waitForShim().then(() => {
    shimReady = true
  })

  async function ensureShim(): Promise<void> {
    if (!shimReady) {
      await shimReadyPromise
    }
  }

  return {
    create: async (options) => {
      await ensureShim()
      const ptyId = await ShimClient.createPty({
        cols: options.cols as number,
        rows: options.rows as number,
        cwd: options.cwd,
        pixelWidth: options.pixelWidth as number | undefined,
        pixelHeight: options.pixelHeight as number | undefined,
      })
      return ptyId as PtyId
    },
    write: async (id, data) => {
      await ensureShim()
      await ShimClient.writePty(String(id), data)
    },
    sendFocusEvent: async (id, focused) => {
      await ensureShim()
      await ShimClient.sendFocusEvent(String(id), focused)
    },
    resize: async (id, cols, rows, pixelWidth, pixelHeight) => {
      await ensureShim()
      await ShimClient.resizePty(
        String(id),
        cols as number,
        rows as number,
        pixelWidth as number | undefined,
        pixelHeight as number | undefined
      )
    },
    getCwd: async (id) => {
      await ensureShim()
      return await ShimClient.getPtyCwd(String(id))
    },
    destroy: async (id) => {
      await ensureShim()
      await ShimClient.destroyPty(String(id))
    },
    getSession: async (id) => {
      await ensureShim()
      const session = await ShimClient.getSessionInfo(String(id))
      if (!session) {
        return new PtyNotFoundError({ ptyId: id })
      }
      return {
        id: session.id as PtyId,
        pid: session.pid,
        cols: session.cols as Cols,
        rows: session.rows as Rows,
        cwd: session.cwd,
        shell: session.shell,
      }
    },
    getTerminalState: async (id) => {
      await ensureShim()
      const state = await ShimClient.getTerminalState(String(id))
      if (!state) {
        return new PtyNotFoundError({ ptyId: id })
      }
      return state as TerminalState
    },
    subscribe: async (id, callback) => {
      await ensureShim()
      return ShimClient.subscribeState(String(id), callback)
    },
    subscribeToScroll: async (id, callback) => {
      await ensureShim()
      return ShimClient.subscribeScroll(String(id), callback)
    },
    subscribeUnified: async (id, callback) => {
      await ensureShim()
      return ShimClient.subscribeUnified(String(id), callback)
    },
    onExit: async (id, callback) => {
      await ensureShim()
      return ShimClient.subscribeExit(String(id), callback)
    },
    getScrollState: async (id) => {
      await ensureShim()
      const state = await ShimClient.getScrollState(String(id))
      if (!state) {
        return new PtyNotFoundError({ ptyId: id })
      }
      return state
    },
    setScrollOffset: async (id, offset) => {
      await ensureShim()
      await ShimClient.setScrollOffset(String(id), offset)
    },
    setUpdateEnabled: async (id, enabled) => {
      await ensureShim()
      await ShimClient.setUpdateEnabled(String(id), enabled)
    },
    getEmulator: async (id) => {
      await ensureShim()
      return ShimClient.getEmulator(String(id))
    },
    setHostColors: async (colors) => {
      await ensureShim()
      await ShimClient.setHostColors(colors)
    },
    destroyAll: async () => {
      await ensureShim()
      await ShimClient.destroyAllPtys()
    },
    listAll: async () => {
      await ensureShim()
      const ids = await ShimClient.listAllPtys()
      return ids.map((value) => value as PtyId)
    },
    getForegroundProcess: async (id) => {
      await ensureShim()
      return await ShimClient.getForegroundProcess(String(id))
    },
    getGitBranch: async (id) => {
      await ensureShim()
      return await ShimClient.getGitBranch(String(id))
    },
    getGitInfo: async (id) => {
      await ensureShim()
      return await ShimClient.getGitInfo(String(id))
    },
    getGitDiffStats: async (id) => {
      await ensureShim()
      return await ShimClient.getGitDiffStats(String(id))
    },
    subscribeToLifecycle: (callback) => {
      void ensureShim().then(() => {
        // This is synchronous return, but ShimClient.subscribeToLifecycle returns void
        // So we call it here for side effects
        ShimClient.subscribeToLifecycle((event) => {
          callback({ type: event.type, ptyId: event.ptyId as PtyId })
        })
      })
      // Return a no-op cleanup for now
      return () => {}
    },
    getTitle: async (id) => {
      await ensureShim()
      return await ShimClient.getTitle(String(id))
    },
    getLastCommand: async (id) => {
      await ensureShim()
      return await ShimClient.getLastCommand(String(id))
    },
    subscribeToTitleChange: async (id, callback) => {
      await ensureShim()
      return ShimClient.subscribeToTitle(String(id), callback)
    },
    subscribeToAllTitleChanges: (callback) => {
      void ensureShim().then(() => {
        ShimClient.subscribeToAllTitles((event) => {
          callback({ ptyId: event.ptyId as PtyId, title: event.title })
        })
      })
      return () => {}
    },
    dispose: () => {
      // Shim service doesn't need cleanup - it's a proxy
    },
  }
}

/**
 * Create test PTY service - mock PTY for testing
 */
export function createTestPtyService(): PtyService {
  return {
    create: async () => makePtyId(),
    write: async () => undefined,
    sendFocusEvent: async () => undefined,
    resize: async () => undefined,
    getCwd: async () => "/test/cwd",
    destroy: async () => undefined,
    getSession: async (id) => ({
      id,
      pid: 12345,
      cols: 80 as Cols,
      rows: 24 as Rows,
      cwd: "/test/cwd",
      shell: "/bin/bash",
    }),
    getTerminalState: async () => ({
      cells: [],
      cursorX: 0,
      cursorY: 0,
      cursorVisible: true,
    } as unknown as TerminalState),
    subscribe: async () => () => {},
    subscribeToScroll: async () => () => {},
    subscribeUnified: async () => () => {},
    onExit: async () => () => {},
    getScrollState: async () => ({
      viewportOffset: 0,
      scrollbackLength: 0,
      isAtBottom: true,
    }),
    setScrollOffset: async () => undefined,
    setUpdateEnabled: async () => undefined,
    getEmulator: async () => {
      throw new Error("No emulator in test layer")
    },
    setHostColors: async () => undefined,
    destroyAll: async () => undefined,
    listAll: async () => [],
    getForegroundProcess: async () => undefined,
    getGitBranch: async () => undefined,
    getGitInfo: async () => undefined,
    getGitDiffStats: async () => undefined,
    subscribeToLifecycle: () => () => {},
    getTitle: async () => "",
    getLastCommand: async () => undefined,
    subscribeToTitleChange: async () => () => {},
    subscribeToAllTitleChanges: () => () => {},
    dispose: () => {
      // Test service doesn't need cleanup
    },
  }
}
