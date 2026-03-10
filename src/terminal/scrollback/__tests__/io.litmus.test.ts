/**
 * I/O operations litmus tests.
 * Fast, single-concept tests for file I/O operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import type { ArchiveChunk, ArchiveMeta } from "../types"
import {
  ensureDir,
  loadMeta,
  flushMeta,
  buildChunksFromMeta,
  calculateNextChunkId,
} from "../io"

describe("io.litmus", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrollback-io-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("ensureDir", () => {
    it("creates directory if it does not exist", () => {
      const newDir = path.join(tempDir, "subdir", "nested")
      expect(fs.existsSync(newDir)).toBe(false)

      ensureDir(newDir)

      expect(fs.existsSync(newDir)).toBe(true)
      expect(fs.statSync(newDir).isDirectory()).toBe(true)
    })

    it("succeeds when directory already exists", () => {
      ensureDir(tempDir)
      expect(fs.existsSync(tempDir)).toBe(true)
    })
  })

  describe("loadMeta", () => {
    it("returns null when meta file does not exist", () => {
      const metaPath = path.join(tempDir, "nonexistent.json")
      const result = loadMeta(metaPath)
      expect(result).toBeNull()
    })

    it("returns null for invalid JSON", () => {
      const metaPath = path.join(tempDir, "meta.json")
      fs.writeFileSync(metaPath, "invalid json")

      const result = loadMeta(metaPath)
      expect(result).toBeNull()
    })

    it("returns null for wrong version", () => {
      const metaPath = path.join(tempDir, "meta.json")
      const meta: ArchiveMeta = {
        version: 2,
        nextChunkId: 1,
        chunks: [],
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta))

      const result = loadMeta(metaPath)
      expect(result).toBeNull()
    })

    it("returns meta for valid version 1 file", () => {
      const metaPath = path.join(tempDir, "meta.json")
      const meta: ArchiveMeta = {
        version: 1,
        nextChunkId: 5,
        chunks: [
          {
            id: 1,
            filename: "chunk-1.bin",
            cols: 80,
            rowBytes: 1284,
            lineCount: 100,
            bytes: 128400,
            createdAt: Date.now(),
          },
        ],
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta))

      const result = loadMeta(metaPath)
      expect(result).not.toBeNull()
      expect(result!.version).toBe(1)
      expect(result!.nextChunkId).toBe(5)
      expect(result!.chunks).toHaveLength(1)
    })
  })

  describe("flushMeta", () => {
    it("writes meta to file", async () => {
      const metaPath = path.join(tempDir, "meta.json")
      const meta: ArchiveMeta = {
        version: 1,
        nextChunkId: 1,
        chunks: [],
      }

      const result = await flushMeta(metaPath, meta)
      expect(result).toBeUndefined()

      const data = fs.readFileSync(metaPath, "utf8")
      const parsed = JSON.parse(data)
      expect(parsed.version).toBe(1)
    })

    it("returns error for invalid path", async () => {
      const metaPath = path.join("/nonexistent", "dir", "meta.json")
      const meta: ArchiveMeta = {
        version: 1,
        nextChunkId: 1,
        chunks: [],
      }

      const result = await flushMeta(metaPath, meta)
      expect(result).toBeInstanceOf(Error)
    })
  })

  describe("buildChunksFromMeta", () => {
    it("builds chunks from metadata entries", () => {
      const metaEntries: ArchiveMeta["chunks"] = [
        {
          id: 1,
          filename: "chunk-1.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 100,
          bytes: 128400,
          createdAt: 1234567890,
        },
        {
          id: 2,
          filename: "chunk-2.bin",
          cols: 120,
          rowBytes: 1924,
          lineCount: 50,
          bytes: 96200,
          createdAt: 1234567900,
          startOffsetAtWrite: 200,
          placementFilename: "chunk-2-placements.bin",
          placementBytes: 640,
        },
      ]

      // Create chunk files so they exist
      fs.writeFileSync(path.join(tempDir, "chunk-1.bin"), "")
      fs.writeFileSync(path.join(tempDir, "chunk-2.bin"), "")

      const chunks = buildChunksFromMeta(tempDir, metaEntries)

      expect(chunks).toHaveLength(2)
      expect(chunks[0].id).toBe(1)
      expect(chunks[0].path).toBe(path.join(tempDir, "chunk-1.bin"))
      expect(chunks[1].id).toBe(2)
      expect(chunks[1].startOffsetAtWrite).toBe(200)
      expect(chunks[1].placementFilename).toBe("chunk-2-placements.bin")
      expect(chunks[1].placementPath).toBe(path.join(tempDir, "chunk-2-placements.bin"))
      expect(chunks[1].placementBytes).toBe(640)
    })

    it("skips chunks with missing files", () => {
      const metaEntries: ArchiveMeta["chunks"] = [
        {
          id: 1,
          filename: "chunk-1.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 100,
          bytes: 128400,
          createdAt: 1234567890,
        },
        {
          id: 2,
          filename: "missing.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 50,
          bytes: 64200,
          createdAt: 1234567900,
        },
      ]

      // Only create first chunk
      fs.writeFileSync(path.join(tempDir, "chunk-1.bin"), "")

      const chunks = buildChunksFromMeta(tempDir, metaEntries)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].id).toBe(1)
    })

    it("handles backward compatibility without startOffsetAtWrite", () => {
      const metaEntries: ArchiveMeta["chunks"] = [
        {
          id: 1,
          filename: "chunk-1.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 100,
          bytes: 128400,
          createdAt: 1234567890,
          // No startOffsetAtWrite
        },
      ]

      fs.writeFileSync(path.join(tempDir, "chunk-1.bin"), "")

      const chunks = buildChunksFromMeta(tempDir, metaEntries)

      expect(chunks[0].startOffsetAtWrite).toBe(0) // Should default to 0
    })

    it("accumulates startOffsetAtWrite for multiple chunks without it", () => {
      const metaEntries: ArchiveMeta["chunks"] = [
        {
          id: 1,
          filename: "chunk-1.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 100,
          bytes: 128400,
          createdAt: 1234567890,
        },
        {
          id: 2,
          filename: "chunk-2.bin",
          cols: 80,
          rowBytes: 1284,
          lineCount: 50,
          bytes: 64200,
          createdAt: 1234567900,
        },
      ]

      fs.writeFileSync(path.join(tempDir, "chunk-1.bin"), "")
      fs.writeFileSync(path.join(tempDir, "chunk-2.bin"), "")

      const chunks = buildChunksFromMeta(tempDir, metaEntries)

      expect(chunks[0].startOffsetAtWrite).toBe(0)
      expect(chunks[1].startOffsetAtWrite).toBe(100) // 0 + 100 from chunk 1
    })
  })

  describe("calculateNextChunkId", () => {
    it("returns currentNextId for empty chunks", () => {
      const result = calculateNextChunkId(5, [])
      expect(result).toBe(5)
    })

    it("calculates max + 1 for non-empty chunks", () => {
      const chunks: ArchiveChunk[] = [
        { ...createMockChunk(1), id: 1 },
        { ...createMockChunk(2), id: 5 },
        { ...createMockChunk(3), id: 3 },
      ]

      const result = calculateNextChunkId(1, chunks)
      expect(result).toBe(6) // max(1, 5, 3) + 1 = 6
    })

    it("prefers meta value if higher than max + 1", () => {
      const chunks: ArchiveChunk[] = [
        { ...createMockChunk(1), id: 1 },
        { ...createMockChunk(2), id: 3 },
      ]

      const result = calculateNextChunkId(10, chunks)
      expect(result).toBe(10) // 10 > 3 + 1
    })
  })
})

function createMockChunk(id: number): ArchiveChunk {
  return {
    id,
    filename: `chunk-${id}.bin`,
    path: `/tmp/chunk-${id}.bin`,
    cols: 80,
    rowBytes: 1284,
    lineCount: 0,
    bytes: 0,
    createdAt: Date.now(),
    startOffsetAtWrite: 0,
  }
}
