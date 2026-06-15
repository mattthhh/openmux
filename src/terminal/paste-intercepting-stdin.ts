/**
 * Paste-Intercepting Stdin Wrapper (Clipboard Passthrough with Fallback)
 *
 * Intercepts bracketed paste sequences at the raw Buffer level and triggers
 * a clipboard read. If the clipboard read fails (e.g. SSH sessions where
 * the server clipboard is empty), falls back to the buffered stdin paste
 * data so paste still works over remote connections.
 *
 * Flow:
 * 1. Detect paste start marker (\x1b[200~)
 * 2. Buffer all stdin data between start and end markers
 * 3. Trigger clipboard read via onPasteTriggered callback
 * 4. If clipboard succeeds (callback returns true): discard buffered data
 * 5. If clipboard fails (callback returns false): push buffered data through
 */

import { PassThrough } from 'stream';
import { emitHostColorScheme } from './host-color-scheme';

/** Helper type for attaching TTY properties to streams */
export interface TtyProperties {
  setRawMode?(mode: boolean): boolean | NodeJS.ReadStream;
  isTTY?: boolean;
}

/** Helper to apply TTY properties to a PassThrough stream */
function applyTtyProperties(
  passthrough: PassThrough,
  realStdin: NodeJS.ReadStream
): PassThrough & TtyProperties {
  const extended = passthrough as PassThrough & TtyProperties;
  const ttyStdin = realStdin as NodeJS.ReadStream & { fd?: number };
  extended.isTTY = realStdin.isTTY;

  if (realStdin.isTTY && typeof ttyStdin.fd === 'number') {
    // Bind setRawMode to realStdin to preserve 'this' context (fd access)
    extended.setRawMode = realStdin.setRawMode?.bind(realStdin);
  }

  return extended;
}

// Bracketed paste mode sequences (DECSET 2004)
const PASTE_START = Buffer.from('\x1b[200~');
const PASTE_END = Buffer.from('\x1b[201~');
const COLOR_SCHEME_DARK = Buffer.from('\x1b[?997;1n');
const COLOR_SCHEME_LIGHT = Buffer.from('\x1b[?997;2n');
const COLOR_SCHEME_MAX_LEN = Math.max(COLOR_SCHEME_DARK.length, COLOR_SCHEME_LIGHT.length);

function stripColorSchemeReports(data: Buffer): {
  cleaned: Buffer;
  scheme?: 'light' | 'dark';
  pending?: Buffer;
} {
  let cursor = 0;
  let scheme: 'light' | 'dark' | undefined;
  const chunks: Buffer[] = [];

  while (cursor < data.length) {
    const darkIdx = data.indexOf(COLOR_SCHEME_DARK, cursor);
    const lightIdx = data.indexOf(COLOR_SCHEME_LIGHT, cursor);
    let nextIdx = -1;
    let nextScheme: 'light' | 'dark' | null = null;
    let nextLen = 0;

    if (darkIdx !== -1 && (lightIdx === -1 || darkIdx < lightIdx)) {
      nextIdx = darkIdx;
      nextScheme = 'dark';
      nextLen = COLOR_SCHEME_DARK.length;
    } else if (lightIdx !== -1) {
      nextIdx = lightIdx;
      nextScheme = 'light';
      nextLen = COLOR_SCHEME_LIGHT.length;
    }

    if (nextIdx === -1 || !nextScheme) {
      break;
    }

    if (nextIdx > cursor) {
      chunks.push(data.subarray(cursor, nextIdx));
    }

    scheme = nextScheme;
    cursor = nextIdx + nextLen;
  }

  if (cursor < data.length) {
    chunks.push(data.subarray(cursor));
  }

  let cleaned = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  let pending: Buffer | undefined;
  const maxSuffix = Math.min(cleaned.length, COLOR_SCHEME_MAX_LEN - 1);
  for (let len = maxSuffix; len > 0; len--) {
    const tail = cleaned.subarray(cleaned.length - len);
    if (
      COLOR_SCHEME_DARK.subarray(0, len).equals(tail) ||
      COLOR_SCHEME_LIGHT.subarray(0, len).equals(tail)
    ) {
      pending = tail;
      cleaned = cleaned.subarray(0, cleaned.length - len);
      break;
    }
  }

  return { cleaned, scheme, pending };
}

export interface PasteInterceptorConfig {
  /**
   * Called when paste start marker is detected.
   * Implementation should read from system clipboard and write to PTY.
   * Return true if clipboard read succeeded (stdin data will be discarded).
   * Return false if clipboard read failed (stdin data will be used as fallback).
   */
  onPasteTriggered: () => Promise<boolean> | boolean;
}

/**
 * Check if buffer ends with a partial escape sequence that could be
 * the start of PASTE_START or PASTE_END
 */
function getPartialSequenceLength(buf: Buffer, sequence: Buffer): number {
  // Check if buffer ends with progressively longer prefixes of the sequence
  for (let len = Math.min(buf.length, sequence.length - 1); len > 0; len--) {
    const bufEnd = buf.subarray(buf.length - len);
    const seqStart = sequence.subarray(0, len);
    if (bufEnd.equals(seqStart)) {
      return len;
    }
  }
  return 0;
}

/**
 * Creates a stdin wrapper that intercepts bracketed paste sequences
 * at the raw Buffer level, before any string conversion.
 *
 * @param realStdin - The actual process.stdin stream
 * @param config - Configuration with paste callback
 * @returns A stream that can be passed to OpenTUI's stdin option
 */
export function createPasteInterceptingStdin(
  realStdin: NodeJS.ReadStream,
  config: PasteInterceptorConfig
): PassThrough & TtyProperties {
  const passthrough = new PassThrough();

  let isPasting = false;
  let pasteBuffer: Buffer[] = []; // Buffer stdin paste data for fallback
  let pendingBuffer: Buffer | null = null; // Buffer for partial sequences at chunk boundaries
  let pendingControlBuffer: Buffer | null = null;
  let pendingPasteEnd: Buffer | null = null; // Data after paste end, held until clipboard resolves

  /**
   * Called when clipboard read fails — push buffered stdin paste data
   * through to the passthrough stream so remote/SSH paste still works.
   */
  function fallbackToStdinData(): void {
    const content = Buffer.concat([PASTE_START, ...pasteBuffer, PASTE_END]);
    pasteBuffer = [];
    passthrough.push(content);
    releasePendingAfterEnd();
  }

  /**
   * Release any data that arrived after the paste end marker.
   * Called after paste resolution (clipboard success or fallback).
   */
  function releasePendingAfterEnd(): void {
    if (pendingPasteEnd) {
      const afterEnd = pendingPasteEnd;
      pendingPasteEnd = null;
      handleRawData(afterEnd);
    }
  }

  /**
   * Resolve a paste event: try clipboard first, fall back to stdin data.
   */
  function resolvePaste(): void {
    const result = config.onPasteTriggered();
    if (result instanceof Promise) {
      result
        .then((succeeded) => {
          if (!succeeded) {
            fallbackToStdinData();
          } else {
            pasteBuffer = [];
            releasePendingAfterEnd();
          }
        })
        .catch(() => fallbackToStdinData());
    } else {
      if (!result) {
        fallbackToStdinData();
      } else {
        pasteBuffer = [];
        releasePendingAfterEnd();
      }
    }
  }

  // Handle raw stdin data before any encoding is applied
  const handleRawData = (chunk: Buffer | string): void => {
    // Ensure we're working with Buffer (before encoding is set)
    let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    // Prepend any pending buffer from previous chunk
    if (pendingBuffer) {
      data = Buffer.concat([pendingBuffer, data]);
      pendingBuffer = null;
    }
    if (pendingControlBuffer) {
      data = Buffer.concat([pendingControlBuffer, data]);
      pendingControlBuffer = null;
    }

    const schemeResult = stripColorSchemeReports(data);
    if (schemeResult.scheme) {
      emitHostColorScheme(schemeResult.scheme);
    }
    if (schemeResult.pending) {
      pendingControlBuffer = schemeResult.pending;
    }
    data = schemeResult.cleaned;

    // Check for paste start marker
    const startIdx = data.indexOf(PASTE_START);
    if (startIdx !== -1) {
      // Pass through anything before the paste start to OpenTUI
      if (startIdx > 0) {
        passthrough.push(data.subarray(0, startIdx));
      }

      isPasting = true;
      pasteBuffer = [];

      // Check if paste end is in same chunk
      const afterStart = data.subarray(startIdx + PASTE_START.length);
      const endIdx = afterStart.indexOf(PASTE_END);

      if (endIdx !== -1) {
        // Paste end in same chunk — buffer the content
        pasteBuffer.push(afterStart.subarray(0, endIdx));
        isPasting = false;

        // Anything after paste end needs to be held until clipboard resolves
        const afterEnd = afterStart.subarray(endIdx + PASTE_END.length);
        pendingPasteEnd = afterEnd.length > 0 ? afterEnd : null;

        // Trigger clipboard read; fall back to buffered data if it fails
        resolvePaste();
      }
      // If paste end not in same chunk, keep buffering on subsequent calls
      return;
    }

    if (isPasting) {
      // We're in the middle of a paste - buffer data, check for end marker
      const endIdx = data.indexOf(PASTE_END);
      if (endIdx !== -1) {
        // Found end of paste — buffer the final chunk
        pasteBuffer.push(data.subarray(0, endIdx));
        isPasting = false;

        // Anything after paste end needs to be held until clipboard resolves
        const afterEnd = data.subarray(endIdx + PASTE_END.length);
        pendingPasteEnd = afterEnd.length > 0 ? afterEnd : null;

        // Trigger clipboard read; fall back to buffered data if it fails
        resolvePaste();
      } else {
        // Still in paste — buffer this chunk
        pasteBuffer.push(data);
      }
      return;
    }

    // Not in paste mode - check for partial start marker at the end
    const partialLen = getPartialSequenceLength(data, PASTE_START);
    if (partialLen > 0) {
      // Hold the partial sequence for the next chunk
      passthrough.push(data.subarray(0, data.length - partialLen));
      pendingBuffer = data.subarray(data.length - partialLen);
    } else {
      // Normal input - pass through to OpenTUI
      passthrough.push(data);
    }
  };

  // Listen to raw stdin
  realStdin.on('data', handleRawData);

  // Forward lifecycle events
  realStdin.on('end', () => {
    // Flush any pending buffer (normal input that looked like partial paste start)
    if (pendingBuffer && !isPasting) {
      passthrough.push(pendingBuffer);
      pendingBuffer = null;
    }
    passthrough.push(null);
  });

  realStdin.on('error', (err: Error) => {
    passthrough.emit('error', err);
  });

  // Copy necessary properties from real stdin for OpenTUI compatibility
  return applyTtyProperties(passthrough, realStdin);
}
