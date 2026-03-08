/**
 * Clipboard bridge functions (errore version)
 * Wraps Clipboard service for async/await usage
 * 
 * Backward-compatible versions use the global services singleton.
 */

import type { Clipboard } from "../services/Clipboard"
import { getClipboardService } from "./services-instance"

/**
 * Copy text to clipboard (backward-compatible, uses global singleton).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return copyToClipboardWithService(getClipboardService(), text)
}

/**
 * Read text from clipboard (backward-compatible, uses global singleton).
 */
export async function readFromClipboard(): Promise<string | null> {
  return readFromClipboardWithService(getClipboardService())
}

/**
 * Copy text to clipboard using a specific Clipboard service.
 */
export async function copyToClipboardWithService(clipboard: Clipboard, text: string): Promise<boolean> {
  try {
    const result = await clipboard.write(text)
    return !(result instanceof Error)
  } catch (e) {
    console.warn('[clipboard] Write failed:', e)
    return false
  }
}

/**
 * Read text from clipboard using a specific Clipboard service.
 */
export async function readFromClipboardWithService(clipboard: Clipboard): Promise<string | null> {
  try {
    const result = await clipboard.read()
    if (result instanceof Error) return null
    return result
  } catch (e) {
    console.warn('[clipboard] Read failed:', e)
    return null
  }
}
