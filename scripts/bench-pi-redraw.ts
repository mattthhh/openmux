#!/usr/bin/env bun
import {
  runPiRedrawBenchmark,
  type PiRedrawBenchmarkResult,
} from "../src/bench/pi-redraw-harness"

interface CliOptions {
  archiveMetaPath?: string
  archiveWindowStart?: number
  archiveWindowRows?: number
  cols?: number
  rows?: number
  repaints?: number
  iterations?: number
  warmupIterations?: number
  syntheticEntries?: number
  archiveWorkloadRowLimit?: number
  json: boolean
}

const args = process.argv.slice(2)
const options: CliOptions = {
  json: false,
}

for (let index = 0; index < args.length; index++) {
  const arg = args[index]

  if (arg === "--archive-meta") {
    options.archiveMetaPath = args[index + 1]
    index += 1
    continue
  }
  if (arg === "--archive-window-start") {
    options.archiveWindowStart = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--archive-window-rows") {
    options.archiveWindowRows = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--cols") {
    options.cols = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--rows") {
    options.rows = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--repaints") {
    options.repaints = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--iterations") {
    options.iterations = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--warmup") {
    options.warmupIterations = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--synthetic-entries") {
    options.syntheticEntries = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--archive-workload-rows") {
    options.archiveWorkloadRowLimit = parseNumber(args[index + 1])
    index += 1
    continue
  }
  if (arg === "--json") {
    options.json = true
    continue
  }

  console.error(`Unknown argument: ${arg}`)
  process.exit(1)
}

const result = await runPiRedrawBenchmark({
  archiveMetaPath: options.archiveMetaPath,
  archiveWindowStart: options.archiveWindowStart,
  archiveWindowRows: options.archiveWindowRows,
  cols: options.cols,
  rows: options.rows,
  repaints: options.repaints,
  iterations: options.iterations,
  warmupIterations: options.warmupIterations,
  syntheticEntries: options.syntheticEntries,
  archiveWorkloadRowLimit: options.archiveWorkloadRowLimit,
})

if (result instanceof Error) {
  console.error(result.message)
  process.exit(1)
}

if (options.json) {
  console.log(JSON.stringify(toJson(result), null, 2))
} else {
  printHuman(result)
}

printMetrics(result)

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function printHuman(result: PiRedrawBenchmarkResult): void {
  console.log(`Workload: ${result.workload.description}`)
  console.log(
    `Harness: cols=${result.cols} rows=${result.rows} repaints=${result.repaints} iterations=${result.iterations} warmup=${result.warmupIterations}`
  )
  console.log(
    `Payload: lines=${result.workload.lines} bytes=${result.workload.bytes} hot_scrollback_limit=${result.hotScrollbackLimit}`
  )

  if (result.archiveAnalysis) {
    console.log("Archive analysis:")
    console.log(
      `  total_rows=${result.archiveAnalysis.totalRows} nonblank_rows=${result.archiveAnalysis.nonBlankRows} unique_nonblank_rows=${result.archiveAnalysis.uniqueNonBlankRows} repeated_nonblank_rows=${result.archiveAnalysis.repeatedNonBlankRows} duplicate_ratio=${formatPercent(result.archiveAnalysis.duplicateRatio)} widest_line_chars=${result.archiveAnalysis.widestLineChars}`
    )
    for (const repeated of result.archiveAnalysis.topRepeatedLines) {
      console.log(`  top_repeat=${repeated.count}x ${truncate(repeated.text, 120)}`)
    }
  }

  console.log("Append scenario:")
  printScenario(result.append)
  console.log("Repaint scenario:")
  printScenario(result.repaint)
  console.log(`Repaint / append ratio: ${result.repaintOverAppend.toFixed(2)}x`)
}

function printScenario(scenario: PiRedrawBenchmarkResult["append"]): void {
  console.log(
    `  total_ms=${scenario.totalMs.toFixed(2)} write_ms=${scenario.writeMs.toFixed(2)} archive_ms=${scenario.archiveMs.toFixed(2)} archive_passes=${scenario.archivePasses.toFixed(0)} archive_batches=${scenario.archiveBatches.toFixed(0)} archived_lines=${scenario.archivedLines.toFixed(0)} archive_bytes=${scenario.archiveBytes.toFixed(0)} total_scrollback_lines=${scenario.totalScrollbackLines.toFixed(0)} dirty_rows_consumed=${scenario.dirtyRowsConsumed.toFixed(0)}`
  )
}

function printMetrics(result: PiRedrawBenchmarkResult): void {
  console.log(`METRIC repaint_ms=${result.repaint.totalMs.toFixed(2)}`)
  console.log(`METRIC repaint_write_ms=${result.repaint.writeMs.toFixed(2)}`)
  console.log(`METRIC repaint_archive_ms=${result.repaint.archiveMs.toFixed(2)}`)
  console.log(`METRIC append_ms=${result.append.totalMs.toFixed(2)}`)
  console.log(`METRIC repaint_over_append=${result.repaintOverAppend.toFixed(4)}`)
  console.log(`METRIC repaint_archived_lines=${result.repaint.archivedLines.toFixed(0)}`)
  console.log(`METRIC repaint_archive_bytes=${result.repaint.archiveBytes.toFixed(0)}`)
  console.log(`METRIC repaint_dirty_rows=${result.repaint.dirtyRowsConsumed.toFixed(0)}`)
  if (result.archiveAnalysis) {
    console.log(`METRIC archive_duplicate_ratio=${result.archiveAnalysis.duplicateRatio.toFixed(4)}`)
    console.log(`METRIC archive_unique_nonblank_rows=${result.archiveAnalysis.uniqueNonBlankRows}`)
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

function toJson(result: PiRedrawBenchmarkResult) {
  return {
    workload: result.workload,
    harness: {
      cols: result.cols,
      rows: result.rows,
      repaints: result.repaints,
      iterations: result.iterations,
      warmupIterations: result.warmupIterations,
      hotScrollbackLimit: result.hotScrollbackLimit,
    },
    archiveAnalysis: result.archiveAnalysis,
    append: result.append,
    repaint: result.repaint,
    repaintOverAppend: result.repaintOverAppend,
  }
}
