/**
 * Clipboard bridge functions (errore version)
 * Wraps Clipboard service for async/await usage
 */

import { getClipboardService } from './services-instance';
import { ClipboardError } from '../errors';
import { writeHostSequence } from '../../terminal/host-output';

function writeToHostClipboard(text: string): boolean {
  // Use OSC 52 to tell the parent terminal to put the text on its clipboard.
  // This is the only reliable way to copy over SSH, where the server has no
  // access to the user's local clipboard and no xclip/xsel/wl-clipboard is installed.
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return writeHostSequence(`\x1b]52;c;${encoded}\x1b\\`);
}

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false;

  const clipboard = getClipboardService();
  const result = await clipboard
    .write(text)
    .catch((cause) => new ClipboardError({ operation: 'write', reason: String(cause), cause }));
  if (result instanceof ClipboardError) {
    // Try OSC 52 as a fallback so copying still works over SSH.
    if (writeToHostClipboard(text)) {
      return true;
    }
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
