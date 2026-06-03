/**
 * OSC sequence stripping for ghostty-vt.
 *
 * Strips OSC sequences that can cause flash/flicker or unwanted mutations
 * when processed by the terminal emulator. Title changes are handled by
 * the title parser, and OSC queries are handled by passthrough.
 *
 * Optimized to skip over Kitty APC sequences (\x1b_G...\x1b\\) and
 * DCS sequences (\x1b_P...\x1b\\) since these never contain OSC codes
 * that need stripping. This avoids character-by-character scanning of
 * large image data payloads (which can be 1MB+ per frame).
 */

const ESC = '\x1b';
const APC_PREFIX = ESC + '_G'; // Kitty graphics
const DCS_PREFIX = ESC + 'P'; // Device control
const APC_C1 = '\x9f';
const ST = ESC + '\\'; // String terminator

/**
 * Find the end of an APC/DCS sequence starting at `start`.
 * Returns the index right after the ST (\x1b\\ or \x9c).
 */
function findSequenceEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    // \x9c is the C1 form of ST
    if (text.charCodeAt(i) === 0x9c) return i + 1;
    if (text[i] === ESC && i + 1 < text.length && text[i + 1] === '\\') return i + 2;
    i++;
  }
  // Unclosed sequence — return end of string
  return text.length;
}

const STRIP_CODES = new Set([0, 1, 2, 7, 9, 10, 11, 12, 22, 23, 777]);

/**
 * Strip OSC sequences that can cause screen flash/flicker or unwanted state.
 *
 * Stripped sequences:
 * - OSC 0/1/2: Title sequences (handled by title parser)
 * - OSC 7: Working directory notification (not needed for rendering)
 * - OSC 9/777: Desktop notifications and openmux shell-control payloads (handled outside emulator)
 * - OSC 10/11/12: Foreground/background/cursor color SET commands
 * - OSC 22/23: Window icon / title stack operations
 *
 * Note: Query sequences (with ?) are handled by query passthrough on main thread.
 * This only strips SET commands that go directly to the emulator.
 */
export function stripProblematicOscSequences(text: string): string {
  const len = text.length;
  if (len === 0) return '';

  // Fast path: if no ESC character exists, nothing to strip.
  if (!text.includes(ESC)) return text;

  const BEL = '\x07';
  let result = '';
  let i = 0;
  let lastCopy = 0;

  while (i < len) {
    if (text[i] !== ESC) {
      i++;
      continue;
    }

    // APC (\x1b_) — skip entire sequence including payload
    if (i + 1 < len && text[i + 1] === '_') {
      // Copy everything before this APC
      if (i > lastCopy) result += text.slice(lastCopy, i);
      // Find end of APC sequence (ST: \x1b\\ or \x9c)
      const end = findSequenceEnd(text, i + 2);
      result += text.slice(i, end);
      i = end;
      lastCopy = i;
      continue;
    }

    // DCS (\x1bP) — skip entire sequence
    if (i + 1 < len && text[i + 1] === 'P') {
      if (i > lastCopy) result += text.slice(lastCopy, i);
      const end = findSequenceEnd(text, i + 2);
      result += text.slice(i, end);
      i = end;
      lastCopy = i;
      continue;
    }

    // OSC (\x1b]) — check if it should be stripped
    if (i + 1 < len && text[i + 1] === ']') {
      let pos = i + 2;
      let codeStr = '';

      while (pos < len && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) {
        codeStr += text[pos];
        pos++;
      }

      const code = parseInt(codeStr, 10);

      if (codeStr.length > 0 && STRIP_CODES.has(code)) {
        const isColorCode = code === 10 || code === 11 || code === 12;

        if (isColorCode) {
          if (pos < len && text[pos] === ';') {
            if (pos + 1 < len && text[pos + 1] === '?') {
              // Color query — keep it
              i++;
              continue;
            }
          }
        }

        // Strip this OSC sequence — copy everything before it
        if (i > lastCopy) result += text.slice(lastCopy, i);

        // Skip to end of OSC (BEL or ST)
        while (pos < len) {
          if (text[pos] === BEL) {
            i = pos + 1;
            break;
          }
          if (text[pos] === ESC && pos + 1 < len && text[pos + 1] === '\\') {
            i = pos + 2;
            break;
          }
          pos++;
        }

        lastCopy = i;
        continue;
      }
    }

    // Not a stripped sequence — advance past ESC
    i++;
  }

  // Copy remaining text
  if (lastCopy === 0) return text;
  if (lastCopy < len) result += text.slice(lastCopy);
  return result;
}
