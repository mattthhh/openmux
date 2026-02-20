/**
 * Subscriber notification helpers for PTY service (errore version)
 */

import type { TerminalScrollState, UnifiedTerminalUpdate } from "../../../core/types"
import type { InternalPtySession } from "./types"
import { HOT_SCROLLBACK_LIMIT } from "../../../terminal/scrollback-config"

/**
 * Get current scroll state from a session.
 * Adjusts viewportOffset when new content is added while scrolled back,
 * to maintain the same visual position (prevents content from shifting up).
 */
export function getCurrentScrollState(session: InternalPtySession): TerminalScrollState {
  const scrollbackLength = session.emulator.getScrollbackLength()
  const liveScrollbackLength = session.liveEmulator.getScrollbackLength()

  // SCROLL POSITION FIX: When scrollback length changes and the user is scrolled back,
  // adjust viewportOffset by the delta to keep the same content anchored in view.
  const scrollbackDelta = scrollbackLength - session.scrollState.lastScrollbackLength
  if (scrollbackDelta !== 0 && session.scrollState.viewportOffset > 0) {
    const nextOffset = session.scrollState.viewportOffset + scrollbackDelta
    session.scrollState.viewportOffset = Math.max(0, Math.min(nextOffset, scrollbackLength))
  }

  // Update last scrollback length for next comparison
  session.scrollState.lastScrollbackLength = scrollbackLength
  if (session.scrollState.viewportOffset > scrollbackLength) {
    session.scrollState.viewportOffset = scrollbackLength
  }

  const isAtBottom = session.scrollState.viewportOffset === 0
  if (isAtBottom && !session.scrollState.lastIsAtBottom) {
    session.scrollbackArchive.clearCache()
  }
  session.scrollState.lastIsAtBottom = isAtBottom

  return {
    viewportOffset: session.scrollState.viewportOffset,
    scrollbackLength,
    isAtBottom,
    isAtScrollbackLimit: liveScrollbackLength >= HOT_SCROLLBACK_LIMIT,
  }
}

/**
 * Notify all terminal state subscribers
 * Unified subscribers get dirty deltas, legacy subscribers get full state
 */
export function notifySubscribers(session: InternalPtySession): void {
  // Notify unified subscribers first (uses dirty delta for efficiency)
  if (session.unifiedSubscribers.size > 0) {
    const scrollState = getCurrentScrollState(session)
    const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
    const unifiedUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: dirtyUpdate,
      scrollState,
    }
    for (const callback of session.unifiedSubscribers) {
      callback(unifiedUpdate)
    }
  }

  // Legacy subscribers still get full state
  if (session.subscribers.size > 0) {
    const state = session.emulator.getTerminalState()
    for (const callback of session.subscribers) {
      callback(state)
    }
  }
}

/**
 * Notify scroll subscribers (lightweight - no terminal state rebuild)
 */
export function notifyScrollSubscribers(session: InternalPtySession): void {
  // Notify unified subscribers with scroll-only update
  if (session.unifiedSubscribers.size > 0) {
    const scrollState = getCurrentScrollState(session)
    // For scroll-only updates, we can create a minimal dirty update
    const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
    const unifiedUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: dirtyUpdate,
      scrollState,
    }
    for (const callback of session.unifiedSubscribers) {
      callback(unifiedUpdate)
    }
  }

  // Legacy scroll subscribers
  for (const callback of session.scrollSubscribers) {
    callback()
  }
}
