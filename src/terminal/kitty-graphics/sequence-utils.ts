/**
 * Kitty graphics protocol sequence utilities.
 * Uses errore for type-safe error handling on I/O operations.
 */

import { Buffer } from 'buffer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as errore from 'errore';
import { KittyOffloadError } from '../../effect/errors';

export const ESC = '\x1b';
export const APC_C1 = '\x9f';
export const ST_C1 = '\x9c';
export const KITTY_PREFIX_ESC = `${ESC}_G`;
export const KITTY_PREFIX_C1 = `${APC_C1}G`;

export type KittySequence = {
  prefix: string;
  suffix: string;
  control: string;
  data: string;
  params: Map<string, string>;
};

export type TransmitParams = {
  action: 't' | 'T';
  format?: string;
  medium?: string;
  width?: string;
  height?: string;
  compression?: string;
  size?: string;
  offset?: string;
  more: boolean;
};

export function parseKittySequence(sequence: string): KittySequence | null {
  const prefixLen = sequence.startsWith(KITTY_PREFIX_ESC)
    ? KITTY_PREFIX_ESC.length
    : sequence.startsWith(KITTY_PREFIX_C1)
      ? KITTY_PREFIX_C1.length
      : 0;
  if (prefixLen === 0) return null;

  const suffixLen = sequence.endsWith(`${ESC}\\`) ? 2 : sequence.endsWith(ST_C1) ? 1 : 0;
  if (suffixLen === 0) return null;

  const body = sequence.slice(prefixLen, sequence.length - suffixLen);
  const semicolon = body.indexOf(';');
  const control = semicolon === -1 ? body : body.slice(0, semicolon);
  const data = semicolon === -1 ? '' : body.slice(semicolon + 1);
  const params = parseParams(control);
  return {
    prefix: sequence.slice(0, prefixLen),
    suffix: sequence.slice(sequence.length - suffixLen),
    control,
    data,
    params,
  };
}

export function parseParams(control: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!control) return params;
  let start = 0;
  while (start < control.length) {
    // The Kitty 's' parameter uses 's=WIDTH,HEIGHT' where the comma
    // is PART OF the value, not a key-value separator. When we see 's=...'
    // we need to consume everything up to the next key=value pair.
    if (control[start] === 's' && control[start + 1] === '=') {
      const eqPos = start + 1;
      // Find the next key=value pair: look for ',KEY=' pattern
      let end = control.length;
      let searchFrom = eqPos + 1;
      while (searchFrom < control.length) {
        const nextComma = control.indexOf(',', searchFrom);
        if (nextComma === -1) break;
        // Check if what follows the comma is 'KEY=' pattern
        const afterComma = control.slice(nextComma + 1);
        const nextEqInAfter = afterComma.indexOf('=');
        if (nextEqInAfter !== -1 && nextEqInAfter < 4) {
          // Looks like a key=value pair — the text between comma and '='
          // is a short alphabetic key
          const potentialKey = afterComma.slice(0, nextEqInAfter);
          if (/^[a-zA-Z]$/.test(potentialKey)) {
            end = nextComma;
            break;
          }
        }
        searchFrom = nextComma + 1;
      }
      const value = control.slice(eqPos + 1, end);
      params.set('s', value);
      start = end + 1;
      continue;
    }

    let end = control.indexOf(',', start);
    if (end === -1) end = control.length;
    if (end > start) {
      const part = control.slice(start, end);
      const eq = part.indexOf('=');
      if (eq !== -1) {
        const key = part.slice(0, eq);
        const value = part.slice(eq + 1);
        if (key) params.set(key, value);
      }
    }
    start = end + 1;
  }
  return params;
}

export function parseTransmitParams(parsed: KittySequence): TransmitParams | null {
  const params = parsed.params;
  const action = params.get('a');
  const hasTransmitFields =
    params.has('f') ||
    params.has('t') ||
    params.has('s') ||
    params.has('v') ||
    params.has('o') ||
    params.has('m');
  const resolvedAction = action ?? (hasTransmitFields ? 't' : null);
  if (resolvedAction !== 't' && resolvedAction !== 'T') return null;

  const rawSize = params.get('s');
  const rawHeight = params.get('v');
  let width: string | undefined;
  let height: string | undefined;
  if (rawSize) {
    const commaIdx = rawSize.indexOf(',');
    if (commaIdx !== -1) {
      width = rawSize.slice(0, commaIdx);
      height = rawHeight ?? rawSize.slice(commaIdx + 1);
    } else {
      width = rawSize;
      height = rawHeight;
    }
  } else if (rawHeight) {
    height = rawHeight;
  }

  return {
    action: resolvedAction,
    format: params.get('f'),
    medium: params.get('t'),
    width,
    height,
    compression: params.get('o'),
    size: params.get('S'),
    offset: params.get('O'),
    more: params.get('m') === '1',
  };
}

export function mergeTransmitParams(
  base: TransmitParams | null,
  next: TransmitParams
): TransmitParams {
  if (!base) return next;
  return {
    action: next.action,
    format: next.format ?? base.format,
    medium: next.medium ?? base.medium,
    width: next.width ?? base.width,
    height: next.height ?? base.height,
    compression: next.compression ?? base.compression,
    size: next.size ?? base.size,
    offset: next.offset ?? base.offset,
    more: next.more,
  };
}

export function rebuildControl(params: Map<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(',');
}

export function buildGuestKey(
  imageId: string | number | null,
  imageNumber: string | number | null
): string | null {
  if (imageId !== null && imageId !== undefined && imageId !== '' && imageId !== 0) {
    return `i:${imageId}`;
  }
  if (
    imageNumber !== null &&
    imageNumber !== undefined &&
    imageNumber !== '' &&
    imageNumber !== 0
  ) {
    return `I:${imageNumber}`;
  }
  return null;
}

export function normalizeParamId(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const parsed = errore.try<bigint, Error>({
      try: () => BigInt(value),
      catch: () => new Error('Invalid BigInt'),
    });
    if (parsed instanceof Error) return null;
    if (parsed <= 0n) return null;
    return parsed.toString();
  }
  return value;
}

/**
 * Parse PNG dimensions from base64-encoded PNG data.
 *
 * Takes the first 64 characters of the base64 string, decodes them,
 * and extracts width/height from the PNG IHDR chunk.
 *
 * @param data - Base64-encoded PNG data
 * @returns Object with width and height, or null if not valid PNG
 */
export function parsePngDimensionsFromBase64(
  data: string
): { width: number; height: number } | null {
  if (!data) return null;
  const neededChars = 64;
  const sample = data.length > neededChars ? data.slice(0, neededChars) : data;

  const decoded = errore.try<Buffer, Error>({
    try: () => Buffer.from(sample, 'base64'),
    catch: () => new Error('Invalid base64'),
  });
  if (decoded instanceof Error) return null;

  return parsePngDimensionsFromBuffer(decoded);
}

/**
 * Decode a Kitty graphics protocol file payload from base64.
 * Used when medium='t' (temporary file) to get the file path.
 *
 * @param payload - Base64-encoded file path
 * @returns Decoded file path, or null if decoding fails
 */
export function decodeKittyFilePayload(payload: string): string | null {
  if (!payload) return null;
  const result = errore.try<string, Error>({
    try: () => Buffer.from(payload, 'base64').toString('utf8'),
    catch: () => new Error('Invalid base64'),
  });
  return result instanceof Error ? null : result;
}

/**
 * Parse PNG dimensions from a file path using errore for error handling.
 * @returns Dimensions on success, null on failure (file not found, not readable, not PNG)
 */
export function parsePngDimensionsFromFilePath(
  filePath: string
): { width: number; height: number } | null {
  if (!filePath) return null;

  // Use errore for file operations
  const result = errore.try<{ width: number; height: number } | null, KittyOffloadError>({
    try: () => {
      const fd = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(24);
        const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
        if (bytesRead < header.length) return null;
        return parsePngDimensionsFromBuffer(header);
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore close errors
        }
      }
    },
    catch: (e) => new KittyOffloadError({ operation: 'read', reason: String(e), cause: e }),
  });

  if (result instanceof KittyOffloadError) {
    // Silently return null - this is expected for invalid/unreadable files
    return null;
  }

  return result;
}

export function parsePngDimensionsFromFilePayload(
  payload: string
): { width: number; height: number } | null {
  const filePath = decodeKittyFilePayload(payload);
  if (!filePath) return null;
  return parsePngDimensionsFromFilePath(filePath);
}

/**
 * Estimate the decoded size of base64 data.
 * Accounts for base64 padding characters (=).
 *
 * Formula: floor(len * 3 / 4) - padding
 * - No padding: 0 bytes subtracted
 * - One '=': 1 byte subtracted
 * - Two '==': 2 bytes subtracted
 *
 * @param base64 - Base64-encoded string
 * @returns Estimated decoded size in bytes
 */
export function estimateDecodedSize(base64: string): number {
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function createTempFilePath(counter: number): string {
  const tempDir = os.tmpdir();
  const stamp = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2);
  const name = `openmux-tty-graphics-protocol-${stamp}-${counter}-${rand}.bin`;
  return path.join(tempDir, name);
}

/**
 * Parse PNG dimensions from a buffer by reading the IHDR chunk.
 *
 * PNG file structure:
 * - Bytes 0-7: PNG signature (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
 * - Bytes 8-11: IHDR chunk length (always 13 for IHDR)
 * - Bytes 12-15: IHDR chunk type ("IHDR" = 0x49 0x48 0x44 0x52)
 * - Bytes 16-19: Width (big-endian 32-bit)
 * - Bytes 20-23: Height (big-endian 32-bit)
 *
 * This function validates the PNG signature and reads width/height from the
 * IHDR chunk. It returns null if:
 * - Buffer is too short (< 24 bytes)
 * - PNG signature doesn't match
 * - Width or height is zero
 *
 * @param decoded - Buffer containing PNG data (at least 24 bytes)
 * @returns Object with width and height, or null if invalid
 */
function parsePngDimensionsFromBuffer(decoded: Buffer): { width: number; height: number } | null {
  if (decoded.length < 24) return null;
  if (
    decoded[0] !== 0x89 ||
    decoded[1] !== 0x50 ||
    decoded[2] !== 0x4e ||
    decoded[3] !== 0x47 ||
    decoded[4] !== 0x0d ||
    decoded[5] !== 0x0a ||
    decoded[6] !== 0x1a ||
    decoded[7] !== 0x0a
  ) {
    return null;
  }
  const width = decoded.readUInt32BE(16);
  const height = decoded.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}
