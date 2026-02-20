/**
 * Subscription management utilities for PTY service (errore version).
 * Provides subscription tracking with synchronous cleanup support.
 *
 * Uses a mutable Map as the source of truth for subscriptions. This enables:
 * - Synchronous cleanup (required for SolidJS onCleanup)
 * - Synchronous notifications (for non-Effect contexts)
 */

/** Branded subscription ID for type safety */
export type SubscriptionId = string & { readonly _tag: "SubscriptionId" }

export const makeSubscriptionId = (): SubscriptionId =>
  `sub_${Date.now()}_${Math.random().toString(36).slice(2)}` as SubscriptionId

export interface Subscription<T> {
  readonly id: SubscriptionId
  readonly callback: (value: T) => void
  readonly createdAt: number
}

export interface SubscriptionRegistry<T> {
  subscribe: (callback: (value: T) => void) => (() => void)
  notify: (value: T) => void
  notifySync: (value: T) => void
  getSubscriberCount: () => number
}

/**
 * Create a subscription registry for a specific event type.
 *
 * Provides:
 * - `subscribe`: Returns manual cleanup function (for SolidJS bridge)
 * - `notify`/`notifySync`: Event broadcasting
 */
export function createSubscriptionRegistry<T>(): SubscriptionRegistry<T> {
  // Mutable map as source of truth - enables synchronous operations
  const subscriptions = new Map<SubscriptionId, Subscription<T>>()

  /**
   * Subscribe with manual cleanup function.
   * Use this for bridging to non-Effect code (e.g., SolidJS).
   * The returned cleanup function is synchronous.
   */
  const subscribe = (callback: (value: T) => void): (() => void) => {
    const id = makeSubscriptionId()
    const sub: Subscription<T> = {
      id,
      callback,
      createdAt: Date.now(),
    }
    subscriptions.set(id, sub)

    // Return SYNCHRONOUS cleanup function (for SolidJS onCleanup)
    return () => {
      subscriptions.delete(id)
    }
  }

  /**
   * Notify all subscribers asynchronously (errors logged but don't affect others).
   */
  const notify = (value: T): void => {
    for (const sub of subscriptions.values()) {
      try {
        sub.callback(value)
      } catch (error) {
        console.warn("Subscription callback error:", error)
      }
    }
  }

  /**
   * Notify all subscribers synchronously (for non-Effect contexts).
   * Use this when called from plain JavaScript callbacks (e.g., emulator events).
   */
  const notifySync = (value: T): void => {
    for (const sub of subscriptions.values()) {
      try {
        sub.callback(value)
      } catch (error) {
        console.warn("Subscription callback error:", error)
      }
    }
  }

  /**
   * Get current subscriber count (for debugging/monitoring).
   */
  const getSubscriberCount = (): number => subscriptions.size

  return {
    subscribe,
    notify,
    notifySync,
    getSubscriberCount,
  }
}
