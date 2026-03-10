/**
 * Placement management for Kitty graphics in scrollback archive.
 * Handles storage, retrieval, and coordinate rebasing of archived placements.
 */

import {
  packPlacements as packPlacementsToArrayBuffer,
  unpackPlacements as unpackPlacementsFromArrayBuffer,
  type ArchivePlacement,
} from "../../kitty-graphics/archive-placement"
import type { ArchiveChunk } from "../types"
import { readPlacementBuffer, appendPlacementData } from "../io"

/**
 * Cache entry for placement chunk data.
 */
export type PlacementCacheEntry = {
  /** Size of cached placement data */
  placementBytes: number
  /** Cached placements */
  placements: ArchivePlacement[]
}

/**
 * Converts an ArrayBuffer to a Node.js Buffer.
 * @param arrayBuffer - ArrayBuffer to convert
 * @returns Node.js Buffer
 */
function toBuffer(arrayBuffer: ArrayBuffer): Buffer {
  return Buffer.from(arrayBuffer)
}

/**
 * Converts a Node.js Buffer to an ArrayBuffer.
 * @param buffer - Node.js Buffer to convert
 * @returns ArrayBuffer view
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
}

/**
 * Packs an array of ArchivePlacements into a Buffer for file storage.
 * @param placements - Array of placements to pack
 * @returns Buffer containing packed placements
 */
export function packPlacements(placements: ArchivePlacement[]): Buffer {
  const arrayBuffer = packPlacementsToArrayBuffer(placements)
  return toBuffer(arrayBuffer)
}

/**
 * Unpacks ArchivePlacements from a Buffer read from file.
 * @param buffer - Buffer containing packed placements
 * @returns Array of ArchivePlacements
 */
export function unpackPlacements(buffer: Buffer): ArchivePlacement[] {
  const arrayBuffer = toArrayBuffer(buffer)
  return unpackPlacementsFromArrayBuffer(arrayBuffer)
}

/**
 * Reads placements from a chunk, using cache if available.
 * @param chunk - Chunk containing placement data
 * @param cache - Optional cache map for storing/retrieving cached data
 * @returns Array of ArchivePlacements, empty array if none/error
 */
export function readPlacementsFromChunk(
  chunk: ArchiveChunk,
  cache?: Map<number, PlacementCacheEntry>
): ArchivePlacement[] {
  if (!chunk.placementPath || !chunk.placementBytes || chunk.placementBytes === 0) {
    return []
  }

  // Check cache first
  if (cache) {
    const cached = cache.get(chunk.id)
    if (cached && cached.placementBytes === chunk.placementBytes) {
      return cached.placements
    }
  }

  // Read from disk
  const buffer = readPlacementBuffer(chunk)
  if (!buffer) {
    if (cache) cache.delete(chunk.id)
    return []
  }

  const placements = unpackPlacements(buffer)

  // Update cache
  if (cache) {
    cache.set(chunk.id, {
      placementBytes: chunk.placementBytes,
      placements,
    })
  }

  return placements
}

/**
 * Rebase a placement offset from stored coordinates to current archive coordinates.
 * When oldest chunks are dropped, remaining chunk starts shift downward.
 * This function adjusts the stored offset to the current archive space.
 * @param chunk - Chunk containing the placement
 * @param currentChunkStart - Current start offset of the chunk in the archive
 * @param storedOffset - Offset stored in the placement (archive-relative at write time)
 * @returns Rebased offset in current archive coordinates
 */
export function rebasePlacementOffset(
  chunk: ArchiveChunk,
  currentChunkStart: number,
  storedOffset: number
): number {
  // Stored offsets are archive-relative to the chunk's original write position.
  // After oldest chunks are dropped, remaining chunk starts shift downward.
  // Rebase into the current archive coordinate space.
  const delta = chunk.startOffsetAtWrite - currentChunkStart
  return storedOffset - delta
}

/**
 * Gets all placements within a line range from multiple chunks.
 * @param chunks - All chunks in the archive
 * @param totalLines - Total number of lines in the archive
 * @param startOffset - Start line offset (inclusive, 0 = oldest line)
 * @param endOffset - End line offset (exclusive)
 * @param cache - Optional cache map for chunk placement data
 * @returns Array of ArchivePlacement within the range
 */
export function getPlacementsForLineRange(
  chunks: readonly ArchiveChunk[],
  totalLines: number,
  startOffset: number,
  endOffset: number,
  cache?: Map<number, PlacementCacheEntry>
): ArchivePlacement[] {
  // Normalize range
  if (startOffset < 0) startOffset = 0
  if (endOffset > totalLines) endOffset = totalLines
  if (startOffset >= endOffset) return []

  const placements: ArchivePlacement[] = []

  // Find which chunks overlap with the requested range
  let chunkStart = 0
  for (const chunk of chunks) {
    const chunkEnd = chunkStart + chunk.lineCount

    // Check if this chunk overlaps with the requested range
    if (chunkEnd > startOffset && chunkStart < endOffset) {
      // This chunk has relevant lines, check for placement data
      if (chunk.placementPath && chunk.placementBytes && chunk.placementBytes > 0) {
        const chunkPlacements = readPlacementsFromChunk(chunk, cache)
        // Rebase chunk placements into the current archive coordinate space
        for (const placement of chunkPlacements) {
          const rebasedOffset = rebasePlacementOffset(
            chunk,
            chunkStart,
            placement.archiveOffset
          )
          if (rebasedOffset < startOffset || rebasedOffset >= endOffset) continue
          if (rebasedOffset < 0 || rebasedOffset >= totalLines) continue
          placements.push({
            ...placement,
            archiveOffset: rebasedOffset,
          })
        }
      }
    }

    chunkStart = chunkEnd
    if (chunkStart >= endOffset) break
  }

  return placements
}

/**
 * Appends placements to a chunk file.
 * @param chunk - Chunk to append to
 * @param placements - Array of placements to store
 * @param cache - Optional cache to invalidate
 * @returns void on success, error on failure
 */
export async function appendPlacementsToChunk(
  chunk: ArchiveChunk,
  placements: ArchivePlacement[],
  cache?: Map<number, PlacementCacheEntry>
): Promise<void> {
  if (placements.length === 0) return

  const packed = packPlacements(placements)
  const result = await appendPlacementData(chunk, packed)

  if (result instanceof Error) {
    // Error occurred, don't update metadata
    return
  }

  // Update chunk metadata
  chunk.placementBytes = (chunk.placementBytes ?? 0) + packed.byteLength

  // Invalidate cache for this chunk
  if (cache) {
    cache.delete(chunk.id)
  }
}

/**
 * Sets up placement file path for a chunk.
 * @param chunk - Chunk to set up
 * @param rootDir - Root directory for archive
 */
export function setupPlacementPath(chunk: ArchiveChunk, rootDir: string): void {
  if (!chunk.placementPath) {
    chunk.placementFilename = `chunk-${chunk.id}-placements.bin`
    chunk.placementPath = `${rootDir}/${chunk.placementFilename}`
    chunk.placementBytes = 0
  }
}
