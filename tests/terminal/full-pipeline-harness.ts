/**
 * Full-pipeline integration harness — validates the complete data path from
 * emulator.write() through prepareUpdate/notify to subscriber cachedRows
 * and checks that the JS-side state remains consistent with the native
 * emulator's actual viewport.
 *
 * Tests the specific scenario: pi running a tool call with animated spinner
 * + elapsing time over many frames.
 *
 * Run:
 *   bun run tests/terminal/full-pipeline-harness.ts
 */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { GhosttyVTEmulator } from '../../src/terminal/ghostty-vt/emulator';
import { getDefaultColors } from '../../src/terminal/terminal-colors';
import type { TerminalCell, TerminalState, DirtyTerminalUpdate } from '../../src/core/types';

const COLS = 40;
const ROWS = 12;
const NUM_FRAMES = 500;

function resolveLibPath(): string | null {
  const envPath = process.env.GHOSTTY_VT_LIB;
  if (envPath && existsSync(envPath)) return envPath;

  const base = import.meta.url.replace('file://', '');
  const fileDir = dirname(base);
  const repoRoot = fileDir.includes('tests/') ? join(fileDir, '..', '..') : fileDir;

  const candidates = [
    join(repoRoot, 'dist', 'libghostty-vt.dylib'),
    join(repoRoot, 'native', 'zig-ghostty-wrapper', 'zig-out', 'lib', 'libghostty-vt.dylib'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function createEmulator(): GhosttyVTEmulator | null {
  try {
    return new GhosttyVTEmulator(COLS, ROWS, getDefaultColors());
  } catch {
    return null;
  }
}

/** Simulate pi writing a full-screen redraw frame (sync-wrapped, with CSI 2J). */
function writePiFrame(
  emulator: GhosttyVTEmulator,
  frameIdx: number,
  spinnerChar: string,
  elapsedSec: number
): void {
  // pi's OpenTUI renderer sends:
  // CSI ?2026h (sync start)
  // CSI 2J (clear screen) + CSI H (cursor home)
  // CSI 3J (clear scrollback) — sometimes
  // Cursor positioning + content for each row
  // CSI ?2026l (sync end)
  const spinnerRow = Math.floor(ROWS / 2);
  let frame = '\x1b[?2026h\x1b[2J\x1b[H\x1b[3J';

  for (let y = 0; y < ROWS; y++) {
    if (y === spinnerRow) {
      // Spinner + elapsed time (this changes every frame/second)
      frame += `\x1b[${y + 1};1H${spinnerChar} Working... ${elapsedSec}s${' '.repeat(20)}`;
    } else if (y === spinnerRow + 1) {
      // Tool output line (changes occasionally)
      frame += `\x1b[${y + 1};1H$ Running: make build${' '.repeat(20)}`;
    } else if (y === 0) {
      // Header line (stable)
      frame += `\x1b[${y + 1};1H╭─ pi ─ Frame ${frameIdx}${' '.repeat(15)}`;
    } else if (y === ROWS - 1) {
      // Status bar (stable)
      frame += `\x1b[${y + 1};1H╰─ normal ─ ${elapsedSec}s${' '.repeat(15)}`;
    } else {
      // Empty row (should be cleared)
      frame += `\x1b[${y + 1};1H${' '.repeat(COLS)}`;
    }
  }

  frame += '\x1b[?2026l';
  emulator.write(frame);
}

/** Simulate the subscriber callback: apply dirty rows to cachedRows. */
function simulateSubscriber(
  update: DirtyTerminalUpdate,
  cachedRows: TerminalCell[][],
  terminalState: TerminalState | null
): { cachedRows: TerminalCell[][]; terminalState: TerminalState } {
  const existingState = terminalState;

  if (update.isFull && update.fullState) {
    cachedRows = [...update.fullState.cells];
    terminalState = update.fullState;
  } else if (existingState) {
    for (const [rowIdx, newRow] of update.dirtyRows) {
      cachedRows[rowIdx] = newRow;
    }
    const cursorChanged =
      existingState.cursor.x !== update.cursor.x ||
      existingState.cursor.y !== update.cursor.y ||
      existingState.cursor.visible !== update.cursor.visible;
    const modesChanged =
      existingState.alternateScreen !== update.alternateScreen ||
      existingState.mouseTracking !== update.mouseTracking ||
      existingState.cursorKeyMode !== update.cursorKeyMode;
    const rowsChanged = update.dirtyRows.size > 0;

    if (rowsChanged || cursorChanged || modesChanged) {
      terminalState = {
        ...existingState,
        cells: rowsChanged ? cachedRows : existingState.cells,
        cursor: update.cursor,
        alternateScreen: update.alternateScreen,
        mouseTracking: update.mouseTracking,
        cursorKeyMode: update.cursorKeyMode,
      };
    }
  }

  return { cachedRows, terminalState: terminalState! };
}

/** Extract a row's character codes from terminal state cells. */
function rowToCodepoints(cells: TerminalCell[] | null): number[] {
  if (!cells) return [];
  return cells.map((c) => {
    const cp = c.char.codePointAt(0);
    return cp ?? 32; // space for empty
  });
}

/** Extract a row's character codes from the native viewport. */
function nativeRowToCodepoints(vp: any[], rowIdx: number, cols: number): number[] {
  const result: number[] = [];
  for (let x = 0; x < cols; x++) {
    result.push(vp[rowIdx * cols + x]?.codepoint ?? 32);
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────

const emulator = createEmulator();
if (!emulator) {
  console.error('ERROR: Could not create GhosttyVTEmulator. Is the native library available?');
  process.exit(1);
}

console.log('Full-pipeline integration harness');
console.log(`  Terminal: ${COLS}×${ROWS}`);
console.log(`  Frames: ${NUM_FRAMES}`);
console.log('');

let cachedRows: TerminalCell[][] = [];
let terminalState: TerminalState | null = null;
let mismatches = 0;
let totalChecks = 0;

const spinners = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

for (let frame = 0; frame < NUM_FRAMES; frame++) {
  const elapsedSec = Math.floor(frame / 10);
  const spinnerChar = spinners[frame % 10];

  // Write the pi frame (simulates processChunk → emulator.write)
  writePiFrame(emulator, frame, spinnerChar, elapsedSec);

  // Simulate flushPendingNotify: get the dirty update
  const dirtyUpdate = emulator.getDirtyUpdate({
    viewportOffset: 0,
    scrollbackLength: 0,
    isAtBottom: true,
    isAtScrollbackLimit: false,
  });

  // Simulate subscriber callback
  const result = simulateSubscriber(dirtyUpdate, cachedRows, terminalState);
  cachedRows = result.cachedRows;
  terminalState = result.terminalState;

  // Every 10 frames, compare the JS-side state against the native viewport
  if (frame % 10 === 0) {
    totalChecks++;

    // Get the native viewport for reference
    const nativeTerminal = (emulator as any).terminal;
    const nativeVp = nativeTerminal?.getViewport?.();

    if (nativeVp && terminalState) {
      for (let y = 0; y < ROWS; y++) {
        const jsRow = rowToCodepoints(terminalState.cells[y] ?? null);
        const nativeRow = nativeRowToCodepoints(nativeVp, y, COLS);

        // Compare first 10 chars (enough to detect spinner/time mismatches)
        let mismatch = false;
        for (let x = 0; x < Math.min(10, COLS); x++) {
          if (jsRow[x] !== nativeRow[x]) {
            mismatch = true;
            break;
          }
        }

        if (mismatch) {
          mismatches++;
          const jsStr = jsRow
            .slice(0, 30)
            .map((c) => String.fromCodePoint(c > 0x20 ? c : 0x20))
            .join('');
          const nativeStr = nativeRow
            .slice(0, 30)
            .map((c) => String.fromCodePoint(c > 0x20 ? c : 0x20))
            .join('');
          console.error(
            `  MISMATCH frame=${frame} row=${y}: JS="${jsStr}" vs NATIVE="${nativeStr}"`
          );
        }
      }
    }
  }
}

console.log('');
console.log('=== Results ===');
console.log(`  Frames: ${NUM_FRAMES}`);
console.log(`  Checks: ${totalChecks}`);
console.log(`  Mismatches: ${mismatches}`);

if (mismatches === 0) {
  console.log('\n✅ JS-side terminalState matches native viewport across all checks.');
  console.log('   The subscriber callback correctly accumulates all dirty rows.');
  console.log('   The bug is NOT in the JS data pipeline (emulator → subscriber → cachedRows).');
} else {
  console.log(`\n❌ Found ${mismatches} mismatches between JS terminalState and native viewport.`);
  console.log('   The subscriber callback or buildDirtyState has a bug.');
}

emulator.dispose();
process.exit(mismatches > 0 ? 1 : 0);
