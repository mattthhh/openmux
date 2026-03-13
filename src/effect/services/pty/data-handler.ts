/**
 * PTY data handler factory - creates the data processing pipeline (errore version)
 * Handles sync mode parsing and query passthrough.
 */
import type { SyncModeParser } from "../../../terminal/sync-mode-parser"
import type { InternalPtySession } from "./types"
import { deferMacrotask } from "../../../core/scheduling"
import { tracePtyChunk, tracePtyEvent } from "../../../terminal/pty-trace"
import { copyToClipboard } from "../../bridge"
import * as errore from "errore"

/** Base64 decode error for clipboard operations */
class ClipboardDecodeError extends errore.createTaggedError({
  name: "ClipboardDecodeError",
  message: "Clipboard base64 decode failed: $reason",
}) {}

interface DataHandlerOptions {
  session: InternalPtySession
  syncParser: SyncModeParser
  commandParser?: { processData: (data: string) => void }
  syncTimeoutMs?: number
}

interface DataHandlerState {
  pendingSegments: string[]
  syncTimeout: ReturnType<typeof setTimeout> | null
  pendingResponses: { fence: number; responses: string[] }[]
  segmentCounter: number
  processedCounter: number
}

const ESC = "\x1b"
const APC_C1 = "\x9f"
const FOCUS_TRACKING_ENABLE = "\x1b[?1004h"
const FOCUS_TRACKING_DISABLE = "\x1b[?1004l"
const FOCUS_TRACKING_ENABLE_C1 = "\x9b?1004h"
const FOCUS_TRACKING_DISABLE_C1 = "\x9b?1004l"
const FOCUS_IN_SEQUENCE = "\x1b[I"
const FOCUS_OUT_SEQUENCE = "\x1b[O"
const FOCUS_TRACKING_PROBE_LEN = 16
const SCROLLBACK_CLEAR_PROBE_LEN = 128
const SCROLLBACK_CLEAR_REGEX = /\x1b\[([0-9;]*)J/g
const SCROLLBACK_CLEAR_C1_REGEX = /\x9b([0-9;]*)J/g

// Clear-screen suppression after resize (prevents shell SIGWINCH clears from destroying reflowed content)
const CLEAR_SUPPRESSION_WINDOW_MS = 50
const CLEAR_SCREEN_REGEX = /\x1b\[2J/g
const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g

function normalizeProcessName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed
  const normalized = base.replace(/^-+/, "").toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function resolveFocusTrackingOwnerProcess(session: InternalPtySession): string | null {
  const ptyAny = session.pty as unknown as { getForegroundProcessName?: () => string | null }
  if (typeof ptyAny.getForegroundProcessName !== "function") return null
  try {
    return normalizeProcessName(ptyAny.getForegroundProcessName())
  } catch {
    return null
  }
}

function hasScrollbackEraseSequence(text: string, regex: RegExp): boolean {
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const params = match[1] ?? ""
    const parts = params.split(";").filter(Boolean)
    if (parts.includes("3")) return true
  }
  return false
}

/**
 * Check if we should suppress clear-screen sequences (CSI 2 J) for this session.
 * Returns true if we're within the suppression window after a resize.
 */
function shouldSuppressClearScreen(session: InternalPtySession): boolean {
  if (session.lastResizeTime === 0) return false
  const elapsed = Date.now() - session.lastResizeTime
  return elapsed < CLEAR_SUPPRESSION_WINDOW_MS
}

/**
 * Filter out clear-screen sequences (CSI 2 J) from data.
 * Used during the suppression window after resize to prevent shell SIGWINCH
 * from clearing the reflowed scrollback content.
 */
function suppressClearScreenSequences(data: string): string {
  // Replace CSI 2 J with nothing (drop the sequence)
  return data.replace(CLEAR_SCREEN_REGEX, "").replace(CLEAR_SCREEN_C1_REGEX, "")
}

/**
 * Detect and process OSC 52 clipboard write responses from emulator.
 * These are responses with format: "\x1B]52;CLIPBOARD;c:<base64data>\x07"
 * Returns an array of PTY responses (non-clipboard responses) and processes clipboard data separately.
 */
function processClipboardResponses(
  responses: string[],
  ptyId: string
): string[] {
  const ptyResponses: string[] = []
  const CLIPBOARD_PREFIX = "\x1B]52;CLIPBOARD;c:"
  const BEL = "\x07"

  for (const response of responses) {
    // Debug: Log all responses to see what's coming through
    tracePtyEvent("clipboard-response-raw", {
      ptyId,
      responsePreview: response.slice(0, 50),
      responseLength: response.length,
      isClipboard: response.startsWith(CLIPBOARD_PREFIX),
    })
    
    if (response.startsWith(CLIPBOARD_PREFIX) && response.endsWith(BEL)) {
      // Extract base64 data
      const base64Data = response.slice(CLIPBOARD_PREFIX.length, -BEL.length)
      if (base64Data.length === 0) continue

      // Decode base64 and copy to clipboard
      let decoded: string
      try {
        decoded = Buffer.from(base64Data, "base64").toString("utf-8")
      } catch (err: unknown) {
        const error = new ClipboardDecodeError({
          reason: err instanceof Error ? err.message : String(err),
        })
        tracePtyEvent("clipboard-decode-error", {
          ptyId,
          error: error.message,
        })
        continue
      }

      if (decoded.length === 0) continue

      copyToClipboard(decoded).catch((err: unknown) => {
        tracePtyEvent("clipboard-copy-error", {
          ptyId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      tracePtyEvent("clipboard-copy", {
        ptyId,
        charCount: decoded.length,
      })
      continue
    }

    // Not a clipboard response, pass through to PTY
    ptyResponses.push(response)
  }

  return ptyResponses
}

/**
 * Creates the PTY data handler that processes incoming data
 * Returns the data handler function and cleanup function
 */
export function createDataHandler(options: DataHandlerOptions) {
  const { session, syncParser, commandParser, syncTimeoutMs = 100 } = options
  const maxSegmentsPerTick = 8
  const maxCharsPerTick = 32_768
  const maxBudgetMs = 4
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  const state: DataHandlerState = {
    pendingSegments: [],
    syncTimeout: null,
    pendingResponses: [],
    segmentCounter: 0,
    processedCounter: 0,
  }
  let kittyProbeBuffer = ""
  let focusProbeBuffer = ""
  let scrollbackClearBuffer = ""

  const analyzeKitty = (data: string): { hasKittyApc: boolean; hasKittyQuery: boolean } => {
    if (data.length === 0) return { hasKittyApc: false, hasKittyQuery: false }
    const combined = kittyProbeBuffer + data
    kittyProbeBuffer = combined.slice(-256)
    const hasKittyApc = combined.includes(`${ESC}_G`) || combined.includes(`${APC_C1}G`)
    const hasKittyQuery = hasKittyApc && combined.includes("a=q")
    return { hasKittyApc, hasKittyQuery }
  }

  const updateFocusTracking = (data: string) => {
    if (data.length === 0) return
    const combined = focusProbeBuffer + data

    const lastEnable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE),
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE_C1)
    )
    const lastDisable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE),
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE_C1)
    )

    if (lastEnable !== -1 || lastDisable !== -1) {
      const wasEnabled = session.focusTrackingEnabled
      session.focusTrackingEnabled = lastEnable > lastDisable

      if (session.focusTrackingEnabled) {
        const ownerProcess = resolveFocusTrackingOwnerProcess(session)
        if (ownerProcess) {
          session.focusTrackingOwnerProcess = ownerProcess
        } else if (!wasEnabled) {
          session.focusTrackingOwnerProcess = null
        }
      } else {
        session.focusTrackingOwnerProcess = null
      }

      if (session.focusTrackingEnabled !== wasEnabled) {
        tracePtyEvent("pty-focus-tracking", {
          ptyId: session.id,
          enabled: session.focusTrackingEnabled,
          ownerProcess: session.focusTrackingOwnerProcess,
        })
      }

      if (!wasEnabled && session.focusTrackingEnabled) {
        tracePtyEvent("pty-focus-sync", {
          ptyId: session.id,
          focused: session.focusState,
        })
        session.pty.write(session.focusState ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE)
      }
    }

    focusProbeBuffer = combined.slice(-FOCUS_TRACKING_PROBE_LEN)
  }

  const shouldClearScrollback = (data: string): boolean => {
    if (data.length === 0) return false
    let combined = scrollbackClearBuffer + data
    if (combined.length > 2048) {
      combined = combined.slice(-2048)
    }
    scrollbackClearBuffer = combined.slice(-SCROLLBACK_CLEAR_PROBE_LEN)

    return hasScrollbackEraseSequence(combined, SCROLLBACK_CLEAR_REGEX) ||
      hasScrollbackEraseSequence(combined, SCROLLBACK_CLEAR_C1_REGEX)
  }

  const resetScrollbackState = () => {
    session.scrollbackArchive.reset()
    session.scrollbackArchiver.reset()
    session.scrollState.viewportOffset = 0
    session.scrollState.lastScrollbackLength = 0
    session.scrollState.lastIsAtBottom = true
  }

  const flushPendingResponses = () => {
    while (state.pendingResponses.length > 0) {
      const next = state.pendingResponses[0]
      if (next.fence > state.processedCounter) break
      state.pendingResponses.shift()
      for (const response of next.responses) {
        session.pty.write(response)
      }
    }
  }


  const drainPending = (options?: { force?: boolean }) => {
    session.pendingNotify = false

    if (session.emulator.isDisposed) {
      state.pendingSegments = []
      return
    }

    if (state.pendingSegments.length === 0) {
      flushPendingResponses()
      return
    }

    const force = options?.force ?? false
    const start = now()
    let batch = ""
    let batchLen = 0
    let segmentsProcessed = 0
    let wrote = false

    if (force) {
      while (state.pendingSegments.length > 0) {
        let segment = state.pendingSegments.shift() ?? ""
        if (segment.length === 0) continue
        if (shouldClearScrollback(segment)) {
          resetScrollbackState()
        }
        // Suppress clear-screen sequences during resize suppression window
        if (shouldSuppressClearScreen(session)) {
          segment = suppressClearScreenSequences(segment)
          if (segment.length === 0) continue
        }
        session.emulator.write(segment)
        wrote = true
        segmentsProcessed += 1
      }
    } else {
      while (state.pendingSegments.length > 0) {
        const segment = state.pendingSegments[0]
        if (segment.length === 0) {
          state.pendingSegments.shift()
          continue
        }

        if (batchLen > 0 && batchLen + segment.length > maxCharsPerTick) {
          break
        }

        batch += segment
        batchLen += segment.length
        segmentsProcessed += 1
        state.pendingSegments.shift()

        if (segmentsProcessed >= maxSegmentsPerTick) break
        if (batchLen >= maxCharsPerTick) break
        if (now() - start >= maxBudgetMs) break
      }

      if (batchLen === 0 && state.pendingSegments.length > 0) {
        batch = state.pendingSegments.shift() ?? ""
      }

      if (batch.length > 0) {
        if (shouldClearScrollback(batch)) {
          resetScrollbackState()
        }
        // Suppress clear-screen sequences during resize suppression window
        if (shouldSuppressClearScreen(session)) {
          batch = suppressClearScreenSequences(batch)
        }
        if (batch.length > 0) {
          session.emulator.write(batch)
          wrote = true
        }
      }
    }

    if (wrote && !session.emulator.isDisposed) {
      const responses = session.emulator.drainResponses?.()
      if (responses && responses.length > 0) {
        // Process clipboard responses separately (copy to system clipboard)
        // and filter them out from PTY responses
        const ptyResponses = processClipboardResponses(responses, session.id)
        for (const response of ptyResponses) {
          tracePtyChunk("emulator-response", response, { ptyId: session.id })
          session.pty.write(response)
        }
      }
    }

    if (wrote) {
      session.scrollbackArchiver.schedule()
    }

    if (segmentsProcessed > 0) {
      state.processedCounter += segmentsProcessed
      flushPendingResponses()
    }

    if (state.pendingSegments.length > 0) {
      scheduleNotify()
    }
  }

  // Helper to schedule notification (uses macrotask to yield for rendering)
  const scheduleNotify = () => {
    if (!session.pendingNotify) {
      session.pendingNotify = true
      deferMacrotask(drainPending)
    }
  }

  // The data handler function
  const handleData = (data: string) => {
    tracePtyChunk("pty-in", data, { ptyId: session.id })
    updateFocusTracking(data)
    const kittySignals = analyzeKitty(data)
    const hasKittyQuery = kittySignals.hasKittyQuery
    let textData: string
    let deferredResponses: string[] | null = null

    // Handle terminal queries (cursor position, device attributes, colors, etc.)
    if (hasKittyQuery && "processWithResponses" in session.queryPassthrough) {
      const processed = session.queryPassthrough.processWithResponses(data)
      textData = processed.text
      deferredResponses = processed.responses
    } else {
      textData = session.queryPassthrough.process(data)
    }

    if (commandParser) {
      commandParser.processData(textData)
    }

    // Process through sync mode parser to respect frame boundaries
    // This buffers content between CSI ? 2026 h and CSI ? 2026 l
    const { readySegments, isBuffering } = syncParser.process(textData)

    // Handle sync buffering timeout (safety valve)
    if (isBuffering) {
      if (!state.syncTimeout) {
        state.syncTimeout = setTimeout(() => {
          // Safety flush - sync mode took too long (app may have crashed)
          const flushed = syncParser.flush()
          if (flushed.length > 0) {
            state.pendingSegments.push(flushed)
            scheduleNotify()
          }
          state.syncTimeout = null
        }, syncTimeoutMs)
      }
    } else if (state.syncTimeout) {
      clearTimeout(state.syncTimeout)
      state.syncTimeout = null
    }

    // Add ready segments to pending queue
    let segmentsAdded = 0
    for (const segment of readySegments) {
      if (segment.length > 0) {
        state.pendingSegments.push(segment)
        segmentsAdded += 1
      }
    }
    if (segmentsAdded > 0) {
      state.segmentCounter += segmentsAdded
    }

    if (deferredResponses && deferredResponses.length > 0) {
      for (const response of deferredResponses) {
        tracePtyChunk("pty-query-response", response, {
          ptyId: session.id,
          deferred: true,
        })
      }
      state.pendingResponses.push({
        fence: state.segmentCounter,
        responses: deferredResponses,
      })
      if (state.pendingSegments.length === 0) {
        flushPendingResponses()
      }
    }

    // Only schedule notification if we have data and aren't buffering
    // When buffering, we wait for the complete frame before notifying
    if (!isBuffering && state.pendingSegments.length > 0) {
      if (kittySignals.hasKittyApc) {
        drainPending({ force: true })
      } else {
        scheduleNotify()
      }
    }
  }

  // Cleanup function to clear any pending timeouts
  const cleanup = () => {
    if (state.syncTimeout) {
      clearTimeout(state.syncTimeout)
      state.syncTimeout = null
    }
  }

  return { handleData, cleanup, scheduleNotify }
}
