/**
 * Type definitions for scrollback archive.
 * Defines the core data structures for chunk storage and metadata.
 */

/**
 * Represents a single chunk of archived terminal data.
 * Each chunk stores cell data for a number of terminal lines.
 */
export type ArchiveChunk = {
  /** Unique chunk identifier */
  id: number;
  /** Filename for cell data */
  filename: string;
  /** Full path to cell data file */
  path: string;
  /** Number of columns in each row */
  cols: number;
  /** Bytes per row (4 bytes count + cells) */
  rowBytes: number;
  /** Number of lines stored in this chunk */
  lineCount: number;
  /** Total bytes stored in this chunk */
  bytes: number;
  /** Unix timestamp when chunk was created */
  createdAt: number;
  /** Archive-relative start offset when this chunk was first created */
  startOffsetAtWrite: number;
  /** Reference to placement data file (undefined for backward compatibility) */
  placementFilename?: string;
  /** Full path to placement data file */
  placementPath?: string;
  /** Total bytes in placement file */
  placementBytes?: number;
};

/**
 * Metadata structure stored in meta.json for archive recovery.
 * Versioned for backward compatibility.
 */
export type ArchiveMeta = {
  /** Format version (currently 1) */
  version: number;
  /** Next chunk ID to use for new chunks */
  nextChunkId: number;
  /** Array of chunk metadata entries */
  chunks: Array<{
    id: number;
    filename: string;
    cols: number;
    rowBytes: number;
    lineCount: number;
    bytes: number;
    createdAt: number;
    /** Archive-relative start offset (undefined for backward compatibility) */
    startOffsetAtWrite?: number;
    /** Placement chunk reference (undefined for backward compatibility) */
    placementFilename?: string;
    placementBytes?: number;
  }>;
};

/**
 * Result type for dropping the oldest chunk.
 */
export type DropChunkResult = {
  /** Number of lines removed */
  linesRemoved: number;
  /** Number of bytes removed */
  bytesRemoved: number;
};

/**
 * Result type for finding a chunk containing a specific line offset.
 */
export type ChunkLocation = {
  /** The chunk containing the line */
  chunk: ArchiveChunk;
  /** Start offset of the chunk in the archive */
  chunkStart: number;
  /** Index within the chunk */
  index: number;
};
