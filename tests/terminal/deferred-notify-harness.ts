/**
 * Deferred-notify harness — validates that the emulator's onUpdate notification
 * system correctly delivers dirty rows to the subscriber, including during
 * burst writes (simulating pi's 10fps tool-call animation).
 *
 * This tests the same data pipeline as full-pipeline-harness but uses the
 * ACTUAL deferred notification system (queueMicrotask / setTimeout) instead
 * of calling getDirtyUpdate() directly. This catches bugs in the scheduling
 * layer that the direct-call test wouldn't find.
 *
 * Run:
 *   bun run tests/terminal/deferred-notify-harness.ts
 */
import { GhosttyVTEmulator } from '../../src/terminal/ghostty-vt/emulator';
import { getDefaultColors } from '../../src/terminal/terminal-colors';
import type { TerminalCell, TerminalState, DirtyTerminalUpdate } from '../../src/core/types';

const COLS = 40;
const ROWS = 12;
const NUM_FRAMES = 200;

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
  const spinnerRow = Math.floor(ROWS / 2);
  let frame = '\x1b[?2026h\x1b[2J\x1b[H\x1b[3J';

  for (let y = 0; y < ROWS; y++) {
    if (y === spinnerRow) {
      frame += `\x1b[${y + 1};1H${spinnerChar} Working... ${elapsedSec}s${' '.repeat(20)}`;
    } else if (y === spinnerRow + 1) {
      frame += `\x1b[${y + 1};1H$ Running: make build${' '.repeat(20)}`;
    } else if (y === 0) {
      frame += `\x1b[${y + 1};1H╭─ pi ─ Frame ${frameIdx}${' '.repeat(15)}`;
    } else if (y === ROWS - 1) {
      frame += `\x1b[${y + 1};1H╰─ normal ─ ${elapsedSec}s${' '.repeat(15)}`;
    } else {
      frame += `\x1b[${y + 1};1H${' '.repeat(COLS)}`;
    }
  }

  frame += '\x1b[?2026l';
  emulator.write(frame);
}

// ── Main ──────────────────────────────────────────────────────────────────

const emulator = createEmulator();
if (!emulator) {
  console.error('ERROR: Could not create GhosttyVTEmulator.');
  process.exit(1);
}

let cachedRows: TerminalCell[][] = [];
let terminalState: TerminalState | null = null;
let notifyCount = 0;
let mismatches = 0;
let totalChecks = 0;

const spinners = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

// Register the onUpdate callback (same as the subscriber)
emulator.onUpdate(() => {
  notifyCount++;

  const dirtyUpdate = emulator.getDirtyUpdate({
    viewportOffset: 0,
    scrollbackLength: 0,
    isAtBottom: true,
    isAtScrollbackLimit: false,
  });

  const existingState = terminalState;
  if (dirtyUpdate.isFull && dirtyUpdate.fullState) {
    cachedRows = [...dirtyUpdate.fullState.cells];
    terminalState = dirtyUpdate.fullState;
  } else if (existingState) {
    for (const [rowIdx, newRow] of dirtyUpdate.dirtyRows) {
      cachedRows[rowIdx] = newRow;
    }
    const cursorChanged =
      existingState.cursor.x !== dirtyUpdate.cursor.x ||
      existingState.cursor.y !== dirtyUpdate.cursor.y ||
      existingState.cursor.visible !== dirtyUpdate.cursor.visible;
    const modesChanged =
      existingState.alternateScreen !== dirtyUpdate.alternateScreen ||
      existingState.mouseTracking !== dirtyUpdate.mouseTracking ||
      existingState.cursorKeyMode !== dirtyUpdate.cursorKeyMode;
    const rowsChanged = dirtyUpdate.dirtyRows.size > 0;

    if (rowsChanged || cursorChanged || modesChanged) {
      terminalState = {
        ...existingState,
        cells: rowsChanged ? cachedRows : existingState.cells,
        cursor: dirtyUpdate.cursor,
        alternateScreen: dirtyUpdate.alternateScreen,
        mouseTracking: dirtyUpdate.mouseTracking,
        cursorKeyMode: dirtyUpdate.cursorKeyMode,
      };
    }
  }
});

function rowToCodepoints(cells: TerminalCell[] | null): number[] {
  if (!cells) return [];
  return cells.map((c) => c.char.codePointAt(0) ?? 32);
}

function nativeRowToCodepoints(vp: any[], rowIdx: number, cols: number): number[] {
  const result: number[] = [];
  for (let x = 0; x < cols; x++) {
    result.push(vp[rowIdx * cols + x]?.codepoint ?? 32);
  }
  return result;
}

// Phase 1: Write frames and let deferred notifications fire
console.log('Phase 1: Writing frames with deferred notification');
console.log(`  Frames: ${NUM_FRAMES}`);

for (let frame = 0; frame < NUM_FRAMES; frame++) {
  const elapsedSec = Math.floor(frame / 10);
  const spinnerChar = spinners[frame % 10];

  // Write the pi frame
  writePiFrame(emulator, frame, spinnerChar, elapsedSec);

  // Flush the pending notification synchronously (like the render callback does)
  emulator.flushPendingNotify?.();

  // Every 20 frames, compare the JS-side state against the native viewport
  if (frame % 20 === 0 && terminalState) {
    totalChecks++;

    const nativeTerminal = (emulator as any).terminal;
    const nativeVp = nativeTerminal?.getViewport?.();

    if (nativeVp) {
      for (let y = 0; y < ROWS; y++) {
        const jsRow = rowToCodepoints(terminalState.cells[y] ?? null);
        const nativeRow = nativeRowToCodepoints(nativeVp, y, COLS);

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
            .slice(0, 25)
            .map((c) => String.fromCodePoint(c > 0x20 ? c : 0x20))
            .join('');
          const nativeStr = nativeRow
            .slice(0, 25)
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

// Phase 2: Write a burst of frames without flushing (simulate rapid writes
// between render frames, then flush all at once)
console.log('\nPhase 2: Burst writes without intermediate flush');

let burstMismatches = 0;
for (let burst = 0; burst < 50; burst++) {
  // Write 5 frames in quick succession (like high-FPS pi output)
  for (let i = 0; i < 5; i++) {
    const frame = NUM_FRAMES + burst * 5 + i;
    const elapsedSec = Math.floor(frame / 10);
    writePiFrame(emulator, frame, spinners[frame % 10], elapsedSec);
    // DO NOT flush between writes — let the deferred notify coalesce
  }

  // Now flush all at once (like the render callback)
  emulator.flushPendingNotify?.();

  // Compare
  if (terminalState) {
    totalChecks++;
    const nativeTerminal = (emulator as any).terminal;
    const nativeVp = nativeTerminal?.getViewport?.();

    if (nativeVp) {
      for (let y = 0; y < ROWS; y++) {
        const jsRow = rowToCodepoints(terminalState.cells[y] ?? null);
        const nativeRow = nativeRowToCodepoints(nativeVp, y, COLS);

        let mismatch = false;
        for (let x = 0; x < Math.min(10, COLS); x++) {
          if (jsRow[x] !== nativeRow[x]) {
            mismatch = true;
            break;
          }
        }

        if (mismatch) {
          burstMismatches++;
        }
      }
    }
  }
}

mismatches += burstMismatches;

console.log('');
console.log('=== Results ===');
console.log(`  Notifications received: ${notifyCount}`);
console.log(`  Total checks: ${totalChecks}`);
console.log(`  Mismatches: ${mismatches}`);

if (mismatches === 0) {
  console.log('\n✅ JS-side terminalState matches native viewport across all phases.');
  console.log('   The deferred notification + subscriber pipeline is correct.');
  console.log('   The bug must be in the RENDER or SCROLLBACK layer, not the data pipeline.');
} else {
  console.log(`\n❌ Found ${mismatches} mismatches.`);
}

emulator.dispose();
process.exit(mismatches > 0 ? 1 : 0);
