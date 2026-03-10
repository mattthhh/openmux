/**
 * ScrollbackArchive - Disk-backed scrollback storage for terminal history.
 * Clean public API for managing archived terminal lines and Kitty graphics placements.
 */

import path from "node:path"
import type { TerminalCell } from "../../core/types"
import { ScrollbackCache } from "../emulator-utils/scrollback-cache"
import {
  SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES,
  SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY,
} from "../scrollback-config"
import { packRow } from "../cell-serialization"
import type { ArchivePlacement } from "./placement"
import type { ArchiveChunk, ArchiveMeta, DropChunkResult } from "./types"
import { createChunk, findChunk, readRow, readChunkRange, shouldCreateNewChunk } from "./chunks"
import {
  ensureDir,
  loadMeta,
  flushMeta,
  appendChunkData,
  deleteChunkFiles,
  buildChunksFromMeta,
  calculateNextChunkId,
} from "./io"
import {
  getPlacementsForLineRange,
  appendPlacementsToChunk,
  setupPlacementPath,
  type PlacementCacheEntry,
} from "./placement/manager"
import type { ScrollbackArchiveManager } from "./manager"

/**
 * Disk-backed scrollback archive for terminal history.
 * Manages chunked storage of terminal lines with efficient read/write operations.
 */
export class ScrollbackArchive {
  private readonly rootDir: string
  private readonly metaPath: string
  private readonly maxBytes: number
  private readonly chunkMaxLines: number
  private readonly cache: ScrollbackCache
  private readonly manager?: ScrollbackArchiveManager
  private readonly placementChunkCache = new Map<number, PlacementCacheEntry>()
  private chunks: ArchiveChunk[] = []
  private totalLines = 0
  private totalBytes = 0
  private nextChunkId = 1
  private appendQueue: Promise<void> = Promise.resolve()
  private generation = 0
  private revision = 0

  constructor(options: {
    rootDir: string
    maxBytes?: number
    chunkMaxLines?: number
    cacheSize?: number
    manager?: ScrollbackArchiveManager
  }) {
    this.rootDir = options.rootDir
    this.metaPath = path.join(this.rootDir, "meta.json")
    this.maxBytes = options.maxBytes ?? SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY
    this.chunkMaxLines = options.chunkMaxLines ?? SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES
    this.cache = new ScrollbackCache(options.cacheSize ?? 4000)
    this.manager = options.manager

    this.ensureDir()
    this.loadMeta()
    this.manager?.register(this)
    this.enforceLimit()
    this.manager?.enforceGlobalLimit()
  }

  /** Total number of archived lines */
  get length(): number {
    return this.totalLines
  }

  /** Total bytes used by the archive */
  get bytes(): number {
    return this.totalBytes
  }

  /** Current revision number for change tracking */
  getRevision(): number {
    return this.revision
  }

  /** Gets the oldest chunk for global limit enforcement */
  getOldestChunk(): ArchiveChunk | null {
    return this.chunks.length > 0 ? this.chunks[0] : null
  }

  /**
   * Clears the line cache.
   * Call this when memory pressure is high or before large scroll operations.
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Resets the archive, deleting all data.
   * This operation is async and returns immediately while cleanup runs in background.
   */
  reset(): void {
    const chunksToDelete = this.chunks
    this.generation += 1
    this.chunks = []
    this.totalLines = 0
    this.totalBytes = 0
    this.nextChunkId = 1
    this.cache.clear()
    this.placementChunkCache.clear()
    this.revision += 1

    void this.enqueue(async () => {
      for (const chunk of chunksToDelete) {
        await deleteChunkFiles(chunk)
      }
      await this.saveMeta()
    })
  }

  /**
   * Disposes the archive, cleaning up all resources.
   * Unregisters from the manager and resets the archive.
   */
  dispose(): void {
    this.reset()
    this.manager?.unregister(this)
  }

  /**
   * Appends lines to the archive.
   * @param lines - Array of terminal rows (each row is TerminalCell[])
   * @returns Promise that resolves when lines are persisted
   */
  appendLines(lines: TerminalCell[][]): Promise<void> {
    if (lines.length === 0) return Promise.resolve()
    const generation = this.generation
    return this.enqueue(() => this.appendLinesInternal(lines, generation))
  }

  /**
   * Appends placements to the archive, associated with the current chunk.
   * Placements are stored in a separate file alongside the cell chunk.
   * @param placements - Array of ArchivePlacement to store
   * @returns Promise that resolves when placements are persisted
   */
  appendPlacements(placements: ArchivePlacement[]): Promise<void> {
    if (placements.length === 0) return Promise.resolve()
    const generation = this.generation
    return this.enqueue(() => this.appendPlacementsInternal(placements, generation))
  }

  /**
   * Gets a single line from the archive.
   * @param offset - Line offset (0 = oldest line)
   * @returns Array of TerminalCell, or null if offset is invalid
   */
  getLine(offset: number): TerminalCell[] | null {
    if (offset < 0 || offset >= this.totalLines) return null

    const cached = this.cache.get(offset)
    if (cached) return cached

    const found = findChunk(this.chunks, offset)
    if (!found) return null

    const row = readRow(found.chunk, found.chunkStart, found.index, this.cache)
    return row
  }

  /**
   * Prefetches a range of lines into the cache.
   * Useful for smooth scrolling performance.
   * @param startOffset - Starting line offset
   * @param count - Number of lines to prefetch
   */
  prefetchLines(startOffset: number, count: number): void {
    if (count <= 0) return
    const start = Math.max(0, startOffset)
    const endOffset = Math.min(this.totalLines, start + count)

    for (let offset = start; offset < endOffset; offset++) {
      if (this.cache.get(offset)) continue
      const found = findChunk(this.chunks, offset)
      if (!found) break
      readChunkRange(found.chunk, found.chunkStart, found.index, 1, this.cache)
    }
  }

  /**
   * Gets placements for a given line range in the archive.
   * Returns placements whose archiveOffset falls within [startOffset, endOffset).
   * @param startOffset - Start line offset (inclusive, 0 = oldest line)
   * @param endOffset - End line offset (exclusive)
   * @returns Array of ArchivePlacement within the range
   */
  getPlacementsForLineRange(startOffset: number, endOffset: number): ArchivePlacement[] {
    return getPlacementsForLineRange(
      this.chunks,
      this.totalLines,
      startOffset,
      endOffset,
      this.placementChunkCache
    )
  }

  /**
   * Drops the oldest chunk from the archive.
   * Called automatically when size limits are exceeded.
   * @returns DropChunkResult if a chunk was removed, null otherwise
   */
  dropOldestChunk(): DropChunkResult | null {
    const chunk = this.chunks.shift()
    if (!chunk) return null

    this.totalLines -= chunk.lineCount
    this.totalBytes -= chunk.bytes
    this.cache.clear()
    this.placementChunkCache.delete(chunk.id)
    this.revision += 1

    void this.enqueue(async () => {
      await deleteChunkFiles(chunk)
      await this.saveMeta()
    })

    return { linesRemoved: chunk.lineCount, bytesRemoved: chunk.bytes }
  }

  // --- Private methods ---

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.appendQueue = this.appendQueue
      .catch((e) => {
        console.warn("[scrollback-archive] Queue task failed:", e)
      })
      .then(task)
      .catch((e) => {
        console.warn("[scrollback-archive] Enqueued task failed:", e)
      })
    return this.appendQueue
  }

  private ensureDir(): void {
    ensureDir(this.rootDir)
  }

  private loadMeta(): void {
    const meta = loadMeta(this.metaPath)
    if (!meta) return

    this.chunks = buildChunksFromMeta(this.rootDir, meta.chunks)

    // Recalculate totals
    this.totalLines = 0
    this.totalBytes = 0
    for (const chunk of this.chunks) {
      this.totalLines += chunk.lineCount
      this.totalBytes += chunk.bytes
    }

    this.placementChunkCache.clear()
    this.nextChunkId = calculateNextChunkId(meta.nextChunkId, this.chunks)
  }

  private async saveMeta(): Promise<void> {
    const meta: ArchiveMeta = {
      version: 1,
      nextChunkId: this.nextChunkId,
      chunks: this.chunks.map((chunk) => ({
        id: chunk.id,
        filename: chunk.filename,
        cols: chunk.cols,
        rowBytes: chunk.rowBytes,
        lineCount: chunk.lineCount,
        bytes: chunk.bytes,
        createdAt: chunk.createdAt,
        startOffsetAtWrite: chunk.startOffsetAtWrite,
        placementFilename: chunk.placementFilename,
        placementBytes: chunk.placementBytes,
      })),
    }
    await flushMeta(this.metaPath, meta)
  }

  private async appendLinesInternal(
    lines: TerminalCell[][],
    generation: number
  ): Promise<void> {
    if (lines.length === 0) return
    if (generation !== this.generation) return

    this.ensureDir()

    let currentChunk = this.chunks[this.chunks.length - 1] ?? null
    let buffered: Buffer[] = []
    let bufferedBytes = 0
    let appendedLineCount = 0

    const flushBuffer = async (): Promise<boolean> => {
      if (!currentChunk || buffered.length === 0) return true
      const payload =
        buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedBytes)
      const result = await appendChunkData(currentChunk.path, payload)
      if (result instanceof Error) return false
      if (generation !== this.generation) return false
      buffered = []
      bufferedBytes = 0
      return true
    }

    for (const line of lines) {
      if (line.length === 0) continue
      const cols = line.length
      const rowBytes = 4 + cols * 16 // CELL_SIZE = 16

      if (shouldCreateNewChunk(currentChunk, cols, this.chunkMaxLines)) {
        const flushed = await flushBuffer()
        if (!flushed) return
        currentChunk = createChunk(
          this.rootDir,
          this.nextChunkId++,
          this.totalLines,
          cols,
          rowBytes
        )
        this.chunks.push(currentChunk)
      }

      const packed = Buffer.from(packRow(line))
      buffered.push(packed)
      bufferedBytes += packed.byteLength
      currentChunk!.lineCount += 1
      currentChunk!.bytes += rowBytes
      this.totalLines += 1
      this.totalBytes += rowBytes
      appendedLineCount += 1
    }

    const flushed = await flushBuffer()
    if (!flushed || generation !== this.generation) return
    if (appendedLineCount > 0) {
      this.revision += 1
    }
    await this.saveMeta()
    if (generation !== this.generation) return
    this.enforceLimit()
    this.manager?.enforceGlobalLimit()
  }

  private async appendPlacementsInternal(
    placements: ArchivePlacement[],
    generation: number
  ): Promise<void> {
    if (placements.length === 0) return
    if (generation !== this.generation) return

    this.ensureDir()

    const currentChunk = this.chunks[this.chunks.length - 1]
    if (!currentChunk) return

    setupPlacementPath(currentChunk, this.rootDir)
    await appendPlacementsToChunk(currentChunk, placements, this.placementChunkCache)
    this.revision += 1
    await this.saveMeta()
  }

  private enforceLimit(): void {
    while (this.totalBytes > this.maxBytes) {
      const removed = this.dropOldestChunk()
      if (!removed) break
    }
  }
}
