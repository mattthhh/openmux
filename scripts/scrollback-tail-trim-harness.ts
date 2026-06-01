/**
 * Harness 2: Test eraseScrollbackTail / resetScrollbackTailTrim behavior
 * and whether the current "tail trim" fix actually persists across writes.
 *
 * Key questions:
 * - Does eraseScrollbackTail() actually remove reflow scrollback?
 * - Does a subsequent write() undo/reset the tail trim?
 * - Does resetScrollbackTailTrim() re-expose previously trimmed lines?
 * - What's the correct sequence to make tail trim stick?
 *
 * Usage: bun run scripts/scrollback-tail-trim-harness.ts
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

const CSI = '\x1b[';
const HOME = `${CSI}H`;
const ERASE_BELOW = `${CSI}J`;
const CLEAR_SCREEN = `${CSI}2J`;
const CLEAR_SCROLLBACK = `${CSI}3J`;

function normalizedPiRedraw(body: string): string {
  return `${HOME}${ERASE_BELOW}${body}`;
}

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

  console.log('=== Tail Trim Harness ===\n');

  // Test 1: eraseScrollbackTail after reflow — does it work?
  console.log('--- Test 1: eraseScrollbackTail after resize-down reflow ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));
    console.log(`  After init: scrollback=${term.getScrollbackLength()}`);

    // Grow, fill, shrink — creates reflow scrollback
    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    console.log(`  After resize bigger + fill: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    console.log(`  After resize back to ${COLS}x${ROWS}: scrollback=${term.getScrollbackLength()}`);

    const before = term.getScrollbackLength();
    term.eraseScrollbackTail(before);
    console.log(`  After eraseScrollbackTail(${before}): scrollback=${term.getScrollbackLength()}`);
  }

  // Test 2: Does write() after eraseScrollbackTail undo the trim?
  console.log('\n--- Test 2: write() after eraseScrollbackTail — does trim persist? ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    // Create reflow scrollback
    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    const growth = term.getScrollbackLength();
    console.log(`  Before trim: scrollback=${growth}`);

    term.eraseScrollbackTail(growth);
    console.log(`  After trim: scrollback=${term.getScrollbackLength()}`);

    // Now write new content (like a pi full redraw would)
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw1')));
    console.log(`  After write (normalized redraw #1): scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw2')));
    console.log(`  After write (normalized redraw #2): scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw3')));
    console.log(`  After write (normalized redraw #3): scrollback=${term.getScrollbackLength()}`);
  }

  // Test 3: Does trim + reset + write re-expose old scrollback?
  console.log('\n--- Test 3: resetScrollbackTailTrim after trim + write ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    const growth = term.getScrollbackLength();
    console.log(`  Before trim: scrollback=${growth}`);

    term.eraseScrollbackTail(growth);
    console.log(`  After trim: scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw1')));
    console.log(`  After write: scrollback=${term.getScrollbackLength()}`);

    term.resetScrollbackTailTrim();
    console.log(`  After resetScrollbackTailTrim: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 4: trim AFTER the redraw (not before) — does that work better?
  console.log('\n--- Test 4: eraseScrollbackTail AFTER (not before) the redraw ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    const preRedraw = term.getScrollbackLength();
    console.log(`  Before redraw: scrollback=${preRedraw}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw1')));
    const postRedraw = term.getScrollbackLength();
    console.log(`  After redraw: scrollback=${postRedraw} (growth=${postRedraw - preRedraw})`);

    term.eraseScrollbackTail(postRedraw);
    console.log(`  After trim(${postRedraw}): scrollback=${term.getScrollbackLength()}`);

    // Does next write undo the trim?
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw2')));
    console.log(`  After write #2: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 5: Multiple resize-redraw-trim cycles
  console.log('\n--- Test 5: Multiple resize-redraw-trim cycles ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    // Cycle 1: zoom in, redraw, zoom out, redraw+trim
    term.resize(COLS + 20, ROWS + 5);
    term.write(normalizedPiRedraw(frameBody(ROWS + 5, COLS + 20, 'z1')));
    console.log(`  Zoom in #1: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    let sb = term.getScrollbackLength();
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'z2')));
    console.log(`  Zoom out (after redraw): scrollback=${term.getScrollbackLength()}`);

    sb = term.getScrollbackLength();
    if (sb > 0) term.eraseScrollbackTail(sb);
    console.log(`  After trim: scrollback=${term.getScrollbackLength()}`);

    // Cycle 2
    term.resize(COLS + 30, ROWS + 8);
    term.write(normalizedPiRedraw(frameBody(ROWS + 8, COLS + 30, 'z3')));
    console.log(`  Zoom in #2: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'z4')));
    console.log(`  Zoom out #2 (after redraw): scrollback=${term.getScrollbackLength()}`);

    sb = term.getScrollbackLength();
    if (sb > 0) term.eraseScrollbackTail(sb);
    console.log(`  After trim #2: scrollback=${term.getScrollbackLength()}`);

    // Cycle 3
    term.resize(COLS + 20, ROWS + 5);
    term.write(normalizedPiRedraw(frameBody(ROWS + 5, COLS + 20, 'z5')));
    console.log(`  Zoom in #3: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'z6')));
    sb = term.getScrollbackLength();
    console.log(`  Zoom out #3 (after redraw): scrollback=${sb}`);

    if (sb > 0) term.eraseScrollbackTail(sb);
    console.log(`  After trim #3: scrollback=${term.getScrollbackLength()}`);

    // One more redraw to check stability
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'z7')));
    console.log(`  Final redraw: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 6: What if we use trimScrollback (head trim) instead?
  console.log('\n--- Test 6: trimScrollback (head trim from oldest) vs eraseScrollbackTail ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    const growth = term.getScrollbackLength();
    console.log(`  Growth: scrollback=${growth}`);

    // Head trim — removes OLDEST lines
    term.trimScrollback(growth);
    console.log(`  After trimScrollback(${growth}): scrollback=${term.getScrollbackLength()}`);

    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw1')));
    console.log(`  After write: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 7: Read scrollback content — what's actually in there after reflow?
  console.log('\n--- Test 7: Scrollback content inspection after reflow ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write('AAA\r\nBBB\r\nCCC');
    console.log(`  After ABC: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS + 30, ROWS + 8);
    console.log(`  After resize bigger: scrollback=${term.getScrollbackLength()}`);

    term.resize(COLS, ROWS);
    console.log(`  After resize back: scrollback=${term.getScrollbackLength()}`);

    // Try to read scrollback lines to see what's there
    const sbLen = term.getScrollbackLength();
    for (let i = 0; i < Math.min(sbLen, 5); i++) {
      try {
        const line = term.fetchScrollbackLine?.(i);
        console.log(`  scrollback[${i}]: ${JSON.stringify(line?.text || line)}`);
      } catch {
        console.log(`  scrollback[${i}]: (read error)`);
      }
    }
  }

  // Test 8: Does CSI 3J (clear scrollback) clean up reflow scrollback?
  console.log('\n--- Test 8: CSI 3J to clear reflow scrollback ---');
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    console.log(`  After reflow: scrollback=${term.getScrollbackLength()}`);

    term.write(CLEAR_SCROLLBACK);
    console.log(`  After CSI 3J: scrollback=${term.getScrollbackLength()}`);

    // Does it stay clear after subsequent writes?
    term.write(normalizedPiRedraw(frameBody(ROWS, COLS, 'redraw1')));
    console.log(`  After redraw: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 9: CSI 3J + HOME + J (full redraw with scrollback clear) after reflow
  console.log(
    '\n--- Test 9: Full redraw with CSI 3J after reflow (the original unnormalized prefix) ---'
  );
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });
    term.write(frameBody(ROWS, COLS, 'init'));

    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big'));
    term.resize(COLS, ROWS);
    console.log(`  After reflow: scrollback=${term.getScrollbackLength()}`);

    // This is what pi originally sends: CSI 2J + H + CSI 3J
    term.write(`${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${frameBody(ROWS, COLS, 'redraw1')}`);
    console.log(`  After CSI 2J+H+3J+body: scrollback=${term.getScrollbackLength()}`);

    // Multiple cycles
    term.resize(COLS + 30, ROWS + 8);
    term.write(frameBody(ROWS + 8, COLS + 30, 'big2'));
    term.resize(COLS, ROWS);
    console.log(`  After reflow #2: scrollback=${term.getScrollbackLength()}`);

    term.write(`${CLEAR_SCREEN}${HOME}${CLEAR_SCROLLBACK}${frameBody(ROWS, COLS, 'redraw2')}`);
    console.log(`  After CSI 2J+H+3J+body #2: scrollback=${term.getScrollbackLength()}`);
  }

  // Test 10: The actual openmux flow — resize -> redraw (normalized) -> tail trim
  console.log(
    '\n--- Test 10: Simulated openmux flow (resize -> normalized redraw -> tail trim) ---'
  );
  {
    const term = new GhosttyVtTerminal(COLS, ROWS, { scrollbackLimit: 0 });

    // Fill initial content
    term.write(frameBody(ROWS, COLS, 'init'));

    function doResizeRedraw(newCols: number, newRows: number, label: string) {
      term.resize(newCols, newRows);

      const preSb = term.getScrollbackLength();
      term.write(normalizedPiRedraw(frameBody(newRows, newCols, label)));
      const postSb = term.getScrollbackLength();

      const growth = postSb;
      if (growth > 0) {
        term.eraseScrollbackTail(growth);
      }
      const afterTrim = term.getScrollbackLength();

      console.log(
        `  ${label} (${newCols}x${newRows}): pre=${preSb} post=${postSb} trimmed=${afterTrim}`
      );
    }

    doResizeRedraw(COLS + 20, ROWS + 5, 'zoom-in-1');
    doResizeRedraw(COLS, ROWS, 'zoom-out-1');
    doResizeRedraw(COLS + 30, ROWS + 8, 'zoom-in-2');
    doResizeRedraw(COLS, ROWS, 'zoom-out-2');
    doResizeRedraw(COLS + 20, ROWS + 5, 'zoom-in-3');
    doResizeRedraw(COLS, ROWS, 'zoom-out-3');
    doResizeRedraw(COLS + 10, ROWS + 3, 'zoom-in-4');
    doResizeRedraw(COLS, ROWS, 'zoom-out-4');

    // Final check: does scrollback stay bounded after multiple cycles?
    console.log(`  Final scrollback: ${term.getScrollbackLength()}`);
  }

  console.log('\n=== Done ===');
}

init()
  .then(main)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
