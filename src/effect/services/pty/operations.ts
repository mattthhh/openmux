/**
 * PTY Operations - core operations for managing PTY sessions (errore version)
 */
import type { TerminalState } from "../../../core/types"
import { PtyNotFoundError } from "../../errors"
import type { PtyId, Cols, Rows } from "../../types"
import type { PtySession } from "../../models"
import type { InternalPtySession } from "./types"
import { notifySubscribers, notifyScrollSubscribers } from "./notification"
import { HOT_SCROLLBACK_LIMIT } from "../../../terminal/scrollback-config"
import type { SubscriptionRegistry } from "./subscription-manager"
import { tracePtyEvent, tracePtyChunk } from "../../../terminal/pty-trace"

const FOCUS_IN_SEQUENCE = "\x1b[I"
const FOCUS_OUT_SEQUENCE = "\x1b[O"

export interface OperationsDeps {
  sessions: Map<PtyId, InternalPtySession>
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>
}

export function createOperations(deps: OperationsDeps) {
  const { sessions, lifecycleRegistry } = deps

  function getSessionOrFail(id: PtyId): InternalPtySession | PtyNotFoundError {
    const session = sessions.get(id)
    if (!session) {
      return new PtyNotFoundError({ ptyId: id })
    }
    return session
  }

  async function write(id: PtyId, data: string): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError

    // Auto-scroll to bottom when user types
    if (session.scrollState.viewportOffset > 0) {
      session.scrollState.viewportOffset = 0
      notifySubscribers(session)
      notifyScrollSubscribers(session)
    }

    session.pty.write(data)
  }

  async function sendFocusEvent(id: PtyId, focused: boolean): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    session.focusState = focused
    const sequence = focused ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE
    tracePtyEvent("pty-focus-send", {
      ptyId: id,
      focused,
      trackingEnabled: session.focusTrackingEnabled,
    })
    tracePtyChunk("pty-focus-seq", sequence, { ptyId: id })
    if (!session.focusTrackingEnabled) return
    session.pty.write(sequence)
  }

  async function resize(
    id: PtyId,
    cols: Cols,
    rows: Rows,
    pixelWidth?: number,
    pixelHeight?: number
  ): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError

    const hasPixels = typeof pixelWidth === "number" && pixelWidth > 0
      && typeof pixelHeight === "number" && pixelHeight > 0

    if (hasPixels && "resizeWithPixels" in session.pty) {
      session.pty.resizeWithPixels(cols, rows, pixelWidth, pixelHeight)
    } else {
      session.pty.resize(cols, rows)
    }
    session.cols = cols
    session.rows = rows
    if (hasPixels) {
      session.pixelWidth = pixelWidth
      session.pixelHeight = pixelHeight
      session.cellWidth = Math.max(1, Math.floor(pixelWidth / cols))
      session.cellHeight = Math.max(1, Math.floor(pixelHeight / rows))
    } else {
      session.pixelWidth = cols * session.cellWidth
      session.pixelHeight = rows * session.cellHeight
    }
    session.emulator.resize(cols, rows)
    session.emulator.setPixelSize?.(session.pixelWidth, session.pixelHeight)

    // Check if DECSET 2048 (in-band resize notifications) is enabled
    try {
      const inBandResizeEnabled = session.emulator.getMode(2048)
      if (inBandResizeEnabled) {
        const resizeNotification =
          `\x1b[48;${rows};${cols};${session.pixelHeight};${session.pixelWidth}t`
        session.pty.write(resizeNotification)
      }
    } catch {
      // Ignore mode query errors
    }

    notifySubscribers(session)
  }

  async function getCwd(id: PtyId): Promise<PtyNotFoundError | string> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError

    if (session.pty.pid === undefined) {
      return session.cwd
    }

    // Use native zig-pty method directly (no subprocess spawning)
    const cwd = session.pty.getCwd()
    return cwd ?? session.cwd
  }

  async function destroy(id: PtyId): Promise<void> {
    const session = sessions.get(id)
    if (!session) return

    if (session.closing) {
      return
    }
    session.closing = true

    // Clear subscribers
    for (const callback of session.subscribers) {
      callback(null as unknown as TerminalState)
    }
    session.subscribers.clear()

    // Kill PTY and dispose emulator
    session.pty.kill()
    session.emulator.dispose()
    session.kittyRelayDispose?.()
    session.queryPassthrough.dispose()

    // Remove from map BEFORE emitting lifecycle event
    sessions.delete(id)

    // Emit lifecycle event AFTER removal
    lifecycleRegistry.notify({ type: 'destroyed', ptyId: id })
  }

  async function getSession(id: PtyId): Promise<PtyNotFoundError | PtySession> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError

    return {
      id: session.id,
      pid: session.pty.pid ?? 0,
      cols: session.cols as Cols,
      rows: session.rows as Rows,
      cwd: session.cwd,
      shell: session.shell,
    }
  }

  async function getTerminalState(id: PtyId): Promise<PtyNotFoundError | TerminalState> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    return session.emulator.getTerminalState()
  }

  async function getScrollState(id: PtyId): Promise<
    PtyNotFoundError | {
      viewportOffset: number
      scrollbackLength: number
      isAtBottom: boolean
      isAtScrollbackLimit?: boolean
    }
  > {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    const scrollbackLength = session.emulator.getScrollbackLength()
    const isAtScrollbackLimit = session.liveEmulator.getScrollbackLength() >= HOT_SCROLLBACK_LIMIT

    return {
      viewportOffset: session.scrollState.viewportOffset,
      scrollbackLength,
      isAtBottom: session.scrollState.viewportOffset === 0,
      isAtScrollbackLimit,
    }
  }

  async function setScrollOffset(id: PtyId, offset: number): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    const maxOffset = session.emulator.getScrollbackLength()
    session.scrollState.viewportOffset = Math.max(0, Math.min(offset, maxOffset))
    notifyScrollSubscribers(session)
  }

  async function setUpdateEnabled(id: PtyId, enabled: boolean): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    session.emulator.setUpdateEnabled?.(enabled)
  }

  async function getEmulator(id: PtyId): Promise<PtyNotFoundError | import("../../../terminal/emulator-interface").ITerminalEmulator> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    return session.emulator
  }

  async function destroyAll(): Promise<void> {
    const ids = Array.from(sessions.keys())
    for (const id of ids) {
      await destroy(id)
    }
  }

  async function listAll(): Promise<PtyId[]> {
    return Array.from(sessions.keys())
  }

  async function getTitle(id: PtyId): Promise<PtyNotFoundError | string> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    return session.emulator.getTitle()
  }

  async function getLastCommand(id: PtyId): Promise<PtyNotFoundError | string | undefined> {
    const sessionOrError = getSessionOrFail(id)
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError
    }
    const session = sessionOrError
    return session.lastCommand ?? undefined
  }

  return {
    write,
    sendFocusEvent,
    resize,
    getCwd,
    destroy,
    getSession,
    getTerminalState,
    getScrollState,
    setScrollOffset,
    setUpdateEnabled,
    getEmulator,
    destroyAll,
    listAll,
    getTitle,
    getLastCommand,
    getSessionOrFail,
  }
}
