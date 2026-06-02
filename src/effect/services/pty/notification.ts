/**
 * Subscriber notification helpers for PTY service (errore version).
 */

import type { TerminalScrollState, UnifiedTerminalUpdate } from '../../../core/types';
import type { InternalPtySession } from './types';
import { HOT_SCROLLBACK_LIMIT } from '../../../terminal/scrollback-config';

/**
 * Get current scroll state from a session.
 * Adjusts viewportOffset when new content is added while scrolled back,
 * to maintain the same visual position (prevents content from shifting up).
 */
export function getCurrentScrollState(session: InternalPtySession): TerminalScrollState {
  const scrollbackLength = session.emulator.getScrollbackLength();
  const liveScrollbackLength = session.liveEmulator.getScrollbackLength();

  const scrollbackDelta = scrollbackLength - session.scrollState.lastScrollbackLength;
  // Only adjust for scrollback GROWTH (new content added at the bottom).
  // When scrollback SHRINKS (archiver trims oldest lines from the top),
  // the user's offset from the bottom is unchanged — lines removed
  // above them don't affect their viewport position. The clamping
  // below handles the edge case where offset exceeds the new length.
  if (scrollbackDelta > 0 && session.scrollState.viewportOffset > 0) {
    const nextOffset = session.scrollState.viewportOffset + scrollbackDelta;
    session.scrollState.viewportOffset = Math.max(0, Math.min(nextOffset, scrollbackLength));
  }

  session.scrollState.lastScrollbackLength = scrollbackLength;
  if (session.scrollState.viewportOffset > scrollbackLength) {
    session.scrollState.viewportOffset = scrollbackLength;
  }

  const isAtBottom = session.scrollState.viewportOffset === 0;
  if (isAtBottom && !session.scrollState.lastIsAtBottom) {
    session.scrollbackArchive.clearCache();
  }
  session.scrollState.lastIsAtBottom = isAtBottom;

  return {
    viewportOffset: session.scrollState.viewportOffset,
    scrollbackLength,
    isAtBottom,
    isAtScrollbackLimit: liveScrollbackLength >= HOT_SCROLLBACK_LIMIT,
  };
}

function buildUnifiedUpdate(session: InternalPtySession): UnifiedTerminalUpdate {
  const scrollState = getCurrentScrollState(session);
  return {
    terminalUpdate: session.emulator.getDirtyUpdate(scrollState),
    scrollState,
  };
}

/** Notify unified subscribers after terminal content changes. */
export function notifySubscribers(session: InternalPtySession): void {
  if (session.unifiedSubscribers.size === 0) return;
  const update = buildUnifiedUpdate(session);
  for (const callback of session.unifiedSubscribers) {
    callback(update);
  }
}

/** Notify unified subscribers after scroll-only changes. */
export function notifyScrollSubscribers(session: InternalPtySession): void {
  if (session.unifiedSubscribers.size === 0) return;
  const update = buildUnifiedUpdate(session);
  for (const callback of session.unifiedSubscribers) {
    callback(update);
  }
}
