import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  analyzeArchive,
  buildSyntheticPiWorkload,
} from "../../src/bench/pi-redraw-harness"
import { packRow } from "../../src/terminal/cell-serialization"
import type { TerminalCell } from "../../src/core/types"

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

describe("pi redraw harness", () => {
  test("builds a transcript-heavy synthetic workload", () => {
    const workload = buildSyntheticPiWorkload({ entries: 8 })
    expect(workload.length).toBeGreaterThan(0)
    expect(workload).toContain("Batch 2")
    expect(workload.split("\n").length).toBeGreaterThan(20)
  })

  test("analyzes archive duplication from persisted rows", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-redraw-harness-test-"))
    tempDirs.push(tempDir)

    const rows = [
      toRow("Batch 2 assessment table", 32),
      toRow("Batch 2 assessment table", 32),
      toRow("read /tmp/contractor_eval_texts/file.txt:1-260", 32),
      toRow("", 32),
    ]

    const payload = Buffer.concat(rows.map((row) => Buffer.from(packRow(row))))
    const chunkPath = path.join(tempDir, "chunk-1.bin")
    fs.writeFileSync(chunkPath, payload)

    fs.writeFileSync(
      path.join(tempDir, "meta.json"),
      JSON.stringify({
        version: 1,
        nextChunkId: 2,
        chunks: [
          {
            id: 1,
            filename: "chunk-1.bin",
            cols: 32,
            rowBytes: 4 + 32 * 16,
            lineCount: rows.length,
            bytes: payload.byteLength,
            createdAt: Date.now(),
            startOffsetAtWrite: 0,
          },
        ],
      })
    )

    const analysis = analyzeArchive({
      metaPath: path.join(tempDir, "meta.json"),
      workloadRowLimit: 8,
    })

    expect(analysis instanceof Error).toBe(false)
    if (analysis instanceof Error) {
      return
    }

    expect(analysis.totalRows).toBe(4)
    expect(analysis.nonBlankRows).toBe(3)
    expect(analysis.uniqueNonBlankRows).toBe(2)
    expect(analysis.repeatedNonBlankRows).toBe(1)
    expect(analysis.topRepeatedLines[0]?.count).toBe(2)
  })
})

function toRow(text: string, cols: number): TerminalCell[] {
  const chars = text.padEnd(cols, " ").slice(0, cols)
  return [...chars].map((char) => ({
    char,
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  }))
}
