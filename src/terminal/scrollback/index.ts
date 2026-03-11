/**
 * Scrollback Archive Module
 * Disk-backed scrollback storage for terminal history.
 * 
 * This module provides chunked storage of terminal lines with efficient
 * read/write operations and Kitty graphics placement support.
 * 
 * @example
 * ```typescript
 * import { ScrollbackArchive, ScrollbackArchiveManager } from './scrollback';
 * 
 * const manager = new ScrollbackArchiveManager(200 * 1024 * 1024); // 200MB global limit
 * const archive = new ScrollbackArchive({
 *   rootDir: '/tmp/scrollback/pty-1',
 *   maxBytes: 50 * 1024 * 1024, // 50MB per PTY
 *   manager,
 * });
 * 
 * // Append lines
 * await archive.appendLines([line1, line2]);
 * 
 * // Read line
 * const line = archive.getLine(0);
 * ```
 */

// Main classes
export { ScrollbackArchive } from "./archive"
export { ScrollbackArchiveManager } from "./manager"

// Types
export type {
  ArchiveChunk,
  ArchiveMeta,
  DropChunkResult,
  ChunkLocation,
} from "./types"

// Placement module
export {
  PLACEMENT_SIZE,
  packPlacement,
  unpackPlacement,
  packPlacements,
  unpackPlacements,
  toArchivePlacement,
  type ArchivePlacement,
  PlacementSerializeError,
} from "./placement"

// Chunk operations (for advanced use)
export {
  createChunk,
  findChunk,
  readRow,
  readChunkRange,
  calculateRowBytes,
  shouldCreateNewChunk,
} from "./chunks"

// I/O operations (for advanced use)
export {
  ensureDir,
  loadMeta,
  flushMeta,
  appendChunkData,
  deleteChunkFiles,
  readPlacementBuffer,
  appendPlacementData,
  buildChunksFromMeta,
  calculateNextChunkId,
} from "./io"

// Placement manager operations (for advanced use)
export {
  readPlacementsFromChunk,
  rebasePlacementOffset,
  getPlacementsForLineRange as getPlacementsForRange,
  appendPlacementsToChunk,
  setupPlacementPath,
  type PlacementCacheEntry,
} from "./placement/manager"
