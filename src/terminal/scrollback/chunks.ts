/**
 * Chunk management for scrollback archive.
 * Handles chunk creation, finding, and reading operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { unpackRow, CELL_SIZE } from '../cell-serialization';
import type { TerminalCell } from '../../core/types';
import type { ScrollbackCache } from '../emulator-utils/scrollback-cache';
import type { ArchiveChunk, ChunkLocation } from './types';
import * as errore from 'errore';
import { ChunkParseError } from '../../effect/errors';

/**
 * Creates a new chunk with the given dimensions.
 * @param rootDir - Root directory for chunk storage
 * @param nextChunkId - Next available chunk ID
 * @param totalLines - Current total lines (for startOffsetAtWrite)
 * @param cols - Number of columns per row
 * @param rowBytes - Bytes per row
 * @returns New ArchiveChunk ready for data
 */
export function createChunk(
  rootDir: string,
  nextChunkId: number,
  totalLines: number,
  cols: number,
  rowBytes: number
): ArchiveChunk {
  const id = nextChunkId;
  const filename = `chunk-${id}.bin`;
  return {
    id,
    filename,
    path: path.join(rootDir, filename),
    cols,
    rowBytes,
    lineCount: 0,
    bytes: 0,
    createdAt: Date.now(),
    startOffsetAtWrite: totalLines,
  };
}

/**
 * Finds the chunk containing a specific line offset.
 * @param chunks - Array of chunks to search
 * @param offset - Line offset to find (0 = oldest line)
 * @returns ChunkLocation if found, null otherwise
 */
export function findChunk(chunks: readonly ArchiveChunk[], offset: number): ChunkLocation | null {
  if (offset < 0) return null;
  let start = 0;
  for (const chunk of chunks) {
    const end = start + chunk.lineCount;
    if (offset < end) {
      return { chunk, chunkStart: start, index: offset - start };
    }
    start = end;
  }
  return null;
}

/**
 * Reads a single row from a chunk.
 * @param chunk - Chunk to read from
 * @param chunkStart - Start offset of the chunk in the archive
 * @param index - Index within the chunk
 * @param cache - Optional cache to store the result
 * @returns Array of TerminalCell, or null if read fails
 */
export function readRow(
  chunk: ArchiveChunk,
  chunkStart: number,
  index: number,
  cache?: ScrollbackCache
): TerminalCell[] | null {
  const rows = readChunkRange(chunk, chunkStart, index, 1, cache);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Reads a range of rows from a chunk.
 * Efficiently reads multiple rows in a single file operation.
 * @param chunk - Chunk to read from
 * @param chunkStart - Start offset of the chunk in the archive
 * @param index - Starting index within the chunk
 * @param count - Number of rows to read
 * @param cache - Optional cache to store results
 * @returns Array of rows (each row is TerminalCell[])
 */
export function readChunkRange(
  chunk: ArchiveChunk,
  chunkStart: number,
  index: number,
  count: number,
  cache?: ScrollbackCache
): TerminalCell[][] {
  const maxCount = Math.min(count, chunk.lineCount - index);
  if (maxCount <= 0) return [];

  const rowBytes = chunk.rowBytes;
  const totalBytes = rowBytes * maxCount;
  const buffer = Buffer.alloc(totalBytes);
  const offsetBytes = rowBytes * index;

  let bytesRead = 0;
  let fd: number | null = null;

  const readResult = errore.try<number | null, ChunkParseError>({
    try: () => {
      fd = fs.openSync(chunk.path, 'r');
      return fs.readSync(fd, buffer, 0, totalBytes, offsetBytes);
    },
    catch: (cause: unknown) =>
      new ChunkParseError({
        operation: 'read-chunk',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {
      // Ignore close errors
    }
  }
  if (readResult instanceof ChunkParseError) {
    return [];
  }
  if (readResult === null) {
    return [];
  }
  bytesRead = readResult;

  if (bytesRead < rowBytes) return [];

  const rows: TerminalCell[][] = [];
  const totalRows = Math.floor(bytesRead / rowBytes);
  for (let i = 0; i < totalRows; i++) {
    const slice = buffer.subarray(i * rowBytes, (i + 1) * rowBytes);
    const row = unpackRow(toArrayBuffer(slice));
    rows.push(row);
    if (cache) {
      const absoluteOffset = chunkStart + index + i;
      cache.set(absoluteOffset, row);
    }
  }

  return rows;
}

/**
 * Calculates the row bytes for a given number of columns.
 * @param cols - Number of columns
 * @returns Bytes per row (4 bytes count + cells)
 */
export function calculateRowBytes(cols: number): number {
  return 4 + cols * CELL_SIZE;
}

/**
 * Checks if a new chunk should be created for the given line.
 * @param currentChunk - Current chunk (null if none)
 * @param cols - Number of columns in the line
 * @param chunkMaxLines - Maximum lines per chunk
 * @returns true if a new chunk should be created
 */
export function shouldCreateNewChunk(
  currentChunk: ArchiveChunk | null,
  cols: number,
  chunkMaxLines: number
): boolean {
  if (!currentChunk) return true;
  if (currentChunk.cols !== cols) return true;
  if (currentChunk.lineCount >= chunkMaxLines) return true;
  return false;
}

/**
 * Converts a Node.js Buffer to an ArrayBuffer.
 * @param buffer - Node.js Buffer to convert
 * @returns ArrayBuffer view of the buffer data
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}
