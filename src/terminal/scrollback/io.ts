/**
 * File I/O operations for scrollback archive.
 * Handles metadata persistence, chunk file operations, and cleanup.
 * Uses errore library for type-safe error handling.
 */

import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import * as errore from "errore"
import { ScrollbackArchiveError } from "../../effect/errors"
import type { ArchiveChunk, ArchiveMeta } from "./types"

/**
 * Ensures the archive directory exists.
 * @param rootDir - Directory to create
 */
export function ensureDir(rootDir: string): void {
  fs.mkdirSync(rootDir, { recursive: true })
}

/**
 * Loads archive metadata from disk.
 * Handles version checking and backward compatibility.
 * @param metaPath - Path to meta.json file
 * @returns ArchiveMeta if valid, null otherwise
 */
export function loadMeta(metaPath: string): ArchiveMeta | null {
  if (!fs.existsSync(metaPath)) return null

  let parsed: ArchiveMeta | null = null

  try {
    const data = fs.readFileSync(metaPath, "utf8")
    parsed = JSON.parse(data) as ArchiveMeta
  } catch {
    return null
  }

  if (!parsed || parsed.version !== 1) return null
  return parsed
}

/**
 * Saves archive metadata to disk.
 * @param metaPath - Path to meta.json file
 * @param meta - Metadata to save
 * @returns void on success, ScrollbackArchiveError on failure
 */
export async function flushMeta(
  metaPath: string,
  meta: ArchiveMeta
): Promise<void | ScrollbackArchiveError> {
  const result = await errore.tryAsync<void, ScrollbackArchiveError>({
    try: () => fsp.writeFile(metaPath, JSON.stringify(meta), "utf8"),
    catch: (e) =>
      new ScrollbackArchiveError({
        operation: "write",
        reason: String(e),
        cause: e,
      }),
  })
  return result
}

/**
 * Appends data to a chunk file.
 * @param chunkPath - Path to chunk file
 * @param data - Data to append
 * @returns void on success, ScrollbackArchiveError on failure
 */
export async function appendChunkData(
  chunkPath: string,
  data: Buffer
): Promise<void | ScrollbackArchiveError> {
  const result = await errore.tryAsync<void, ScrollbackArchiveError>({
    try: () => fsp.appendFile(chunkPath, data),
    catch: (e) =>
      new ScrollbackArchiveError({
        operation: "write",
        reason: String(e),
        cause: e,
      }),
  })
  return result
}

/**
 * Deletes a chunk file (both cell data and placement data).
 * @param chunk - Chunk to delete
 * @returns void on success, errors are logged but not thrown
 */
export async function deleteChunkFiles(chunk: ArchiveChunk): Promise<void> {
  // Delete cell data file
  const cellResult = await errore.tryAsync<void, ScrollbackArchiveError>({
    try: () => fsp.unlink(chunk.path),
    catch: (e) =>
      new ScrollbackArchiveError({
        operation: "delete",
        reason: String(e),
        cause: e,
      }),
  })

  if (cellResult instanceof ScrollbackArchiveError) {
    // Continue to try deleting placement file
  }

  // Delete placement data file if it exists
  if (chunk.placementPath) {
    const placementResult = await errore.tryAsync<void, ScrollbackArchiveError>({
      try: () => fsp.unlink(chunk.placementPath!),
      catch: (e) =>
        new ScrollbackArchiveError({
          operation: "delete",
          reason: String(e),
          cause: e,
        }),
    })
    if (placementResult instanceof ScrollbackArchiveError) {
      // Ignore errors for placement file - it may not exist
    }
  }
}

/**
 * Reads placement data from a chunk file synchronously.
 * @param chunk - Chunk containing placement data
 * @returns Buffer with placement data, or null if not found/error
 */
export function readPlacementBuffer(chunk: ArchiveChunk): Buffer | null {
  if (!chunk.placementPath || !chunk.placementBytes || chunk.placementBytes === 0) {
    return null
  }

  try {
    return fs.readFileSync(chunk.placementPath)
  } catch {
    return null
  }
}

/**
 * Appends placement data to a chunk's placement file.
 * @param chunk - Chunk to append to
 * @param data - Placement data buffer
 * @returns void on success, ScrollbackArchiveError on failure
 */
export async function appendPlacementData(
  chunk: ArchiveChunk,
  data: Buffer
): Promise<void | ScrollbackArchiveError> {
  // Ensure placement file is set up for this chunk
  if (!chunk.placementPath) {
    chunk.placementFilename = `chunk-${chunk.id}-placements.bin`
    chunk.placementPath = path.join(path.dirname(chunk.path), chunk.placementFilename)
    chunk.placementBytes = 0
  }

  const result = await errore.tryAsync<void, ScrollbackArchiveError>({
    try: () => fsp.appendFile(chunk.placementPath!, data),
    catch: (e) =>
      new ScrollbackArchiveError({
        operation: "write",
        reason: String(e),
        cause: e,
      }),
  })

  return result
}

/**
 * Builds ArchiveChunk objects from metadata entries.
 * Validates chunk files exist and handles backward compatibility.
 * @param rootDir - Root directory for chunks
 * @param entries - Metadata entries
 * @returns Array of valid ArchiveChunks
 */
export function buildChunksFromMeta(
  rootDir: string,
  entries: ArchiveMeta["chunks"]
): ArchiveChunk[] {
  const chunks: ArchiveChunk[] = []
  let currentStartOffset = 0

  for (const entry of entries) {
    const chunkPath = path.join(rootDir, entry.filename)
    if (!fs.existsSync(chunkPath)) continue

    const chunk: ArchiveChunk = {
      id: entry.id,
      filename: entry.filename,
      path: chunkPath,
      cols: entry.cols,
      rowBytes: entry.rowBytes,
      lineCount: entry.lineCount,
      bytes: entry.bytes,
      createdAt: entry.createdAt,
      // Backward compatibility: older archives won't have this field
      startOffsetAtWrite: entry.startOffsetAtWrite ?? currentStartOffset,
      // Backward compatibility: placement fields may be undefined in older archives
      placementFilename: entry.placementFilename,
      placementPath: entry.placementFilename
        ? path.join(rootDir, entry.placementFilename)
        : undefined,
      placementBytes: entry.placementBytes ?? 0,
    }
    chunks.push(chunk)
    currentStartOffset += chunk.lineCount
  }

  return chunks
}

/**
 * Gets the next chunk ID based on existing chunks.
 * @param currentNextId - Current nextChunkId from metadata
 * @param chunks - Existing chunks
 * @returns Next chunk ID to use
 */
export function calculateNextChunkId(
  currentNextId: number,
  chunks: readonly ArchiveChunk[]
): number {
  if (chunks.length === 0) return currentNextId
  const maxId = Math.max(...chunks.map((chunk) => chunk.id))
  return Math.max(currentNextId, maxId + 1)
}
