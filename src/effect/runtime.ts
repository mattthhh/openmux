/**
 * Stub runtime module for backward compatibility
 * Replaces the old Effect runtime with a simple passthrough
 */

import { disposeServicesSingleton } from "./bridge/services-instance"

/**
 * Dispose the application runtime.
 * 
 * Cleans up all services and resources. Call this on application shutdown
 * to prevent memory leaks from timers, caches, and file watchers.
 */
export function disposeRuntime(): Promise<void> {
  disposeServicesSingleton()
  return Promise.resolve()
}

/**
 * Check if the runtime is initialized.
 * 
 * In the errore architecture, this always returns true since services
 * are initialized directly without a managed runtime.
 */
export function isRuntimeInitialized(): boolean {
  return true
}

/**
 * Run a function with the runtime (backward compatibility stub).
 * 
 * @deprecated Use services directly instead
 */
export async function runWithRuntime<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}

/**
 * Run an Effect - stub that just throws as Effect is no longer used
 * @deprecated Use errore services directly
 */
export function runEffect<T>(_effect: unknown): Promise<T> {
  console.warn("Effect runtime is deprecated, use errore services directly")
  return Promise.reject(new Error("Effect runtime no longer available. Use errore services."))
}
