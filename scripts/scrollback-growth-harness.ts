/**
 * Standalone harness to diagnose scrollback growth during resize + pi full redraws.
 *
 * Creates a GhosttyVtTerminal directly, writes data, resizes, and measures
 * scrollback length at each step. No openmux app needed.
 *
 * Usage: bun run scripts/scrollback-growth-harness.ts
 */
import fs from 'node:fs';
import path from 'node:path';

let GhosttyVtTerminal: any;

function resolveLib(): string {
  if (process.env.GHOSTTY_VT_LIB) return process.env.GHOSTTY_VT_LIB;
  const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  const repoRoot = path.dirname(import.meta.dir);
  const candidates = [
    path.join(repoRoot, 'native', 'zig-ghostty-wrapper', 'zig-out', 'lib', `libghostty-vt.${ext}`),
    path.join(repoRoot, 'dist', `libghostty-vt.${ext}`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      process.env.GHOSTTY_VT_LIB = c;
      return c;
    }
  }
  throw new Error(`libghostty-vt not found. Searched: ${candidates.join(', ')}`);
}

async function init() {
  resolveLib();
  const mod = await import('../src/terminal/ghostty-vt/terminal');
  GhosttyVtTerminal = mod.GhosttyVtTerminal;
}

function esc(...parts: string[]): string {
  return parts.join('');
}

const CSI = '\x1b[';
const HOME = `${CSI}H`;
const CLEAR_SCREEN = `${CSI}2J`;
const ERASE_BELOW = `${CSI}J`;
const CLEAR_SCROLLBACK = `${CSI}3J`;
const SYNC_ON = `${CSI}?2026h`;
const SYNC_OFF = `${CSI}?2026l`;

/** Build a pi-style full redraw frame: sync on, clear+home+clear_scrollback, frame body, sync off */
function piFullRedraw(body: string): string {
  return `${SYNC_ON}${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${body}${SYNC_OFF}`;
}

/** Build the normalized version (what data-handler produces after normalizePiFullRedrawSegment) */
function normalizedPiRedraw(body: string): string {
  return `${HOME}${ERASE_BELOW}${body}`;
}

/** Build a simple frame body (N lines of text filling the terminal) */
function frameBody(rows: number, cols: number, prefix = 'line'): string {
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const text = `${prefix}-${String(i).padStart(3, '0')}`;
    lines.push(text.padEnd(cols));
  }
  return lines.join('\r\n');
}

function main() {
  const COLS = 80;
  const ROWS = 24;

  console.log('=== Scrollback Growth Harness ===\n');

  // Test 1: Raw pi full redraw (no normalization)
  console.log('--- Test 1: Raw pi full redraw (CSI 2J+H+3J prefix) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    console.log(`  Initial scrollback: ${term.getScrollbackLength()}`);

    // Write some initial content to create scrollback
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // Raw pi redraw
    const body = frameBody(ROWS, COLS, 'redraw1');
    term.write(piFullRedraw(body));
    console.log(`  After raw pi redraw #1: scrollback=${term.getScrollbackLength()}`);

    term.write(piFullRedraw(frameBody(ROWS, COLS, 'redraw2')));
    console.log(`  After raw pi redraw #2: scrollback=${term.getScrollbackLength()}`);

    term.write(piFullRedraw(frameBody(ROWS, COLS, 'redraw3')));
    console.log(`  After raw pi redraw #3: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 2: Normalized pi redraw (HOME+J prefix, no CSI 2J/3J)
  console.log('\n--- Test 2: Normalized pi redraw (HOME+J prefix) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    console.log(`  Initial scrollback: ${term.getScrollbackLength()}`);

    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    const body = frameBody(ROWS, COLS, 'redraw1');
    term.write(normalizedPiRedraw(body));
    console.log(`  After normalized redraw #1: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw2')));
    console.log(`  After normalized redraw #2: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw3')));
    console.log(`  After normalized redraw #3: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 3: Resize then normalized pi redraw
  console.log('\n--- Test 3: Resize + normalized pi redraw ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // Resize (like option+z zoom)
    const newCols = COLS + 20;
    const newRows = ROWS + 5;
    term.resize(newCols, newRows);
    console.log(`  After resize(${newCols}x${newRows}): scrollback=${term.getScrollbackLength()}`);

    // Pi redraw after resize
    const body = frameBody(newRows, newCols, 'post-resize1');
    term.write(normalizedPiRedraw(body));
    console.log(`  After normalized redraw #1: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(newRows, newCols, 'post-resize2')));
    console.log(`  After normalized redraw #2: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(newRows, newCols, 'post-resize3')));
    console.log(`  After normalized redraw #3: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 4: Multiple resize+redraw cycles (simulates option+z zoom in/out)
  console.log('\n--- Test 4: Multiple resize+redraw cycles (zoom in/out) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  Initial: scrollback=${term.getScrollbackLength()}`);

    // Zoom in
    term.resize(COLS + 20, ROWS + 5);
    term.write(normalizedPiRedraw(frameBody(ROWS + 5, COLS + 20, 'zoom1')));
    console.log(`  After zoom in #1: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS + 30, ROWS + 8);
    term.write(normalizedPiRedraw(frameBody(ROWS + 8, COLS + 30, 'zoom2')));
    console.log(`  After zoom in #2: scrollback=${term.getScrollbackLength()}`);

    // Zoom back out
    term.resize(COLS, ROWS);
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'zoom3')));
    console.log(`  After zoom out: scrollback=${term.getScrollbackLength()}`);

    // Zoom in again
    term.resize(COLS + 20, ROWS + 5);
    term.write(normalizedPiRedraw(frameBody(ROWS + 5, COLS + 20, 'zoom4')));
    console.log(`  After zoom in #3: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 5: Resize with NO redraw — just measure reflow
  console.log('\n--- Test 5: Resize without redraw (reflow only) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS + 20, ROWS + 5);
    console.log(`  After resize bigger: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    console.log(`  After resize back: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS + 20, ROWS + 5);
    console.log(`  After resize bigger again: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    console.log(`  After resize back again: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 6: Just the frame body with \r\n (no prefix at all)
  console.log('\n--- Test 6: Frame body only (no prefix, just \\r\\n text) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // Just write text with \r\n — no cursor positioning
    const body = frameBody(ROWS, COLS, 'body1');
    term.write(body);
    console.log(`  After body-only write #1: scrollback=${term.getScrollbackLength()}`);

    term.write(frameBody(ROWS, COLS, 'body2'));
    console.log(`  After body-only write #2: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 7: CSI H + CSI J with frame running past bottom via \r\n
  console.log('\n--- Test 7: HOME + ERASE_BELOW + long frame (more lines than rows) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // Frame has MORE lines than the terminal rows — the extra \r\n must scroll
    const body = frameBody(ROWS + 5, COLS, 'long1');
    term.write(normalizedPiRedraw(body));
    console.log(
      `  After normalized redraw (ROWS+5 lines): scrollback=${term.getScrollbackLength()}`
    );
  }

  // Test 8: Exact fit frame (ROWS lines, last line has no trailing \r\n)
  console.log('\n--- Test 8: HOME + ERASE_BELOW + exact-fit frame (ROWS lines) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // Exact fit: ROWS lines, ROWS-1 \r\n separators
    const lines: string[] = [];
    for (let i = 0; i < ROWS; i++) {
      lines.push(`exact-${String(i).padStart(3, '0')}`.padEnd(COLS));
    }
    const body = lines.join('\r\n'); // ROWS-1 \r\n, last line has no \r\n
    term.write(normalizedPiRedraw(body));
    console.log(`  After normalized redraw (exact fit): scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(body));
    console.log(`  After normalized redraw #2: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(body));
    console.log(`  After normalized redraw #3: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 9: What ghostty does with CSI 2J on primary screen (the scrollClear heuristic)
  console.log('\n--- Test 9: CSI 2J on primary screen (scrollClear behavior) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    // CSI 2J alone — ghostty may push visible content to scrollback
    term.write(CLEAR_SCREEN);
    console.log(`  After CSI 2J: scrollback=${term.getScrollbackLength()}`);

    term.write(CLEAR_SCREEN);
    console.log(`  After CSI 2J #2: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 10: CSI 2J + HOME + CSI 3J (original pi prefix without sync mode)
  console.log('\n--- Test 10: CSI 2J + HOME + CSI 3J (unnormalized pi prefix) ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    const body = frameBody(ROWS, COLS, 'unnorm1');
    term.write(`${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${body}`);
    console.log(`  After unnormalized redraw #1: scrollback=${term.getScrollbackLength()}`);

    term.write(`${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${frameBody(ROWS, COLS, 'unnorm2')}`);
    console.log(`  After unnormalized redraw #2: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 11: Resize + raw (unnormalized) pi redraw
  console.log('\n--- Test 11: Resize + unnormalized pi redraw ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After initial content: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS + 20, ROWS + 5);
    console.log(`  After resize: scrollback=${term.getScrollbackLength()}`);

    term.write(
      `${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${frameBody(ROWS + 5, COLS + 20, 'raw1')}`
    );
    console.log(`  After unnormalized redraw #1: scrollback=${term.getScrollbackLength()}`);

    term.write(
      `${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${frameBody(ROWS + 5, COLS + 20, 'raw2')}`
    );
    console.log(`  After unnormalized redraw #2: scrollback=${term.getScrollbackLength()}`);
  }

  console.log('\n=== Done ===');
}

init()
  .then(main)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
