/**
 * Disk-backed scrollback archive for terminal history.
 *
 * This file preserves the older import surface for callers that still import
 * `scrollback-archive`, while new code should prefer the modular `scrollback/`
 * entry points directly:
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
 */

// Re-export everything from the new modular scrollback module
export { ScrollbackArchive, ScrollbackArchiveManager } from './scrollback';

export type { ArchiveChunk, ArchiveMeta, DropChunkResult, ChunkLocation } from './scrollback/types';

export { PLACEMENT_SIZE, type ArchivePlacement } from './scrollback/placement';

// Additional re-exports for backward compatibility
export type { PlacementCacheEntry } from './scrollback/placement/manager';
