/**
 * Tests for PTY data handler scheduling and sync buffering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test"
import { createDataHandler } from "../../../../src/effect/services/pty/data-handler"
import { createSyncModeParser } from "../../../../src/terminal/sync-mode-parser"
import type { InternalPtySession } from "../../../../src/effect/services/pty/types"
import type { TerminalQueryPassthrough } from "../../../../src/terminal/terminal-query-passthrough"

function createSession() {
  const emulator = {
    write: vi.fn(),
    drainResponses: vi.fn(() => [] as string[]),
    isDisposed: false,
  }
  const liveEmulator = {
    write: vi.fn(),
    drainResponses: vi.fn(() => [] as string[]),
    isDisposed: false,
    isAlternateScreen: vi.fn(() => false),
    getScrollbackLength: vi.fn(() => 0),
    getScrollbackLine: vi.fn(() => null),
  }

  const pty = {
    write: vi.fn(),
  }

  const queryPassthrough = {
    process: (data: string) => data,
    processWithResponses: (data: string) => ({ text: data, responses: [] as string[] }),
  } as TerminalQueryPassthrough

  const session: InternalPtySession = {
    id: "pty-test" as InternalPtySession["id"],
    pty: pty as unknown as InternalPtySession["pty"],
    emulator: emulator as unknown as InternalPtySession["emulator"],
    liveEmulator: liveEmulator as unknown as InternalPtySession["liveEmulator"],
    scrollbackArchive: {
      reset: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as InternalPtySession["scrollbackArchive"],
    scrollbackArchiver: {
      schedule: vi.fn(),
      reset: vi.fn(),
    } as unknown as InternalPtySession["scrollbackArchiver"],
    queryPassthrough,
    cols: 80,
    rows: 24,
    cellWidth: 8,
    cellHeight: 16,
    pixelWidth: 640,
    pixelHeight: 384,
    cwd: "",
    shell: "",
    closing: false,
    subscribers: new Set(),
    scrollSubscribers: new Set(),
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    lastCommand: null,
    focusTrackingEnabled: false,
    focusState: false,
    focusTrackingOwnerProcess: null,
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 0,
      lastIsAtBottom: true,
    },
  }

  return { session, emulator, liveEmulator, pty }
}

describe("createDataHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("batches segments across ticks", async () => {
    const { session, emulator } = createSession()
    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    const segments = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i))
    for (const segment of segments) {
      handler.handleData(segment)
    }

    await vi.runAllTimersAsync()

    const writes = emulator.write.mock.calls.map(([data]) => data as string)
    expect(writes.length).toBe(3)
    expect(writes.join("")).toBe(segments.join(""))
  })

  it("flushes sync mode buffer after timeout", async () => {
    const { session, emulator } = createSession()
    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 10,
    })

    handler.handleData("\x1b[?2026hHello")

    expect(emulator.write).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    await vi.runAllTimersAsync()

    expect(emulator.write).toHaveBeenCalledTimes(1)
    expect(emulator.write).toHaveBeenCalledWith("Hello")
  })

  it("writes terminal responses back to the PTY", async () => {
    const { session, emulator, pty } = createSession()
    emulator.drainResponses = vi.fn(() => ["\x1b_Gi=1;OK\x1b\\"])

    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    handler.handleData("query")
    await vi.runAllTimersAsync()

    expect(pty.write).toHaveBeenCalledWith("\x1b_Gi=1;OK\x1b\\")
  })

  it("flushes immediately when kitty queries are present", () => {
    const { session, emulator } = createSession()

    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    handler.handleData("\x1b_Ga=q,i=1;AAAA\x1b\\")

    expect(emulator.write).toHaveBeenCalledTimes(1)
  })

  it("defers query responses until after emulator responses for kitty queries", () => {
    const { session, emulator, pty } = createSession()
    const passthrough = session.queryPassthrough as TerminalQueryPassthrough & {
      processWithResponses: (data: string) => { text: string; responses: string[] }
    }

    passthrough.processWithResponses = vi.fn(() => ({
      text: "payload",
      responses: ["\x1b[c"],
    }))
    emulator.drainResponses = vi.fn(() => ["\x1b_Gi=1;OK\x1b\\"])

    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    handler.handleData("\x1b_Ga=q,i=1;AAAA\x1b\\")

    const writes = pty.write.mock.calls.map(([data]) => data as string)
    expect(writes[0]).toBe("\x1b_Gi=1;OK\x1b\\")
    expect(writes[1]).toBe("\x1b[c")
  })

  it("syncs focus state when focus tracking enables", () => {
    const { session, pty } = createSession()
    session.focusState = false

    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    handler.handleData("\x1b[?1004h")

    expect(session.focusTrackingEnabled).toBe(true)
    expect(pty.write).toHaveBeenCalledWith("\x1b[O")
  })
})
