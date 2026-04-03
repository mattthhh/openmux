/**
 * Clipboard bridge functions (errore version)
 * Wraps Clipboard service for async/await usage
 *
 * Backward-compatible versions use the global services singleton.
 */

import type { Clipboard } from '../services/Clipboard';
import { getClipboardService } from './services-instance';
import { ClipboardError } from '../errors';
import * as errore from 'errore';

/**
 * Copy text to clipboard (backward-compatible, uses global singleton).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return copyToClipboardWithService(getClipboardService(), text);
}

/**
 * Read text from clipboard (backward-compatible, uses global singleton).
 */
export async function readFromClipboard(): Promise<string | null> {
  return readFromClipboardWithService(getClipboardService());
}

/**
 * Copy text to clipboard using a specific Clipboard service.
 */
export async function copyToClipboardWithService(
  clipboard: Clipboard,
  text: string
): Promise<boolean> {
  const result = await clipboard
    .write(text)
    .catch((cause) => new ClipboardError({ operation: 'write', reason: String(cause), cause }));
  if (result instanceof ClipboardError) {
    console.warn('[clipboard] Write failed:', result.message);
    return false;
  }
  return true;
}

/**
 * Read text from clipboard using a specific Clipboard service.
 */
export async function readFromClipboardWithService(clipboard: Clipboard): Promise<string | null> {
  const result = await clipboard
    .read()
    .catch((cause) => new ClipboardError({ operation: 'read', reason: String(cause), cause }));
  if (result instanceof ClipboardError) {
    console.warn('[clipboard] Read failed:', result.message);
    return null;
  }
  return result;
}
