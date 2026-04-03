/**
 * Clipboard bridge functions (errore version)
 * Wraps Clipboard service for async/await usage
 */

import { getClipboardService } from './services-instance';
import { ClipboardError } from '../errors';

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = getClipboardService();
  const result = await clipboard
    .write(text)
    .catch((cause) => new ClipboardError({ operation: 'write', reason: String(cause), cause }));
  if (result instanceof ClipboardError) {
    console.warn('[clipboard] Write failed:', result.message);
    return false;
  }
  return true;
}

/** Read text from clipboard */
export async function readFromClipboard(): Promise<string | null> {
  const clipboard = getClipboardService();
  const result = await clipboard
    .read()
    .catch((cause) => new ClipboardError({ operation: 'read', reason: String(cause), cause }));
  if (result instanceof ClipboardError) {
    console.warn('[clipboard] Read failed:', result.message);
    return null;
  }
  return result;
}
