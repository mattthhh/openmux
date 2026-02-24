/**
 * Disk-backed scrollback archive for terminal history.
 */

import fs from "node:fs"
import fsp from "node:fs/promises"
import { tryAsync } from "errore"
import path from "node:path"
import type { TerminalCell } from "../core/types"
import { ScrollbackArchiveError } from "../effect/errors"
import { packRow, unpackRow, CELL_SIZE } from "./cell-serialization"
import { ScrollbackCache } from "./emulator-utils/scrollback-cache"
import {
  SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES,
  SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY,
} from "./scrollback-config"
import {
  PLACEMENT_SIZE,
  packPlacements as packPlacementsToArrayBuffer,
  unpackPlacements as unpackPlacementsFromArrayBuffer,
  type ArchivePlacement,
} from "./kitty-graphics/archive-placement"

export { PLACEMENT_SIZE, type ArchivePlacement }

/**
 * Pack an array of ArchivePlacements into a Buffer for file storage.
 * Converts the ArrayBuffer from packPlacementsToArrayBuffer to Node.js Buffer.
 */
function packPlacements(placements: ArchivePlacement[]): Buffer {
  const arrayBuffer = packPlacementsToArrayBuffer(placements)
  return Buffer.from(arrayBuffer)
}

/**
 * Unpack ArchivePlacements from a Buffer read from file.
 * Converts the Node.js Buffer to ArrayBuffer for unpackPlacementsFromArrayBuffer.
 */
function unpackPlacements(buffer: Buffer): ArchivePlacement[] {
  // Create a proper ArrayBuffer from the Buffer's slice
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  return unpackPlacementsFromArrayBuffer(arrayBuffer)
}

type ArchiveChunk = {
  id: number
  filename: string
  path: string
  cols: number
  rowBytes: number
  lineCount: number
  bytes: number
  createdAt: number
  /** Archive-relative start offset when this chunk was first created */
  startOffsetAtWrite: number
  /** Reference to placement data file (undefined for backward compatibility) */
  placementFilename?: string
  placementPath?: string
  placementBytes?: number
}

type ArchiveMeta = {
  version: number
  nextChunkId: number
  chunks: Array<{
    id: number
    filename: string
    cols: number
    rowBytes: number
    lineCount: number
    bytes: number
    createdAt: number
    /** Archive-relative start offset when this chunk was first created */
    startOffsetAtWrite?: number
    /** Placement chunk reference (undefined for backward compatibility) */
    placementFilename?: string
    placementBytes?: number
  }>
}

export class ScrollbackArchive {
  private readonly rootDir: string
  private readonly metaPath: string
  private readonly maxBytes: number
  private readonly chunkMaxLines: number
  private readonly cache: ScrollbackCache
  private readonly manager?: ScrollbackArchiveManager
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

  get length(): number {
    return this.totalLines
  }

  get bytes(): number {
    return this.totalBytes
  }

  getRevision(): number {
    return this.revision
  }

  getOldestChunk(): ArchiveChunk | null {
    return this.chunks.length > 0 ? this.chunks[0] : null
  }

  /**
   * Append placements to the archive, associated with the current chunk.
   * Placements are stored in a separate file alongside the cell chunk.
   * @param placements Array of ArchivePlacement to store
   */
  appendPlacements(placements: ArchivePlacement[]): Promise<void> {
    if (placements.length === 0) return Promise.resolve()
    const generation = this.generation
    return this.enqueue(() => this.appendPlacementsInternal(placements, generation))
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

    // Ensure placement file is set up for this chunk
    if (!currentChunk.placementPath) {
      currentChunk.placementFilename = `chunk-${currentChunk.id}-placements.bin`
      currentChunk.placementPath = path.join(this.rootDir, currentChunk.placementFilename)
      currentChunk.placementBytes = 0
    }

    const packed = packPlacements(placements)
    const result = await tryAsync<void, ScrollbackArchiveError>({
      try: () => fsp.appendFile(currentChunk.placementPath!, packed),
      catch: (e) => new ScrollbackArchiveError({ operation: 'write', reason: String(e) }),
    })

    if (result instanceof ScrollbackArchiveError) {
      return
    }

    if (generation !== this.generation) return

    currentChunk.placementBytes = (currentChunk.placementBytes ?? 0) + packed.byteLength
    this.revision += 1
    await this.flushMeta()
  }

  /**
   * Get placements for a given line range in the archive.
   * Returns placements whose archiveOffset falls within [startOffset, endOffset).
   * @param startOffset Start line offset (inclusive, 0 = oldest line)
   * @param endOffset End line offset (exclusive)
   * @returns Array of ArchivePlacement within the range
   */
  getPlacementsForLineRange(startOffset: number, endOffset: number): ArchivePlacement[] {
    if (startOffset < 0) startOffset = 0
    if (endOffset > this.totalLines) endOffset = this.totalLines
    if (startOffset >= endOffset) return []

    const placements: ArchivePlacement[] = []

    // Find which chunks overlap with the requested range
    let chunkStart = 0
    for (const chunk of this.chunks) {
      const chunkEnd = chunkStart + chunk.lineCount
      
      // Check if this chunk overlaps with the requested range
      if (chunkEnd > startOffset && chunkStart < endOffset) {
        // This chunk has relevant lines, check for placement data
        if (chunk.placementPath && chunk.placementBytes && chunk.placementBytes > 0) {
          const chunkPlacements = this.readPlacementsFromChunk(chunk)
          // Rebase chunk placements into the current archive coordinate space.
          for (const placement of chunkPlacements) {
            const rebasedOffset = this.rebasePlacementOffset(chunk, chunkStart, placement.archiveOffset)
            if (rebasedOffset < startOffset || rebasedOffset >= endOffset) continue
            if (rebasedOffset < 0 || rebasedOffset >= this.totalLines) continue
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

  private rebasePlacementOffset(
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

  private readPlacementsFromChunk(chunk: ArchiveChunk): ArchivePlacement[] {
    if (!chunk.placementPath || !chunk.placementBytes || chunk.placementBytes === 0) {
      return []
    }

    try {
      const buffer = fs.readFileSync(chunk.placementPath)
      return unpackPlacements(buffer)
    } catch {
      return []
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  reset(): void {
    const chunksToDelete = this.chunks
    this.generation += 1
    this.chunks = []
    this.totalLines = 0
    this.totalBytes = 0
    this.nextChunkId = 1
    this.cache.clear()
    this.revision += 1
    void this.enqueue(async () => {
      for (const chunk of chunksToDelete) {
        // Delete cell data file
        const result = await tryAsync<void, ScrollbackArchiveError>({
          try: () => fsp.unlink(chunk.path),
          catch: (e) => new ScrollbackArchiveError({ operation: 'delete', reason: String(e) }),
        });
        if (result instanceof ScrollbackArchiveError) {
          // Continue to try deleting placement file
        }
        
        // Delete placement data file if it exists
        if (chunk.placementPath) {
          const placementResult = await tryAsync<void, ScrollbackArchiveError>({
            try: () => fsp.unlink(chunk.placementPath!),
            catch: (e) => new ScrollbackArchiveError({ operation: 'delete', reason: String(e) }),
          });
          if (placementResult instanceof ScrollbackArchiveError) {
            // Ignore errors for placement file
          }
        }
      }
      await this.flushMeta()
    })
  }

  dispose(): void {
    this.reset()
    this.manager?.unregister(this)
  }

  appendLines(lines: TerminalCell[][]): Promise<void> {
    if (lines.length === 0) return Promise.resolve()
    const generation = this.generation
    return this.enqueue(() => this.appendLinesInternal(lines, generation))
  }

  private async appendLinesInternal(lines: TerminalCell[][], generation: number): Promise<void> {
    if (lines.length === 0) return
    if (generation !== this.generation) return

    this.ensureDir()

    let currentChunk = this.chunks[this.chunks.length - 1] ?? null
    let buffered: Buffer[] = []
    let bufferedBytes = 0
    let appendedLineCount = 0

    const flushBuffer = async (): Promise<boolean> => {
      if (!currentChunk || buffered.length === 0) return true
      const payload = buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedBytes)
      const result = await tryAsync<void, ScrollbackArchiveError>({
        try: () => fsp.appendFile(currentChunk!.path, payload),
        catch: (e) => new ScrollbackArchiveError({ operation: 'write', reason: String(e) }),
      });
      if (result instanceof ScrollbackArchiveError) {
        return false;
      }
      if (generation !== this.generation) return false
      buffered = []
      bufferedBytes = 0
      return true
    }

    for (const line of lines) {
      if (line.length === 0) continue
      const cols = line.length
      const rowBytes = 4 + cols * CELL_SIZE

      if (
        !currentChunk ||
        currentChunk.cols !== cols ||
        currentChunk.lineCount >= this.chunkMaxLines
      ) {
        const flushed = await flushBuffer()
        if (flushed === false) return
        currentChunk = this.createChunk(cols, rowBytes)
        this.chunks.push(currentChunk)
      }

      const packed = Buffer.from(packRow(line))
      buffered.push(packed)
      bufferedBytes += packed.byteLength
      currentChunk.lineCount += 1
      currentChunk.bytes += rowBytes
      this.totalLines += 1
      this.totalBytes += rowBytes
      appendedLineCount += 1
    }

    const flushed = await flushBuffer()
    if (flushed === false || generation !== this.generation) return
    if (appendedLineCount > 0) {
      this.revision += 1
    }
    await this.flushMeta()
    if (generation !== this.generation) return
    this.enforceLimit()
    this.manager?.enforceGlobalLimit()
  }

  getLine(offset: number): TerminalCell[] | null {
    if (offset < 0 || offset >= this.totalLines) return null
    const cached = this.cache.get(offset)
    if (cached) return cached

    const found = this.findChunk(offset)
    if (!found) return null

    const row = this.readRow(found.chunk, found.chunkStart, found.index)
    if (!row) return null
    return row
  }

  prefetchLines(startOffset: number, count: number): void {
    if (count <= 0) return
    const start = Math.max(0, startOffset)
    const endOffset = Math.min(this.totalLines, start + count)
    for (let offset = start; offset < endOffset; offset++) {
      if (this.cache.get(offset)) continue
      const found = this.findChunk(offset)
      if (!found) break
      this.readChunkRange(found.chunk, found.chunkStart, found.index, 1)
    }
  }

  dropOldestChunk(): { linesRemoved: number; bytesRemoved: number } | null {
    const chunk = this.chunks.shift()
    if (!chunk) return null

    this.totalLines -= chunk.lineCount
    this.totalBytes -= chunk.bytes
    this.cache.clear()
    this.revision += 1
    void this.enqueue(async () => {
      // Delete cell data file
      const result = await tryAsync<void, ScrollbackArchiveError>({
        try: () => fsp.unlink(chunk.path),
        catch: (e) => new ScrollbackArchiveError({ operation: 'delete', reason: String(e) }),
      });
      if (result instanceof ScrollbackArchiveError) {
        // Continue to try deleting placement file even if cell delete fails
      }
      
      // Delete placement data file if it exists
      if (chunk.placementPath) {
        const placementResult = await tryAsync<void, ScrollbackArchiveError>({
          try: () => fsp.unlink(chunk.placementPath!),
          catch: (e) => new ScrollbackArchiveError({ operation: 'delete', reason: String(e) }),
        });
        if (placementResult instanceof ScrollbackArchiveError) {
          // Ignore errors for placement file - it may not exist
        }
      }
      
      await this.flushMeta()
    })
    return { linesRemoved: chunk.lineCount, bytesRemoved: chunk.bytes }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.appendQueue = this.appendQueue
      .catch(() => {})
      .then(task)
      .catch(() => {})
    return this.appendQueue
  }

  private ensureDir(): void {
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  private createChunk(cols: number, rowBytes: number): ArchiveChunk {
    const id = this.nextChunkId++
    const filename = `chunk-${id}.bin`
    return {
      id,
      filename,
      path: path.join(this.rootDir, filename),
      cols,
      rowBytes,
      lineCount: 0,
      bytes: 0,
      createdAt: Date.now(),
      startOffsetAtWrite: this.totalLines,
    }
  }

  private findChunk(offset: number): { chunk: ArchiveChunk; chunkStart: number; index: number } | null {
    let start = 0
    for (const chunk of this.chunks) {
      const end = start + chunk.lineCount
      if (offset < end) {
        return { chunk, chunkStart: start, index: offset - start }
      }
      start = end
    }
    return null
  }

  private readRow(
    chunk: ArchiveChunk,
    chunkStart: number,
    index: number
  ): TerminalCell[] | null {
    const row = this.readChunkRange(chunk, chunkStart, index, 1)
    return row.length > 0 ? row[0] : null
  }

  private readChunkRange(
    chunk: ArchiveChunk,
    chunkStart: number,
    index: number,
    count: number
  ): TerminalCell[][] {
    const maxCount = Math.min(count, chunk.lineCount - index)
    if (maxCount <= 0) return []

    const rowBytes = chunk.rowBytes
    const totalBytes = rowBytes * maxCount
    const buffer = Buffer.alloc(totalBytes)
    const offsetBytes = rowBytes * index

    let bytesRead = 0
    let fd: number | null = null
    
    try {
      fd = fs.openSync(chunk.path, "r")
      bytesRead = fs.readSync(fd, buffer, 0, totalBytes, offsetBytes)
    } catch {
      return []
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch {
          // Ignore close errors
        }
      }
    }

    if (bytesRead < rowBytes) return []

    const rows: TerminalCell[][] = []
    const totalRows = Math.floor(bytesRead / rowBytes)
    for (let i = 0; i < totalRows; i++) {
      const slice = buffer.subarray(i * rowBytes, (i + 1) * rowBytes)
      const row = unpackRow(toArrayBuffer(slice))
      rows.push(row)
      const absoluteOffset = chunkStart + index + i
      this.cache.set(absoluteOffset, row)
    }

    return rows
  }

  private enforceLimit(): void {
    while (this.totalBytes > this.maxBytes) {
      const removed = this.dropOldestChunk()
      if (!removed) break
    }
  }

  private loadMeta(): void {
    if (!fs.existsSync(this.metaPath)) return
    let parsed: ArchiveMeta | null = null
    
    try {
      const data = fs.readFileSync(this.metaPath, "utf8")
      parsed = JSON.parse(data) as ArchiveMeta
    } catch {
      return
    }
    
    if (!parsed || parsed.version !== 1) return

    this.chunks = []
    this.totalLines = 0
    this.totalBytes = 0
    this.nextChunkId = parsed.nextChunkId || 1

    let currentStartOffset = 0
    for (const entry of parsed.chunks ?? []) {
      const chunkPath = path.join(this.rootDir, entry.filename)
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
        // Backward compatibility: older archives won't have this field.
        startOffsetAtWrite: entry.startOffsetAtWrite ?? currentStartOffset,
        // Backward compatibility: placement fields may be undefined in older archives
        placementFilename: entry.placementFilename,
        placementPath: entry.placementFilename 
          ? path.join(this.rootDir, entry.placementFilename) 
          : undefined,
        placementBytes: entry.placementBytes ?? 0,
      }
      this.chunks.push(chunk)
      this.totalLines += chunk.lineCount
      this.totalBytes += chunk.bytes
      currentStartOffset += chunk.lineCount
    }

    if (this.chunks.length > 0) {
      const maxId = Math.max(...this.chunks.map((chunk) => chunk.id))
      this.nextChunkId = Math.max(this.nextChunkId, maxId + 1)
    }
  }

  private async flushMeta(): Promise<void> {
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
        // Include placement metadata if this chunk has placement data
        placementFilename: chunk.placementFilename,
        placementBytes: chunk.placementBytes,
      })),
    }
    const result = await tryAsync<void, ScrollbackArchiveError>({
      try: () => fsp.writeFile(this.metaPath, JSON.stringify(meta), "utf8"),
      catch: (e) => new ScrollbackArchiveError({ operation: 'write', reason: String(e) }),
    });
    if (result instanceof ScrollbackArchiveError) {
      return;
    }
  }
}

export class ScrollbackArchiveManager {
  private archives = new Set<ScrollbackArchive>()
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  register(archive: ScrollbackArchive): void {
    this.archives.add(archive)
  }

  unregister(archive: ScrollbackArchive): void {
    this.archives.delete(archive)
  }

  enforceGlobalLimit(): void {
    let totalBytes = 0
    for (const archive of this.archives) {
      totalBytes += archive.bytes
    }

    while (totalBytes > this.maxBytes) {
      let targetArchive: ScrollbackArchive | null = null
      let targetChunk: ArchiveChunk | null = null

      for (const archive of this.archives) {
        const chunk = archive.getOldestChunk()
        if (!chunk) continue
        if (!targetChunk || chunk.createdAt < targetChunk.createdAt) {
          targetChunk = chunk
          targetArchive = archive
        }
      }

      if (!targetArchive || !targetChunk) break

      const removed = targetArchive.dropOldestChunk()
      if (!removed) break
      totalBytes -= removed.bytesRemoved
    }
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}