/**
 * Benchmark harness for transcript-heavy pi redraw workloads.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as errore from 'errore';
import { HOT_SCROLLBACK_LIMIT } from '../terminal/scrollback-config';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { ScrollbackArchive } from '../terminal/scrollback/archive';
import type { ArchiveMeta } from '../terminal/scrollback/types';
import { readChunkRange } from '../terminal/scrollback/chunks';
import { ArchivedTerminalEmulator } from '../terminal/archived-emulator';
import { getDefaultColors } from '../terminal/terminal-colors';
import type { TerminalCell, TerminalScrollState } from '../core/types';
import { drainScrollbackOverflow } from '../effect/services/pty/scrollback-archiver';

const DEFAULT_COLS = 136;
const DEFAULT_ROWS = 36;
const DEFAULT_REPAINTS = 8;
const DEFAULT_ITERATIONS = 3;
const DEFAULT_WARMUP_ITERATIONS = 1;
const DEFAULT_SYNTHETIC_ENTRIES = 96;
const DEFAULT_ARCHIVE_WORKLOAD_ROW_LIMIT = 320;
const CLEAR_SCREEN_AND_HOME = '\x1b[2J\x1b[H';
const TMP_PREFIX = 'openmux-pi-redraw-';

type LiveBenchmarkEmulator = ITerminalEmulator & {
  dispose(): void;
  trimScrollback?: (lines: number) => void;
};

export class PiRedrawBenchmarkError extends errore.createTaggedError({
  name: 'PiRedrawBenchmarkError',
  message: 'Pi redraw benchmark $operation failed: $reason',
}) {}

export interface TopRepeatedLine {
  text: string;
  count: number;
}

export interface ArchiveAnalysis {
  metaPath: string;
  totalRows: number;
  nonBlankRows: number;
  uniqueNonBlankRows: number;
  repeatedNonBlankRows: number;
  duplicateRatio: number;
  widestLineChars: number;
  workloadRowsSelected: number;
  topRepeatedLines: TopRepeatedLine[];
}

interface ArchiveAnalysisWithWorkload extends ArchiveAnalysis {
  workloadText: string;
}

export interface BenchmarkScenarioMetrics {
  totalMs: number;
  writeMs: number;
  archiveMs: number;
  archivePasses: number;
  archiveBatches: number;
  archivedLines: number;
  archivedPlacements: number;
  archiveBytes: number;
  liveScrollbackLines: number;
  totalScrollbackLines: number;
  dirtyRowsConsumed: number;
}

interface PiRedrawBenchmarkResult {
  cols: number;
  rows: number;
  repaints: number;
  iterations: number;
  warmupIterations: number;
  hotScrollbackLimit: number;
  workload: {
    kind: 'synthetic' | 'archive' | 'custom';
    description: string;
    bytes: number;
    lines: number;
  };
  archiveAnalysis?: ArchiveAnalysis;
  append: BenchmarkScenarioMetrics;
  repaint: BenchmarkScenarioMetrics;
  repaintOverAppend: number;
}

interface RunPiRedrawBenchmarkOptions {
  cols?: number;
  rows?: number;
  repaints?: number;
  iterations?: number;
  warmupIterations?: number;
  syntheticEntries?: number;
  archiveMetaPath?: string;
  archiveWorkloadRowLimit?: number;
  archiveWindowStart?: number;
  archiveWindowRows?: number;
  workloadText?: string;
}

export function buildSyntheticPiWorkload(options?: { entries?: number }): string {
  const entries = options?.entries ?? DEFAULT_SYNTHETIC_ENTRIES;
  const candidates = [
    'Vu Dinh Hieu',
    'Nguyen Xuan Anh',
    'Pham Duc Thanh',
    'Le Anh Minh',
    'Nguyen Ngo Lap',
    'Vo Hai Bien',
    'Dao Tuan',
    'Vong Tieu Hung',
  ];
  const scenarios = ['Scenario A', 'Scenario B', 'Scenario C'];
  const lines: string[] = [
    'Have a look at our guidelines 2 folders down ../../ . Look at the responses by our contractors in this folder: help me grade them.',
    "There shouldn't be any missing responses, but do note them.",
    "$ python3 - <<'PY'",
    "from pathlib import Path; import re; import json; import textwrap; import statistics; import itertools; print('building transcript-heavy workload')",
  ];

  for (let index = 0; index < entries; index++) {
    const candidate = candidates[index % candidates.length];
    const scenario = scenarios[index % scenarios.length];
    const block = index + 1;
    lines.push(
      `read /tmp/contractor_eval_texts/contractor_declaration__Batch 2__${candidate}__challenge_response_${block}.pdf.txt:${1 + (index % 5) * 40}-${320 + (index % 7) * 12}`
    );
    lines.push(
      `${candidate} | ${scenario} | path=/Users/monotykamary/VCS/working-remote/dwarvesfoundation/discord-role-manager/ranking/contractor_declaration/Batch 2/${candidate.replace(/ /g, '_')}/submission_${block}.pdf | note=Need to reconcile profile declaration, challenge framing, evidence quality, implementation detail, and explicit trade-off coverage before assigning final IC level.`
    );
    lines.push(
      `| ${candidate.padEnd(18)} | provisional=IC${2 + (index % 4)} | evidence=The written response discusses rollout safety, edge cases, migration risk, retry semantics, operational ownership, backward compatibility, and acceptance criteria; the profile narrative mentions shipping across frontend, backend, and QA while coordinating with product, infra, and support under deadline pressure. | gaps=Needs clearer outcomes, stronger metrics, and less repetition in the narrative. |`
    );
    lines.push(
      `The response keeps circling through the same judgment loop for ${candidate}: ask clarifying questions, restate the scenario, propose a simple architecture, add a rollback plan, enumerate failure modes, then compare the chosen option against a thinner implementation that would be easier to operate but weaker on auditability and long-term maintainability.`
    );
    if (index % 3 === 0) {
      lines.push(
        `edit batch2_assessment_table.md:${32 + (index % 11)} :: Replace trailing pipe, tighten the rationale sentence, and preserve the markdown table width even when the row includes long notes about scenario mismatch, lorem ipsum declarations, or challenge sections that were attached as screenshots instead of selectable text.`
      );
    }
    if (index % 4 === 0) {
      lines.push(
        `${candidate} assessment summary => strengths=pragmatic systems thinking; risks=some sections are verbose enough to trigger heavy wrapping in a 136-column terminal; follow-up=verify whether the transcript redraw duplicates the same read output, markdown tables, and path-heavy tool invocations over multiple repaints.`
      );
    }
  }

  lines.push('PY');
  lines.push('Done — synthetic transcript assembled for redraw stress testing.');
  return `${lines.join('\n')}\n`;
}

export function analyzeArchive(options: {
  metaPath: string;
  workloadRowLimit?: number;
}): ArchiveAnalysis | PiRedrawBenchmarkError {
  const workloadRowLimit = options.workloadRowLimit ?? DEFAULT_ARCHIVE_WORKLOAD_ROW_LIMIT;
  const metaResult = readArchiveMeta(options.metaPath);
  if (metaResult instanceof PiRedrawBenchmarkError) {
    return metaResult;
  }

  const rowsResult = collectArchiveRows({
    metaPath: options.metaPath,
    meta: metaResult,
    workloadRowLimit,
  });
  if (rowsResult instanceof PiRedrawBenchmarkError) {
    return rowsResult;
  }

  const { totalRows, nonBlankRows, widestLineChars, frequencies, workloadRows } = rowsResult;
  const uniqueNonBlankRows = frequencies.size;
  const repeatedNonBlankRows = Math.max(0, nonBlankRows - uniqueNonBlankRows);
  const duplicateRatio = nonBlankRows === 0 ? 0 : repeatedNonBlankRows / nonBlankRows;
  const topRepeatedLines = [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return {
    metaPath: options.metaPath,
    totalRows,
    nonBlankRows,
    uniqueNonBlankRows,
    repeatedNonBlankRows,
    duplicateRatio,
    widestLineChars,
    workloadRowsSelected: workloadRows.length,
    topRepeatedLines,
  };
}

function resolveWorkload(options: {
  archiveMetaPath?: string;
  archiveWorkloadRowLimit: number;
  archiveWindowStart?: number;
  archiveWindowRows?: number;
  syntheticEntries: number;
  workloadText?: string;
}):
  | {
      workloadText: string;
      workloadKind: 'synthetic' | 'archive' | 'custom';
      workloadDescription: string;
      archiveAnalysis?: ArchiveAnalysis;
    }
  | PiRedrawBenchmarkError {
  if (options.workloadText) {
    return {
      workloadText: options.workloadText,
      workloadKind: 'custom',
      workloadDescription: 'caller-provided workload',
    };
  }

  if (options.archiveMetaPath) {
    const analysisResult = analyzeArchiveWithWorkload({
      metaPath: options.archiveMetaPath,
      workloadRowLimit: options.archiveWorkloadRowLimit,
      archiveWindowStart: options.archiveWindowStart,
      archiveWindowRows: options.archiveWindowRows,
    });
    if (analysisResult instanceof PiRedrawBenchmarkError) {
      return analysisResult;
    }

    const workloadDescription =
      typeof options.archiveWindowStart === 'number' &&
      typeof options.archiveWindowRows === 'number'
        ? `archive window workload from ${options.archiveMetaPath} [start=${options.archiveWindowStart}, rows=${options.archiveWindowRows}]`
        : `archive-derived workload from ${options.archiveMetaPath}`;

    return {
      workloadText: analysisResult.workloadText,
      workloadKind: 'archive',
      workloadDescription,
      archiveAnalysis: analysisResult,
    };
  }

  return {
    workloadText: buildSyntheticPiWorkload({ entries: options.syntheticEntries }),
    workloadKind: 'synthetic',
    workloadDescription: `synthetic pi transcript (${options.syntheticEntries} entries)`,
  };
}

function analyzeArchiveWithWorkload(options: {
  metaPath: string;
  workloadRowLimit: number;
  archiveWindowStart?: number;
  archiveWindowRows?: number;
}): ArchiveAnalysisWithWorkload | PiRedrawBenchmarkError {
  const metaResult = readArchiveMeta(options.metaPath);
  if (metaResult instanceof PiRedrawBenchmarkError) {
    return metaResult;
  }

  const rowsResult = collectArchiveRows({
    metaPath: options.metaPath,
    meta: metaResult,
    workloadRowLimit: options.workloadRowLimit,
  });
  if (rowsResult instanceof PiRedrawBenchmarkError) {
    return rowsResult;
  }

  const { totalRows, nonBlankRows, widestLineChars, frequencies, rows, workloadRows } = rowsResult;
  const uniqueNonBlankRows = frequencies.size;
  const repeatedNonBlankRows = Math.max(0, nonBlankRows - uniqueNonBlankRows);
  const duplicateRatio = nonBlankRows === 0 ? 0 : repeatedNonBlankRows / nonBlankRows;
  const topRepeatedLines = [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  const selectedRows =
    typeof options.archiveWindowStart === 'number' && typeof options.archiveWindowRows === 'number'
      ? rows.slice(
          Math.max(0, options.archiveWindowStart),
          Math.max(0, options.archiveWindowStart) + Math.max(1, options.archiveWindowRows)
        )
      : workloadRows;

  return {
    metaPath: options.metaPath,
    totalRows,
    nonBlankRows,
    uniqueNonBlankRows,
    repeatedNonBlankRows,
    duplicateRatio,
    widestLineChars,
    workloadRowsSelected: selectedRows.length,
    topRepeatedLines,
    workloadText: `${selectedRows.join('\n')}\n`,
  };
}

function readArchiveMeta(metaPath: string): ArchiveMeta | PiRedrawBenchmarkError {
  const result = errore.try({
    try: () => JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ArchiveMeta,
    catch: (error) =>
      new PiRedrawBenchmarkError({
        operation: 'read-archive-meta',
        reason: String(error),
        cause: error,
      }),
  });
  if (result instanceof PiRedrawBenchmarkError) {
    return result;
  }
  if (result.version !== 1 || !Array.isArray(result.chunks)) {
    return new PiRedrawBenchmarkError({
      operation: 'read-archive-meta',
      reason: `Unsupported archive metadata in ${metaPath}`,
    });
  }
  return result;
}

function collectArchiveRows(options: {
  metaPath: string;
  meta: ArchiveMeta;
  workloadRowLimit: number;
}):
  | {
      totalRows: number;
      nonBlankRows: number;
      widestLineChars: number;
      frequencies: Map<string, number>;
      rows: string[];
      workloadRows: string[];
    }
  | PiRedrawBenchmarkError {
  const rootDir = path.dirname(options.metaPath);
  const frequencies = new Map<string, number>();
  const rowTexts: string[] = [];
  const workloadRows: string[] = [];
  const seenWorkloadRows = new Set<string>();
  let totalRows = 0;
  let nonBlankRows = 0;
  let widestLineChars = 0;
  let chunkStart = 0;

  for (const chunkInfo of options.meta.chunks) {
    const chunkPath = path.join(rootDir, chunkInfo.filename);
    if (!fs.existsSync(chunkPath)) {
      chunkStart += chunkInfo.lineCount;
      continue;
    }

    const chunkRows = readChunkRange(
      {
        ...chunkInfo,
        path: chunkPath,
        startOffsetAtWrite: chunkInfo.startOffsetAtWrite ?? chunkStart,
      },
      chunkStart,
      0,
      chunkInfo.lineCount
    );

    for (const row of chunkRows) {
      totalRows += 1;
      const text = rowToText(row);
      widestLineChars = Math.max(widestLineChars, text.length);
      rowTexts.push(text);
      if (text.length === 0) {
        continue;
      }
      nonBlankRows += 1;
      frequencies.set(text, (frequencies.get(text) ?? 0) + 1);
      if (workloadRows.length < options.workloadRowLimit && !seenWorkloadRows.has(text)) {
        seenWorkloadRows.add(text);
        workloadRows.push(text);
      }
    }

    chunkStart += chunkInfo.lineCount;
  }

  return {
    totalRows,
    nonBlankRows,
    widestLineChars,
    frequencies,
    rows: rowTexts,
    workloadRows,
  };
}

async function runSingleScenarioPair(options: {
  cols: number;
  rows: number;
  repaints: number;
  workloadText: string;
}): Promise<
  | {
      append: BenchmarkScenarioMetrics;
      repaint: BenchmarkScenarioMetrics;
    }
  | PiRedrawBenchmarkError
> {
  const append = await runScenario({
    cols: options.cols,
    rows: options.rows,
    repaints: 1,
    workloadText: options.workloadText,
    clearBeforeEachFrame: false,
  });
  if (append instanceof PiRedrawBenchmarkError) {
    return append;
  }

  const repaint = await runScenario({
    cols: options.cols,
    rows: options.rows,
    repaints: options.repaints,
    workloadText: options.workloadText,
    clearBeforeEachFrame: true,
  });
  if (repaint instanceof PiRedrawBenchmarkError) {
    return repaint;
  }

  return { append, repaint };
}

async function runScenario(options: {
  cols: number;
  rows: number;
  repaints: number;
  workloadText: string;
  clearBeforeEachFrame: boolean;
}): Promise<BenchmarkScenarioMetrics | PiRedrawBenchmarkError> {
  const tempDirResult = errore.try({
    try: () => fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX)),
    catch: (error) =>
      new PiRedrawBenchmarkError({
        operation: 'mkdtemp',
        reason: String(error),
        cause: error,
      }),
  });
  if (tempDirResult instanceof PiRedrawBenchmarkError) {
    return tempDirResult;
  }

  const tempDir = tempDirResult;
  const liveResult = await createLiveBenchmarkEmulator({
    cols: options.cols,
    rows: options.rows,
  });
  if (liveResult instanceof PiRedrawBenchmarkError) {
    return liveResult;
  }

  const live = liveResult;
  const archive = new ScrollbackArchive({
    rootDir: tempDir,
    maxBytes: 512 * 1024 * 1024,
  });
  const emulator = new ArchivedTerminalEmulator(live, archive);

  let writeMs = 0;
  let archiveMs = 0;
  let archivePasses = 0;
  let archiveBatches = 0;
  let archivedLines = 0;
  let archivedPlacements = 0;
  let dirtyRowsConsumed = 0;
  const start = performance.now();

  try {
    for (let index = 0; index < options.repaints; index++) {
      const frame = options.clearBeforeEachFrame
        ? `${CLEAR_SCREEN_AND_HOME}${options.workloadText}`
        : options.workloadText;

      const writeStart = performance.now();
      live.write(frame);
      const update = emulator.getDirtyUpdate(makeScrollState(emulator, live));
      writeMs += performance.now() - writeStart;
      dirtyRowsConsumed += update.isFull
        ? (update.fullState?.rows ?? update.rows)
        : update.dirtyRows.size;

      const archiveStart = performance.now();
      const drainResult = await settleArchive({ archive, live });
      if (drainResult instanceof PiRedrawBenchmarkError) {
        return drainResult;
      }
      archiveMs += performance.now() - archiveStart;
      archivePasses += drainResult.passes;
      archiveBatches += drainResult.batches;
      archivedLines += drainResult.linesArchived;
      archivedPlacements += drainResult.placementsArchived;
    }

    const totalMs = performance.now() - start;
    return {
      totalMs,
      writeMs,
      archiveMs,
      archivePasses,
      archiveBatches,
      archivedLines,
      archivedPlacements,
      archiveBytes: archive.bytes,
      liveScrollbackLines: live.getScrollbackLength(),
      totalScrollbackLines: archive.length + live.getScrollbackLength(),
      dirtyRowsConsumed,
    };
  } catch (error) {
    return new PiRedrawBenchmarkError({
      operation: 'run-scenario',
      reason: String(error),
      cause: error,
    });
  } finally {
    live.dispose();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('[pi-redraw-harness] Failed to clean temp dir:', error);
    }
  }
}

async function settleArchive(options: {
  archive: ScrollbackArchive;
  live: LiveBenchmarkEmulator;
}): Promise<
  | {
      passes: number;
      batches: number;
      linesArchived: number;
      placementsArchived: number;
    }
  | PiRedrawBenchmarkError
> {
  let passes = 0;
  let batches = 0;
  let linesArchived = 0;
  let placementsArchived = 0;

  while (true) {
    const result = await drainScrollbackOverflow({
      scrollbackArchive: options.archive,
      liveEmulator: options.live,
    }).catch(
      (error) =>
        new PiRedrawBenchmarkError({
          operation: 'drain-scrollback-overflow',
          reason: String(error),
          cause: error,
        })
    );

    if (result instanceof PiRedrawBenchmarkError) {
      return result;
    }

    passes += 1;
    batches += result.batches;
    linesArchived += result.linesArchived;
    placementsArchived += result.placementsArchived;

    if (result.remainingOverflow <= 0 || result.batches === 0) {
      return { passes, batches, linesArchived, placementsArchived };
    }
  }
}

async function createLiveBenchmarkEmulator(options: {
  cols: number;
  rows: number;
}): Promise<LiveBenchmarkEmulator | PiRedrawBenchmarkError> {
  primeGhosttyLibraryEnv();

  const moduleResult = await import('../terminal/ghostty-vt/emulator').catch(
    (error) =>
      new PiRedrawBenchmarkError({
        operation: 'load-ghostty-emulator',
        reason: String(error),
        cause: error,
      })
  );
  if (moduleResult instanceof PiRedrawBenchmarkError) {
    return moduleResult;
  }

  const emulatorResult = errore.try({
    try: () =>
      moduleResult.createGhosttyVTEmulator(
        options.cols,
        options.rows,
        getDefaultColors()
      ) as LiveBenchmarkEmulator,
    catch: (error) =>
      new PiRedrawBenchmarkError({
        operation: 'create-ghostty-emulator',
        reason: String(error),
        cause: error,
      }),
  });
  return emulatorResult;
}

function primeGhosttyLibraryEnv(): void {
  if (process.env.GHOSTTY_VT_LIB) {
    return;
  }

  const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  const moduleDir = path.dirname(Bun.fileURLToPath(import.meta.url));
  const repoRoot = path.join(moduleDir, '..', '..');
  const candidates = [
    path.join(repoRoot, 'native', 'zig-ghostty-wrapper', 'zig-out', 'lib', `libghostty-vt.${ext}`),
    path.join(
      process.cwd(),
      'native',
      'zig-ghostty-wrapper',
      'zig-out',
      'lib',
      `libghostty-vt.${ext}`
    ),
    path.join(repoRoot, 'dist', `libghostty-vt.${ext}`),
    path.join(process.cwd(), 'dist', `libghostty-vt.${ext}`),
    path.join(repoRoot, `libghostty-vt.${ext}`),
    path.join(process.cwd(), `libghostty-vt.${ext}`),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    process.env.GHOSTTY_VT_LIB = candidate;
    return;
  }
}

function makeScrollState(
  emulator: ArchivedTerminalEmulator,
  live: LiveBenchmarkEmulator
): TerminalScrollState {
  return {
    viewportOffset: 0,
    scrollbackLength: emulator.getScrollbackLength(),
    isAtBottom: true,
    isAtScrollbackLimit: live.getScrollbackLength() >= HOT_SCROLLBACK_LIMIT,
  };
}

function aggregateScenarioMetrics(samples: BenchmarkScenarioMetrics[]): BenchmarkScenarioMetrics {
  return {
    totalMs: median(samples.map((sample) => sample.totalMs)),
    writeMs: median(samples.map((sample) => sample.writeMs)),
    archiveMs: median(samples.map((sample) => sample.archiveMs)),
    archivePasses: median(samples.map((sample) => sample.archivePasses)),
    archiveBatches: median(samples.map((sample) => sample.archiveBatches)),
    archivedLines: median(samples.map((sample) => sample.archivedLines)),
    archivedPlacements: median(samples.map((sample) => sample.archivedPlacements)),
    archiveBytes: median(samples.map((sample) => sample.archiveBytes)),
    liveScrollbackLines: median(samples.map((sample) => sample.liveScrollbackLines)),
    totalScrollbackLines: median(samples.map((sample) => sample.totalScrollbackLines)),
    dirtyRowsConsumed: median(samples.map((sample) => sample.dirtyRowsConsumed)),
  };
}

function rowToText(row: TerminalCell[]): string {
  const raw = row.map((cell) => cell?.char ?? ' ').join('');
  return raw.trimEnd();
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
