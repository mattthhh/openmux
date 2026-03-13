/**
 * Clear-screen suppression tests for data-handler
 * Verifies that CSI 2 J sequences are suppressed within the resize window
 */

import { describe, it, expect } from "bun:test"
import type { InternalPtySession } from "../types"

// Constants from data-handler.ts (must match)
const CLEAR_SUPPRESSION_WINDOW_MS = 50

// Replicate the helper functions for testing
function shouldSuppressClearScreen(session: InternalPtySession): boolean {
  if (session.lastResizeTime === 0) return false
  const elapsed = Date.now() - session.lastResizeTime
  return elapsed < CLEAR_SUPPRESSION_WINDOW_MS
}

function suppressClearScreenSequences(data: string): string {
  const CLEAR_SCREEN_REGEX = /\x1b\[2J/g
  const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g
  return data.replace(CLEAR_SCREEN_REGEX, "").replace(CLEAR_SCREEN_C1_REGEX, "")
}

// Mock session factory
function createMockSession(lastResizeTime: number): InternalPtySession {
  return {
    id: "test-pty" as any,
    pty: {} as any,
    emulator: {} as any,
    liveEmulator: {} as any,
    scrollbackArchive: {} as any,
    scrollbackArchiver: {} as any,
    queryPassthrough: {} as any,
    cols: 80,
    rows: 24,
    pixelWidth: 800,
    pixelHeight: 600,
    cellWidth: 10,
    cellHeight: 25,
    cwd: "/tmp",
    shell: "bash",
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
    lastResizeTime,
  } as unknown as InternalPtySession
}

describe("clear-screen suppression", () => {
  describe("shouldSuppressClearScreen", () => {
    it("should return false when lastResizeTime is 0", () => {
      const session = createMockSession(0)
      expect(shouldSuppressClearScreen(session)).toBe(false)
    })

    it("should return true immediately after resize", () => {
      const session = createMockSession(Date.now())
      expect(shouldSuppressClearScreen(session)).toBe(true)
    })

    it("should return false after suppression window passes", async () => {
      const session = createMockSession(Date.now())
      
      // Should suppress immediately
      expect(shouldSuppressClearScreen(session)).toBe(true)
      
      // Wait for window to pass
      await new Promise((resolve) => setTimeout(resolve, CLEAR_SUPPRESSION_WINDOW_MS + 10))
      
      // Should not suppress after window passes
      expect(shouldSuppressClearScreen(session)).toBe(false)
    })
  })

  describe("suppressClearScreenSequences", () => {
    it("should remove CSI 2 J sequences", () => {
      const input = "hello\x1b[2Jworld"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("helloworld")
    })

    it("should remove C1 CSI 2 J sequences", () => {
      const input = "hello\x9b2Jworld"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("helloworld")
    })

    it("should remove multiple CSI 2 J sequences", () => {
      const input = "a\x1b[2Jb\x1b[2Jc"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("abc")
    })

    it("should not affect other CSI sequences", () => {
      const input = "\x1b[31mred\x1b[0m\x1b[2J\x1b[H"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("\x1b[31mred\x1b[0m\x1b[H")
    })

    it("should not affect CSI 3 J (scrollback clear)", () => {
      const input = "\x1b[3J"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("\x1b[3J")
    })

    it("should not affect CSI 0 J or CSI 1 J", () => {
      const input = "\x1b[0J\x1b[1J"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("\x1b[0J\x1b[1J")
    })

    it("should handle empty string", () => {
      const input = ""
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("")
    })

    it("should handle string with no CSI sequences", () => {
      const input = "hello world"
      const output = suppressClearScreenSequences(input)
      expect(output).toBe("hello world")
    })
  })
})
