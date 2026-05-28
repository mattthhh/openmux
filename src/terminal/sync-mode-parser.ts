/**
 * Sync Mode Parser for DEC Synchronized Output Mode 2026
 *
 * Detects CSI ? 2026 h (sync start) and CSI ? 2026 l (sync end) sequences
 * in PTY output and buffers content between them for atomic rendering.
 *
 * This prevents flickering when child processes (like OpenTUI apps) use
 * sync mode to batch their frame updates.
 */

const SYNC_SET = '\x1b[?2026h';
const SYNC_RESET = '\x1b[?2026l';

export interface SyncModeParser {
  /**
   * Process incoming data, returns segments ready for rendering.
   * Content inside sync mode boundaries is buffered until sync end is received.
   */
  process(data: string): {
    /** Segments that are complete and ready to render */
    readySegments: string[];
    /** Whether we're currently buffering inside sync mode */
    isBuffering: boolean;
  };

  /**
   * Force flush any buffered content (e.g., on timeout).
   * Returns buffered content and resets sync mode state.
   */
  flush(): string;

  /**
   * Check if currently in sync mode (buffering).
   */
  isInSyncMode(): boolean;
}

export function createSyncModeParser(): SyncModeParser {
  let buffer = '';
  let inSyncMode = false;
  // Buffer for partial escape sequences at chunk boundaries
  let partialEscape = '';

  return {
    process(data: string) {
      const readySegments: string[] = [];

      // Prepend any partial escape from previous chunk
      let input = partialEscape + data;
      partialEscape = '';

      // Check for partial escape sequence at end (starts with ESC but incomplete)
      // The sync sequences are 8 characters long: \x1b[?2026h and \x1b[?2026l
      // We only buffer if it's truly partial (not already a complete sequence)
      const lastEsc = input.lastIndexOf('\x1b');
      if (lastEsc !== -1 && lastEsc > input.length - 8) {
        // Potential partial sequence at end
        const suffix = input.slice(lastEsc);
        // Check if this is a PARTIAL sequence (could become a sync sequence but isn't complete)
        // Don't buffer if it's already a complete sync sequence
        const isPartialSyncSet = SYNC_SET.startsWith(suffix) && suffix !== SYNC_SET;
        const isPartialSyncReset = SYNC_RESET.startsWith(suffix) && suffix !== SYNC_RESET;
        if (isPartialSyncSet || isPartialSyncReset) {
          partialEscape = suffix;
          input = input.slice(0, lastEsc);
        }
      }

      let pos = 0;
      while (pos < input.length) {
        if (!inSyncMode) {
          // Not in sync mode - look for sync start
          const syncStart = input.indexOf(SYNC_SET, pos);
          if (syncStart === -1) {
            // No sync start found - emit everything from current position
            if (pos < input.length) {
              readySegments.push(input.slice(pos));
            }
            pos = input.length;
          } else {
            // Found sync start - emit content before it, then enter sync mode
            if (syncStart > pos) {
              readySegments.push(input.slice(pos, syncStart));
            }
            inSyncMode = true;
            pos = syncStart + SYNC_SET.length;
          }
        } else {
          // In sync mode - look for sync end
          const syncEnd = input.indexOf(SYNC_RESET, pos);
          if (syncEnd === -1) {
            // No sync end yet - buffer everything from current position
            buffer += input.slice(pos);
            pos = input.length;
          } else {
            // Found sync end - add to buffer and flush as single segment
            buffer += input.slice(pos, syncEnd);
            if (buffer.length > 0) {
              readySegments.push(buffer);
            }
            buffer = '';
            inSyncMode = false;
            pos = syncEnd + SYNC_RESET.length;
          }
        }
      }

      return { readySegments, isBuffering: inSyncMode };
    },

    flush() {
      const result = partialEscape + buffer;
      partialEscape = '';
      buffer = '';
      inSyncMode = false;
      return result;
    },

    isInSyncMode() {
      return inSyncMode;
    },
  };
}
