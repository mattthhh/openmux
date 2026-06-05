/**
 * Dirty-state harness — validates isRowDirty() against viewport diff.
 *
 * Uses direct FFI to the native libghostty-vt library to avoid module
 * path resolution issues in the bun:test runner.
 *
 * Run:
 *   bun run tests/terminal/dirty-state-harness.ts
 *
 * Or with bun:test integration:
 *   bun test tests/terminal/dirty-state-harness.test.ts
 */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const COLS = 40;
const ROWS = 12;

// Resolve the library path
function resolveLibPath(): string | null {
  const envPath = process.env.GHOSTTY_VT_LIB;
  if (envPath && existsSync(envPath)) return envPath;

  const base = import.meta.url.replace('file://', '');
  const fileDir = dirname(base);
  const repoRoot = fileDir.includes('tests/') ? join(fileDir, '..', '..') : fileDir;

  const candidates = [
    join(repoRoot, 'native', 'zig-ghostty-wrapper', 'zig-out', 'lib', 'libghostty-vt.dylib'),
    join(repoRoot, 'dist', 'libghostty-vt.dylib'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const libPath = resolveLibPath();

interface LibGhostty {
  terminalNew: (cols: number, rows: number) => number;
  terminalFree: (handle: number) => void;
  terminalWrite: (handle: number, data: Buffer) => void;
  terminalResize: (handle: number, cols: number, rows: number) => void;
  stateUpdate: (handle: number) => number;
  stateIsRowDirty: (handle: number, y: number) => boolean;
  stateMarkClean: (handle: number) => void;
  stateGetViewport: (handle: number, buf: Buffer, size: number) => number;
  stateGetCursorX: (handle: number) => number;
  stateGetCursorY: (handle: number) => number;
  stateGetCursorVisible: (handle: number) => boolean;
  stateGetCols: (handle: number) => number;
  stateGetRows: (handle: number) => number;
}

function loadLib(): LibGhostty | null {
  if (!libPath) return null;

  try {
    const lib = dlopen(libPath, {
      ghostty_terminal_new: { args: [FFIType.i32, FFIType.i32], returns: FFIType.pointer },
      ghostty_terminal_free: { args: [FFIType.pointer], returns: FFIType.void },
      ghostty_terminal_write: {
        args: [FFIType.pointer, FFIType.pointer, FFIType.i32],
        returns: FFIType.void,
      },
      ghostty_terminal_resize: {
        args: [FFIType.pointer, FFIType.i32, FFIType.i32],
        returns: FFIType.void,
      },
      ghostty_render_state_update: { args: [FFIType.pointer], returns: FFIType.i32 },
      ghostty_render_state_is_row_dirty: {
        args: [FFIType.pointer, FFIType.i32],
        returns: FFIType.bool,
      },
      ghostty_render_state_mark_clean: { args: [FFIType.pointer], returns: FFIType.void },
      ghostty_render_state_get_viewport: {
        args: [FFIType.pointer, FFIType.pointer, FFIType.i32],
        returns: FFIType.i32,
      },
      ghostty_render_state_get_cursor_x: { args: [FFIType.pointer], returns: FFIType.i32 },
      ghostty_render_state_get_cursor_y: { args: [FFIType.pointer], returns: FFIType.i32 },
      ghostty_render_state_get_cursor_visible: { args: [FFIType.pointer], returns: FFIType.bool },
      ghostty_render_state_get_cols: { args: [FFIType.pointer], returns: FFIType.i32 },
      ghostty_render_state_get_rows: { args: [FFIType.pointer], returns: FFIType.i32 },
    });

    const enc = new TextEncoder();

    return {
      terminalNew: (cols, rows) => Number(lib.symbols.ghostty_terminal_new(cols, rows)),
      terminalFree: (h) => lib.symbols.ghostty_terminal_free(h as any),
      terminalWrite: (h, data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        lib.symbols.ghostty_terminal_write(h as any, ptr(buf) as any, buf.length);
      },
      terminalResize: (h, cols, rows) => lib.symbols.ghostty_terminal_resize(h as any, cols, rows),
      stateUpdate: (h) => lib.symbols.ghostty_render_state_update(h as any) as number,
      stateIsRowDirty: (h, y) =>
        lib.symbols.ghostty_render_state_is_row_dirty(h as any, y) as boolean,
      stateMarkClean: (h) => lib.symbols.ghostty_render_state_mark_clean(h as any),
      stateGetViewport: (h, buf, size) =>
        lib.symbols.ghostty_render_state_get_viewport(h as any, ptr(buf) as any, size) as number,
      stateGetCursorX: (h) => lib.symbols.ghostty_render_state_get_cursor_x(h as any) as number,
      stateGetCursorY: (h) => lib.symbols.ghostty_render_state_get_cursor_y(h as any) as number,
      stateGetCursorVisible: (h) =>
        lib.symbols.ghostty_render_state_get_cursor_visible(h as any) as boolean,
      stateGetCols: (h) => lib.symbols.ghostty_render_state_get_cols(h as any) as number,
      stateGetRows: (h) => lib.symbols.ghostty_render_state_get_rows(h as any) as number,
    };
  } catch {
    return null;
  }
}

const CELL_SIZE = 16;

interface CellData {
  codepoint: number;
  fg_r: number;
  fg_g: number;
  fg_b: number;
  bg_r: number;
  bg_g: number;
  bg_b: number;
  flags: number;
  width: number;
}

function parseViewport(buf: Buffer, count: number, cols: number): CellData[][] {
  const rows: CellData[][] = [];
  for (let y = 0; y < Math.ceil(count / cols); y++) {
    const row: CellData[] = [];
    for (let x = 0; x < cols && y * cols + x < count; x++) {
      const offset = (y * cols + x) * CELL_SIZE;
      const view = new DataView(buf.buffer, buf.byteOffset + offset, CELL_SIZE);
      row.push({
        codepoint: view.getUint32(0, true),
        fg_r: view.getUint8(4),
        fg_g: view.getUint8(5),
        fg_b: view.getUint8(6),
        bg_r: view.getUint8(8),
        bg_g: view.getUint8(9),
        bg_b: view.getUint8(10),
        flags: view.getUint8(12),
        width: view.getUint8(13),
      });
    }
    rows.push(row);
  }
  return rows;
}

function snapshotCodepoints(lib: LibGhostty, h: number, cols: number, rows: number): number[][] {
  const totalCells = cols * rows;
  const buf = Buffer.alloc(totalCells * CELL_SIZE);
  const count = lib.stateGetViewport(h, buf, totalCells);
  const parsed = parseViewport(buf, count, cols);
  return parsed.map((row) => row.map((c) => c.codepoint));
}

function diffRows(before: number[][], after: number[][]): Set<number> {
  const changed = new Set<number>();
  const rows = Math.min(before.length, after.length);
  for (let y = 0; y < rows; y++) {
    const cols = Math.min(before[y].length, after[y].length);
    for (let x = 0; x < cols; x++) {
      if (before[y][x] !== after[y][x]) {
        changed.add(y);
        break;
      }
    }
  }
  return changed;
}

interface CheckResult {
  dirtyState: number;
  isRowDirtyResults: boolean[];
  actuallyChangedRows: Set<number>;
  missedRows: Set<number>;
}

function checkDirty(
  lib: LibGhostty,
  h: number,
  cols: number,
  rows: number,
  writeFn: (lib: LibGhostty, h: number) => void
): CheckResult {
  const before = snapshotCodepoints(lib, h, cols, rows);
  writeFn(lib, h);
  const dirtyState = lib.stateUpdate(h);
  const after = snapshotCodepoints(lib, h, cols, rows);

  const isRowDirtyResults: boolean[] = [];
  for (let y = 0; y < rows; y++) {
    isRowDirtyResults.push(lib.stateIsRowDirty(h, y));
  }

  const actuallyChangedRows = diffRows(before, after);
  const missedRows = new Set<number>();
  for (const y of actuallyChangedRows) {
    if (!isRowDirtyResults[y]) missedRows.add(y);
  }

  lib.stateMarkClean(h);
  return { dirtyState, isRowDirtyResults, actuallyChangedRows, missedRows };
}

// Run the harness
const lib = loadLib();
if (!lib) {
  console.error(
    'ERROR: Could not load libghostty-vt. Set GHOSTTY_VT_LIB or build the native library.'
  );
  process.exit(1);
}

let totalChecks = 0;
let totalMisses = 0;

function runCheck(
  name: string,
  h: number,
  cols: number,
  rows: number,
  writeFn: (lib: LibGhostty, h: number) => void
): CheckResult {
  totalChecks++;
  const result = checkDirty(lib, h, cols, rows, writeFn);
  if (result.missedRows.size > 0) {
    totalMisses++;
    console.error(
      `FAIL [${name}]: isRowDirty missed rows ${[...result.missedRows]} (dirty state: ${result.dirtyState}, changed rows: ${[...result.actuallyChangedRows]})`
    );
  } else {
    console.log(
      `PASS [${name}]: ${result.actuallyChangedRows.size} rows changed, all detected (dirty state: ${result.dirtyState})`
    );
  }
  return result;
}

function writeString(lib: LibGhostty, h: number, s: string) {
  lib.terminalWrite(h, Buffer.from(s));
}

console.log(`\n=== Dirty-state harness: isRowDirty vs viewport diff ===\n`);
console.log(`Library: ${libPath}`);

// Test 1: Simple text write
{
  const h = lib.terminalNew(COLS, ROWS);
  runCheck('simple text write', h, COLS, ROWS, (l, h) => writeString(l, h, 'Hello, world!'));
  lib.terminalFree(h);
}

// Test 2: Pi-style frame (sync mode + cursor positioning)
{
  const h = lib.terminalNew(COLS, ROWS);
  runCheck('pi-style frame', h, COLS, ROWS, (l, h) => {
    writeString(l, h, '\x1b[?2026h\x1b[1;1H\x1b[2J\x1b[3J');
    for (let y = 0; y < ROWS; y++) {
      writeString(l, h, `\x1b[${y + 1};1HRow ${y}: content here            `);
    }
    writeString(l, h, '\x1b[?2026l');
  });
  lib.terminalFree(h);
}

// Test 3: Stress - 1000 sequential writes
{
  const h = lib.terminalNew(COLS, ROWS);
  let misses = 0;
  for (let i = 0; i < 1000; i++) {
    const r = checkDirty(lib, h, COLS, ROWS, (l, h) => {
      writeString(l, h, `\x1b[1;1HIter ${i.toString().padEnd(30)}  `);
      const targetRow = (i % (ROWS - 1)) + 1;
      writeString(l, h, `\x1b[${targetRow + 1};1HMod ${i.toString().padEnd(30)}  `);
    });
    if (r.missedRows.size > 0) {
      misses++;
      console.error(`  MISS at iter ${i}: rows ${[...r.missedRows]}`);
    }
  }
  totalChecks++;
  if (misses > 0) {
    totalMisses++;
    console.error(`FAIL [1000 sequential writes]: ${misses}/1000 iterations had missed rows`);
  } else {
    console.log(`PASS [1000 sequential writes]: all iterations clean`);
  }
  lib.terminalFree(h);
}

// Test 4: Stress - 100 pi-style frames
{
  const h = lib.terminalNew(COLS, ROWS);
  let misses = 0;
  for (let frame = 0; frame < 100; frame++) {
    const r = checkDirty(lib, h, COLS, ROWS, (l, h) => {
      writeString(l, h, '\x1b[?2026h\x1b[1;1H\x1b[2J\x1b[3J');
      for (let y = 0; y < ROWS; y++) {
        const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[frame % 10];
        writeString(l, h, `\x1b[${y + 1};1H${spinner} Frame ${frame} Row ${y}          `);
      }
      writeString(l, h, '\x1b[?2026l');
    });
    if (r.missedRows.size > 0) {
      misses++;
      console.error(`  MISS at frame ${frame}: rows ${[...r.missedRows]}`);
    }
  }
  totalChecks++;
  if (misses > 0) {
    totalMisses++;
    console.error(`FAIL [100 pi frames]: ${misses}/100 frames had missed rows`);
  } else {
    console.log(`PASS [100 pi frames]: all frames clean`);
  }
  lib.terminalFree(h);
}

// Test 5: Resize + reflow
{
  const h = lib.terminalNew(COLS, ROWS);
  // Fill with content
  for (let y = 0; y < ROWS; y++) writeString(lib, h, `Row ${y}: initial content\n`);
  lib.stateUpdate(h);
  lib.stateMarkClean(h);

  let misses = 0;
  for (let frame = 0; frame < 50; frame++) {
    const newCols = frame % 2 === 0 ? COLS - 2 : COLS;
    const newRows = frame % 2 === 0 ? ROWS - 1 : ROWS;

    const before = snapshotCodepoints(lib, h, newCols, newRows);
    lib.terminalResize(h, newCols, newRows);
    const dirtyState = lib.stateUpdate(h);
    const after = snapshotCodepoints(lib, h, newCols, newRows);
    const changedRows = diffRows(before, after);

    for (const y of changedRows) {
      if (y < newRows && !lib.stateIsRowDirty(h, y)) {
        misses++;
        console.error(`  MISS at resize frame ${frame}: row ${y}`);
      }
    }

    lib.stateMarkClean(h);

    // Restore
    lib.terminalResize(h, COLS, ROWS);
    lib.stateUpdate(h);
    lib.stateMarkClean(h);
    writeString(lib, h, `\x1b[HFrame ${frame} content`);
    lib.stateUpdate(h);
    lib.stateMarkClean(h);
  }
  totalChecks++;
  if (misses > 0) {
    totalMisses++;
    console.error(`FAIL [resize+reflow]: ${misses} missed rows across 50 resize cycles`);
  } else {
    console.log(`PASS [resize+reflow]: all resize cycles clean`);
  }
  lib.terminalFree(h);
}

// Test 6: Alternate screen switch
{
  const h = lib.terminalNew(COLS, ROWS);
  for (let y = 0; y < ROWS; y++) writeString(lib, h, `Primary row ${y}\n`);
  lib.stateUpdate(h);
  lib.stateMarkClean(h);

  let misses = 0;

  // Enter alternate
  {
    const before = snapshotCodepoints(lib, h, COLS, ROWS);
    writeString(lib, h, '\x1b[?1049h');
    lib.stateUpdate(h);
    const after = snapshotCodepoints(lib, h, COLS, ROWS);
    const changed = diffRows(before, after);
    for (const y of changed) {
      if (!lib.stateIsRowDirty(h, y)) {
        misses++;
        console.error(`  MISS entering alt: row ${y}`);
      }
    }
    lib.stateMarkClean(h);
  }

  // Write on alt
  {
    const before = snapshotCodepoints(lib, h, COLS, ROWS);
    writeString(lib, h, 'Alternate content\n');
    lib.stateUpdate(h);
    const after = snapshotCodepoints(lib, h, COLS, ROWS);
    const changed = diffRows(before, after);
    for (const y of changed) {
      if (!lib.stateIsRowDirty(h, y)) {
        misses++;
        console.error(`  MISS alt-write: row ${y}`);
      }
    }
    lib.stateMarkClean(h);
  }

  // Leave alternate
  {
    const before = snapshotCodepoints(lib, h, COLS, ROWS);
    writeString(lib, h, '\x1b[?1049l');
    lib.stateUpdate(h);
    const after = snapshotCodepoints(lib, h, COLS, ROWS);
    const changed = diffRows(before, after);
    for (const y of changed) {
      if (!lib.stateIsRowDirty(h, y)) {
        misses++;
        console.error(`  MISS leaving alt: row ${y}`);
      }
    }
    lib.stateMarkClean(h);
  }

  totalChecks++;
  if (misses > 0) {
    totalMisses++;
    console.error(`FAIL [alternate screen]: ${misses} missed rows`);
  } else {
    console.log(`PASS [alternate screen]: all phases clean`);
  }
  lib.terminalFree(h);
}

// Test 7: Heavy scrollback push (200 lines)
{
  const h = lib.terminalNew(COLS, ROWS);
  let misses = 0;
  for (let i = 0; i < 200; i++) {
    const r = checkDirty(lib, h, COLS, ROWS, (l, h) => {
      writeString(l, h, `Line ${i}: ${'x'.repeat(30)}\n`);
    });
    if (r.missedRows.size > 0) {
      misses++;
      console.error(`  MISS at line ${i}: rows ${[...r.missedRows]}`);
    }
  }
  totalChecks++;
  if (misses > 0) {
    totalMisses++;
    console.error(`FAIL [scrollback push]: ${misses}/200 lines had missed rows`);
  } else {
    console.log(`PASS [scrollback push]: all lines clean`);
  }
  lib.terminalFree(h);
}

// Summary
console.log(`\n=== Summary ===`);
console.log(`Checks: ${totalChecks}, Misses: ${totalMisses}`);
if (totalMisses === 0) {
  console.log(`\n✅ isRowDirty correctly detected ALL changed rows across all scenarios.`);
  console.log(`   The native ghostty RenderState's dirty tracking is accurate.`);
  console.log(`   The bug in openmux is NOT in isRowDirty — it's elsewhere in the JS layer.`);
} else {
  console.log(`\n❌ isRowDirty missed rows in ${totalMisses}/${totalChecks} checks.`);
  console.log(`   The viewport comparison approach in buildDirtyState is the correct fix.`);
}

process.exit(totalMisses > 0 ? 1 : 0);
