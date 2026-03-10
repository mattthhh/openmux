/**
 * Disk-backed scrollback archive for terminal history.
 *
 * @deprecated This file is a backward-compatible shim.
 * Import from `scrollback/` module for the new modular API:
 *
 * ```typescript
 * import {
 *   ScrollbackArchive,
 *   ScrollbackArchiveManager,
 *   type ArchiveChunk,
 *   type ArchiveMeta,
 *   type ArchivePlacement,
 * } from './scrollback'
 * ```
 *
 * This shim will be removed in a future version.
 */

// Re-export everything from the new modular scrollback module
export {
  ScrollbackArchive,
  ScrollbackArchiveManager,
} from "./scrollback"

export type {
  ArchiveChunk,
  ArchiveMeta,
  DropChunkResult,
  ChunkLocation,
} from "./scrollback/types"

export {
  PLACEMENT_SIZE,
  type ArchivePlacement,
} from "./scrollback/placement"

// Additional re-exports for backward compatibility
export type { PlacementCacheEntry } from "./scrollback/placement/manager"
