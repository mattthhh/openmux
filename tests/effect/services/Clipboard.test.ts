/**
 * Tests for Clipboard service.
 * Uses fresh test instances to ensure state isolation.
 */
import { describe, expect, it } from "bun:test"
import { createTestClipboard } from "../../../src/effect/services/Clipboard"
import type { ClipboardError } from "../../../src/effect/errors"

describe("Clipboard", () => {
  describe("test implementation", () => {
    it("writes and reads text", async () => {
      const clipboard = createTestClipboard()

      const error = await clipboard.write("Hello, World!")
      expect(error).toBeUndefined()

      const text = await clipboard.read()
      expect(text).toBe("Hello, World!")
    })

    it("overwrites previous content", async () => {
      const clipboard = createTestClipboard()

      await clipboard.write("First")
      await clipboard.write("Second")
      const text = await clipboard.read()

      expect(text).toBe("Second")
    })

    it("starts empty", async () => {
      const clipboard = createTestClipboard()

      const text = await clipboard.read()
      expect(text).toBe("")
    })
  })
})
