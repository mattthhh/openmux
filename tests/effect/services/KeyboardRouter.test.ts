/**
 * Tests for KeyboardRouter module
 */
import { describe, test, expect, beforeEach } from "bun:test"
import {
  registerHandler,
  routeKey,
  getActiveOverlay,
  hasHandler,
  clearAllHandlers,
  type KeyEvent,
  type OverlayType,
} from "../../../src/effect/services/KeyboardRouter"

describe("KeyboardRouter", () => {
  // Clear all handlers before each test
  beforeEach(() => {
    clearAllHandlers()
  })

  describe("registerHandler", () => {
    test("registers a handler for an overlay", () => {
      const handler = () => true

      const unsubscribe = registerHandler("sessionPicker", handler)

      expect(hasHandler("sessionPicker")).toBe(true)

      // Cleanup
      unsubscribe()
    })

    test("unsubscribe removes the handler", () => {
      const handler = () => true

      const unsubscribe = registerHandler("sessionPicker", handler)
      expect(hasHandler("sessionPicker")).toBe(true)

      unsubscribe()

      expect(hasHandler("sessionPicker")).toBe(false)
    })

    test("can register multiple handlers for different overlays", () => {
      const handler1 = () => true
      const handler2 = () => true

      const unsub1 = registerHandler("sessionPicker", handler1)
      const unsub2 = registerHandler("aggregateView", handler2)

      expect(hasHandler("sessionPicker")).toBe(true)
      expect(hasHandler("aggregateView")).toBe(true)

      // Cleanup
      unsub1()
      unsub2()
    })
  })

  describe("routeKey", () => {
    test("routes key events to registered handlers", async () => {
      let receivedEvent: KeyEvent | null = null

      const handler = (e: KeyEvent) => {
        receivedEvent = e
        return true
      }

      const unsubscribe = registerHandler("sessionPicker", handler)

      const event: KeyEvent = { key: "a", ctrl: true }
      const result = await routeKey(event)

      expect(result.handled).toBe(true)
      expect(result.overlay).toBe("sessionPicker")
      expect(receivedEvent).toBeDefined()
      expect(receivedEvent!).toEqual(event)

      unsubscribe()
    })

    test("returns handled: false when no handlers registered", async () => {
      const event: KeyEvent = { key: "a" }
      const result = await routeKey(event)

      expect(result.handled).toBe(false)
      expect(result.overlay).toBe(null)
    })

    test("returns handled: false when handler returns false", async () => {
      const handler = () => false // Handler doesn't handle the event

      const unsubscribe = registerHandler("sessionPicker", handler)

      const event: KeyEvent = { key: "a" }
      const result = await routeKey(event)

      expect(result.handled).toBe(false)
      expect(result.overlay).toBe(null)

      unsubscribe()
    })

    test("respects priority order - confirmationDialog before sessionPicker", async () => {
      const calls: OverlayType[] = []

      const sessionHandler = () => {
        calls.push("sessionPicker")
        return false // Don't handle, let others try
      }
      const confirmHandler = () => {
        calls.push("confirmationDialog")
        return true // Handle it
      }

      // Register in reverse priority order
      const unsub1 = registerHandler("sessionPicker", sessionHandler)
      const unsub2 = registerHandler("confirmationDialog", confirmHandler)

      const result = await routeKey({ key: "a" })

      // confirmationDialog should be called first (higher priority)
      expect(calls[0]).toBe("confirmationDialog")
      expect(result.overlay).toBe("confirmationDialog")

      unsub1()
      unsub2()
    })

    test("falls through to lower priority handlers if higher doesn't handle", async () => {
      const calls: OverlayType[] = []

      const sessionHandler = () => {
        calls.push("sessionPicker")
        return true // Handle it
      }
      const confirmHandler = () => {
        calls.push("confirmationDialog")
        return false // Don't handle
      }

      const unsub1 = registerHandler("sessionPicker", sessionHandler)
      const unsub2 = registerHandler("confirmationDialog", confirmHandler)

      const result = await routeKey({ key: "a" })

      // Both should be called, but sessionPicker should handle
      expect(calls).toEqual(["confirmationDialog", "sessionPicker"])
      expect(result.overlay).toBe("sessionPicker")

      unsub1()
      unsub2()
    })
  })

  describe("getActiveOverlay", () => {
    test("returns null when no handlers registered", () => {
      const active = getActiveOverlay()
      expect(active).toBe(null)
    })

    test("returns highest priority overlay", () => {
      const unsub1 = registerHandler("sessionPicker", () => true)
      const unsub2 = registerHandler("aggregateView", () => true)

      // sessionPicker has higher priority than aggregateView
      const active = getActiveOverlay()
      expect(active).toBe("sessionPicker")

      unsub1()
      unsub2()
    })

    test("returns confirmationDialog when all are registered", () => {
      const unsub1 = registerHandler("aggregateView", () => true)
      const unsub2 = registerHandler("sessionPicker", () => true)
      const unsub3 = registerHandler("confirmationDialog", () => true)

      // confirmationDialog has highest priority
      const active = getActiveOverlay()
      expect(active).toBe("confirmationDialog")

      unsub1()
      unsub2()
      unsub3()
    })
  })

  describe("hasHandler", () => {
    test("returns false for unregistered overlays", () => {
      expect(hasHandler("sessionPicker")).toBe(false)
      expect(hasHandler("aggregateView")).toBe(false)
      expect(hasHandler("confirmationDialog")).toBe(false)
    })
  })
})
