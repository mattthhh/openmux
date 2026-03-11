/**
 * Chunk operations litmus tests.
 * Fast, single-concept tests for chunk creation, finding, and reading.
 */

import { describe, it, expect } from "bun:test"
import type { ArchiveChunk } from "../types"
import {
  createChunk,
  findChunk,
  calculateRowBytes,
  shouldCreateNewChunk,
} from "../chunks"

describe("chunks.litmus", () => {
  describe("createChunk", () => {
    it("creates a chunk with correct properties", () => {
      const chunk = createChunk("/tmp", 1, 0, 80, 1284)

      expect(chunk.id).toBe(1)
      expect(chunk.filename).toBe("chunk-1.bin")
      expect(chunk.path).toBe("/tmp/chunk-1.bin")
      expect(chunk.cols).toBe(80)
      expect(chunk.rowBytes).toBe(1284)
      expect(chunk.lineCount).toBe(0)
      expect(chunk.bytes).toBe(0)
      expect(chunk.startOffsetAtWrite).toBe(0)
      expect(chunk.createdAt).toBeGreaterThan(0)
    })

    it("increments chunk ID", () => {
      const chunk1 = createChunk("/tmp", 1, 0, 80, 1284)
      const chunk2 = createChunk("/tmp", 2, 100, 80, 1284)

      expect(chunk1.id).toBe(1)
      expect(chunk2.id).toBe(2)
    })

    it("sets correct start offset", () => {
      const chunk = createChunk("/tmp", 1, 500, 80, 1284)
      expect(chunk.startOffsetAtWrite).toBe(500)
    })
  })

  describe("findChunk", () => {
    it("returns null for empty chunks array", () => {
      const result = findChunk([], 0)
      expect(result).toBeNull()
    })

    it("finds chunk containing offset 0", () => {
      const chunks: ArchiveChunk[] = [
        { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 100 },
      ]

      const result = findChunk(chunks, 0)
      expect(result).not.toBeNull()
      expect(result!.chunk.id).toBe(1)
      expect(result!.chunkStart).toBe(0)
      expect(result!.index).toBe(0)
    })

    it("finds correct chunk for offset spanning multiple chunks", () => {
      const chunks: ArchiveChunk[] = [
        { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 100 },
        { ...createChunk("/tmp", 2, 100, 80, 1284), lineCount: 50 },
        { ...createChunk("/tmp", 3, 150, 80, 1284), lineCount: 75 },
      ]

      // Offset 150 should be in chunk 3 (index 0 of chunk 3)
      const result = findChunk(chunks, 150)
      expect(result).not.toBeNull()
      expect(result!.chunk.id).toBe(3)
      expect(result!.chunkStart).toBe(150)
      expect(result!.index).toBe(0)

      // Offset 175 should be in chunk 3 (index 25 of chunk 3)
      const result2 = findChunk(chunks, 175)
      expect(result2!.chunk.id).toBe(3)
      expect(result2!.chunkStart).toBe(150)
      expect(result2!.index).toBe(25)
    })

    it("returns null for offset beyond total lines", () => {
      const chunks: ArchiveChunk[] = [
        { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 100 },
      ]

      const result = findChunk(chunks, 100)
      expect(result).toBeNull()
    })

    it("handles negative offset", () => {
      const chunks: ArchiveChunk[] = [
        { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 100 },
      ]

      const result = findChunk(chunks, -1)
      expect(result).toBeNull()
    })
  })

  describe("calculateRowBytes", () => {
    it("calculates correctly for 80 columns", () => {
      // 4 bytes count + 80 * 16 bytes per cell = 4 + 1280 = 1284
      expect(calculateRowBytes(80)).toBe(1284)
    })

    it("calculates correctly for 120 columns", () => {
      // 4 + 120 * 16 = 1924
      expect(calculateRowBytes(120)).toBe(1924)
    })

    it("handles edge case of 0 columns", () => {
      expect(calculateRowBytes(0)).toBe(4)
    })
  })

  describe("shouldCreateNewChunk", () => {
    it("returns true when no current chunk", () => {
      const result = shouldCreateNewChunk(null, 80, 2000)
      expect(result).toBe(true)
    })

    it("returns true when column count differs", () => {
      const chunk = createChunk("/tmp", 1, 0, 80, 1284)
      const result = shouldCreateNewChunk(chunk, 120, 2000)
      expect(result).toBe(true)
    })

    it("returns true when chunk is at max lines", () => {
      const chunk = { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 2000 }
      const result = shouldCreateNewChunk(chunk, 80, 2000)
      expect(result).toBe(true)
    })

    it("returns false when chunk can accept more lines", () => {
      const chunk = { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 100 }
      const result = shouldCreateNewChunk(chunk, 80, 2000)
      expect(result).toBe(false)
    })

    it("returns false when chunk is at max minus 1", () => {
      const chunk = { ...createChunk("/tmp", 1, 0, 80, 1284), lineCount: 1999 }
      const result = shouldCreateNewChunk(chunk, 80, 2000)
      expect(result).toBe(false)
    })
  })
})
