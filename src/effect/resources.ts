/**
 * Resource cleanup utilities using AsyncDisposableStack
 * 
 * Provides consistent patterns for resource management across the codebase.
 * Uses errore's AsyncDisposableStack for guaranteed cleanup on all exit paths.
 * 
 * @example
 * ```typescript
 * async function fetchWithTimeout(): Promise<Data | Error> {
 *   await using resources = new ResourceStack()
 *   
 *   const controller = new AbortController()
 *   resources.defer(() => controller.abort())
 *   
 *   const conn = await connect()
 *   resources.defer(() => conn.close())
 *   
 *   return await fetchData(conn)
 * }
 * ```
 */

import { AsyncDisposableStack } from "errore"

export { AsyncDisposableStack } from "errore"

/**
 * Resource stack with typed error handling.
 * Wraps AsyncDisposableStack with our error patterns.
 */
export class ResourceStack extends AsyncDisposableStack {
  /**
   * Defer cleanup with error logging on failure.
   * Unlike defer(), cleanup errors are logged but don't stop other cleanups.
   */
  deferSafe(cleanup: () => void | Promise<void>): void {
    this.defer(async () => {
      try {
        await cleanup()
      } catch (error) {
        console.warn("Resource cleanup failed:", error)
      }
    })
  }

  /**
   * Add multiple cleanup functions at once.
   * Cleanups run in reverse order (LIFO).
   */
  deferAll(...cleanups: Array<() => void | Promise<void>>): void {
    for (const cleanup of cleanups) {
      this.defer(cleanup)
    }
  }

  /**
   * Register a timer for automatic cleanup.
   * Returns the timer handle for your use.
   */
  registerTimer(timer: ReturnType<typeof setTimeout>): void {
    this.defer(() => clearTimeout(timer))
  }

  /**
   * Register an interval for automatic cleanup.
   */
  registerInterval(interval: ReturnType<typeof setInterval>): void {
    this.defer(() => clearInterval(interval))
  }

  /**
   * Register an AbortController for automatic abort on cleanup.
   */
  registerAbortController(controller: AbortController): void {
    this.defer(() => controller.abort())
  }

  /**
   * Register an event listener with automatic removal.
   * @param emitter - Event emitter (implements on/off or add/remove listener)
   * @param event - Event name
   * @param handler - Event handler
   */
  registerEventListener<
    T extends { on?: (event: string, handler: (...args: unknown[]) => void) => void; off?: (event: string, handler: (...args: unknown[]) => void) => void }
  >(
    emitter: T,
    event: string,
    handler: (...args: unknown[]) => void
  ): void {
    if (emitter.on) {
      emitter.on(event, handler)
      this.defer(() => emitter.off?.(event, handler))
    }
  }

  /**
   * Register a disposable resource with async dispose.
   */
  registerDisposable<T extends AsyncDisposable>(resource: T): T {
    this.defer(async () => {
      await resource[Symbol.asyncDispose]()
    })
    return resource
  }

  /**
   * Register a subscription with unsubscribe function.
   */
  registerSubscription(unsubscribe: () => void): void {
    this.defer(unsubscribe)
  }
}

/**
 * Helper to check if an error is an AbortError (from AbortController).
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError"
}

/**
 * Helper to create a cleanup function that only runs once.
 */
export function once(cleanup: () => void): () => void {
  let ran = false
  return () => {
    if (ran) return
    ran = true
    cleanup()
  }
}

/**
 * Type guard for disposable resources.
 */
export function isDisposable<T>(value: T): value is T & Disposable {
  return value !== null && 
         typeof value === "object" && 
         Symbol.dispose in value &&
         typeof (value as unknown as Disposable)[Symbol.dispose] === "function"
}

/**
 * Type guard for async disposable resources.
 */
export function isAsyncDisposable<T>(value: T): value is T & AsyncDisposable {
  return value !== null && 
         typeof value === "object" && 
         Symbol.asyncDispose in value &&
         typeof (value as unknown as AsyncDisposable)[Symbol.asyncDispose] === "function"
}
