/**
 * Aggregate view bridge functions (errore version)
 * Provides PTY listing with metadata for aggregate view
 * 
 * Directly uses PtyService interface without Effect runtime.
 * Backward-compatible versions use the global services singleton.
 * 
 * @deprecated This file is kept for backward compatibility.
 * Please import from src/effect/bridge/aggregate/ directly.
 */

// Re-export all public APIs from the modular aggregate package
export * from "./aggregate"

// Also export from submodules for granular imports
export * as types from "./aggregate/types"
export * as cache from "./aggregate/cache/session-pty-cache"
export * as metadata from "./aggregate/metadata/fetch"
export * as sessions from "./aggregate/sessions/list"
export * as lazyLoad from "./aggregate/sessions/lazy-load"
export * as tree from "./aggregate/tree/build"
export * as api from "./aggregate/api/backward-compat"
