/**
 * Tests for SubscriptionRegistry
 * Verifies errore-based subscription management with synchronous cleanup
 */
import { describe, test, expect, vi } from "bun:test"
import {
  createSubscriptionRegistry,
  makeSubscriptionId,
} from '../../../src/effect/services/pty/subscription-manager'

describe('SubscriptionRegistry', () => {
  describe('makeSubscriptionId', () => {
    test('should generate unique subscription IDs', () => {
      const id1 = makeSubscriptionId()
      const id2 = makeSubscriptionId()
      const id3 = makeSubscriptionId()

      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })

    test('should generate IDs with expected format', () => {
      const id = makeSubscriptionId()

      expect(id).toMatch(/^sub_\d+_[a-z0-9]+$/)
    })
  })

  describe('subscribe', () => {
    test('should add subscriber and call callback on notify', () => {
      const callback = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      registry.subscribe(callback)
      registry.notify('test message')

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('test message')
    })

    test('should return cleanup function that removes subscriber', () => {
      const callback = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      const cleanup = registry.subscribe(callback)
      cleanup()

      registry.notify('after cleanup')

      expect(callback).not.toHaveBeenCalled()
    })

    test('should handle multiple subscribers', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const callback3 = vi.fn()
      const registry = createSubscriptionRegistry<number>()

      registry.subscribe(callback1)
      registry.subscribe(callback2)
      registry.subscribe(callback3)

      registry.notify(42)

      expect(callback1).toHaveBeenCalledWith(42)
      expect(callback2).toHaveBeenCalledWith(42)
      expect(callback3).toHaveBeenCalledWith(42)
    })

    test('should only remove the specific subscriber on cleanup', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      const cleanup1 = registry.subscribe(callback1)
      registry.subscribe(callback2)

      cleanup1()
      registry.notify('message')

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith('message')
    })
  })

  describe('notify', () => {
    test('should call all subscribers with the value', () => {
      const values: number[] = []
      const registry = createSubscriptionRegistry<number>()

      registry.subscribe((v) => values.push(v * 1))
      registry.subscribe((v) => values.push(v * 2))
      registry.subscribe((v) => values.push(v * 3))

      registry.notify(10)

      expect(values).toContain(10)
      expect(values).toContain(20)
      expect(values).toContain(30)
    })

    test('should continue notifying other subscribers if one throws', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callback1 = vi.fn()
      const callback2 = vi.fn().mockImplementation(() => {
        throw new Error('Test error')
      })
      const callback3 = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      registry.subscribe(callback1)
      registry.subscribe(callback2)
      registry.subscribe(callback3)

      // Should not throw
      registry.notify('test')

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()
      expect(callback3).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('Subscription callback error:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    test('should handle synchronous notifications', () => {
      const callback = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      registry.subscribe(callback)
      registry.notifySync('sync message')

      expect(callback).toHaveBeenCalledWith('sync message')
    })
  })

  describe('getSubscriberCount', () => {
    test('should return 0 for empty registry', () => {
      const registry = createSubscriptionRegistry<string>()

      expect(registry.getSubscriberCount()).toBe(0)
    })

    test('should return correct count after subscriptions', () => {
      const registry = createSubscriptionRegistry<string>()

      const cleanup1 = registry.subscribe(vi.fn())
      const cleanup2 = registry.subscribe(vi.fn())

      expect(registry.getSubscriberCount()).toBe(2)

      cleanup1()
      expect(registry.getSubscriberCount()).toBe(1)

      cleanup2()
      expect(registry.getSubscriberCount()).toBe(0)
    })
  })

  describe('edge cases', () => {
    test('should handle rapid subscribe/unsubscribe cycles', () => {
      const registry = createSubscriptionRegistry<number>()
      const callback = vi.fn()

      for (let i = 0; i < 100; i++) {
        const cleanup = registry.subscribe(callback)
        cleanup()
      }

      registry.notify(42)
      expect(callback).not.toHaveBeenCalled()
    })

    test('should handle cleanup called multiple times', () => {
      const callback = vi.fn()
      const registry = createSubscriptionRegistry<string>()

      const cleanup = registry.subscribe(callback)
      cleanup()
      cleanup() // Should not throw
      cleanup() // Should not throw

      registry.notify('test')
      expect(callback).not.toHaveBeenCalled()
    })

    test('should handle notify with no subscribers', () => {
      const registry = createSubscriptionRegistry<string>()

      // Should not throw
      expect(() => registry.notify('test')).not.toThrow()
      expect(() => registry.notifySync('test')).not.toThrow()
    })
  })
})
