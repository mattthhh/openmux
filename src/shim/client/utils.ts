import type { Buffer } from 'buffer';

/**
 * Converts a Node.js Buffer to an ArrayBuffer.
 * Uses slice to create a view without copying when possible.
 * @param buffer - Node.js Buffer to convert
 * @returns ArrayBuffer view of the buffer data
 */
export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}
