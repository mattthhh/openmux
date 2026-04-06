/**
 * PTY tracing utility for debugging terminal data flow.
 *
 * Controlled by environment variables:
 * - OPENMUX_PTY_TRACE: Path to trace log file (enables tracing if set)
 * - OPENMUX_PTY_TRACE_MAX_CHARS: Max characters per data entry (0 = unlimited)
 *
 * Traces:
 * - Raw PTY data chunks with escape sequence escaping
 * - Events like query handling, kitty broker operations
 * - Timestamps and metadata for each entry
 *
 * Data is escaped for readability (\x1b for ESC, \n for newline, etc.)
 * and written as newline-delimited JSON.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import * as errore from 'errore';
import { PtyTraceError } from '../effect/errors';

type TraceMeta = Record<string, unknown>;

const tracePath = process.env.OPENMUX_PTY_TRACE ?? '';
const maxChars = Number.parseInt(process.env.OPENMUX_PTY_TRACE_MAX_CHARS ?? '0', 10);
const enabled = tracePath.length > 0;

async function ensureTraceDir(): Promise<void> {
  if (!enabled) return;
  const result = await errore.tryAsync<void, PtyTraceError>({
    try: () => {
      mkdirSync(dirname(tracePath), { recursive: true });
      return Promise.resolve();
    },
    catch: (e) => new PtyTraceError({ operation: 'mkdir', reason: String(e), cause: e }),
  });
  if (result instanceof PtyTraceError) {
    return;
  }
}

void ensureTraceDir();

function escapeForLog(data: string): string {
  let out = '';
  for (const ch of data) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x1b) out += '\\x1b';
    else if (code === 0x07) out += '\\x07';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x9b) out += '\\x9b';
    else if (code === 0x9c) out += '\\x9c';
    else if (code === 0x9d) out += '\\x9d';
    else if (code === 0x9f) out += '\\x9f';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else if (code > 0x7e) out += `\\u{${code.toString(16)}}`;
    else out += ch;
  }
  return out;
}

async function writeLine(entry: Record<string, unknown>): Promise<void> {
  if (!enabled) return;
  const result = await errore.tryAsync<void, PtyTraceError>({
    try: () => {
      appendFileSync(
        tracePath,
        `${JSON.stringify(entry, (_key, value) => {
          if (typeof value === 'bigint') return `${value.toString()}n`;
          if (value instanceof Error) return value.message;
          return value;
        })}
`
      );
      return Promise.resolve();
    },
    catch: (e) => new PtyTraceError({ operation: 'write', reason: String(e), cause: e }),
  });
  if (result instanceof PtyTraceError) {
    return;
  }
}

/**
 * Trace a raw PTY data chunk to the log file.
 *
 * Data is escaped for readability and truncated if it exceeds
 * the maxChars limit. Empty data is skipped.
 *
 * @param type - Event type identifier (e.g., 'pty-write', 'pty-data')
 * @param data - Raw data string to trace
 * @param meta - Additional metadata to include
 */
export function tracePtyChunk(type: string, data: string, meta: TraceMeta = {}): void {
  if (!enabled) return;
  if (data.length === 0) return;
  let escaped = escapeForLog(data);
  if (maxChars > 0 && escaped.length > maxChars) {
    const over = escaped.length - maxChars;
    escaped = `${escaped.slice(0, maxChars)}...[truncated ${over} chars]`;
  }
  void writeLine({
    ts: new Date().toISOString(),
    type,
    len: data.length,
    data: escaped,
    ...meta,
  });
}

/**
 * Trace a structured event without raw data.
 *
 * Used for logging events like query handling, state changes,
 * and other non-data terminal operations.
 *
 * @param type - Event type identifier
 * @param meta - Event metadata
 */
export function tracePtyEvent(type: string, meta: TraceMeta = {}): void {
  if (!enabled) return;
  void writeLine({
    ts: new Date().toISOString(),
    type,
    ...meta,
  });
}
