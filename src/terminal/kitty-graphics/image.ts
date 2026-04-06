import { KittyGraphicsFormat, type KittyGraphicsImageInfo } from '../emulator-interface';

/**
 * Prepare image data for Kitty graphics transmission.
 *
 * Converts various image formats to the appropriate Kitty format:
 * - RGB → Format 24 (RGB888)
 * - RGBA → Format 32 (RGBA8888)
 * - PNG → Format 100, or 32 if already decoded
 * - Grayscale → Expanded to RGBA8888
 * - Grayscale+Alpha → Expanded to RGBA8888
 *
 * @param info - Image metadata including format
 * @param data - Raw image pixel data
 * @returns Prepared data with Kitty format code, or null if unsupported
 */
export function prepareImageData(
  info: KittyGraphicsImageInfo,
  data: Uint8Array
): { format: number; payload: Uint8Array } | null {
  switch (info.format) {
    case KittyGraphicsFormat.RGB:
      return { format: 24, payload: data };
    case KittyGraphicsFormat.RGBA:
      return { format: 32, payload: data };
    case KittyGraphicsFormat.PNG: {
      const expected = info.width * info.height * 4;
      if (data.byteLength !== expected) {
        return { format: 100, payload: data };
      }
      return { format: 32, payload: data };
    }
    case KittyGraphicsFormat.GRAY:
      return { format: 32, payload: expandGray(data) };
    case KittyGraphicsFormat.GRAY_ALPHA:
      return { format: 32, payload: expandGrayAlpha(data) };
    default:
      return null;
  }
}

/**
 * Expand grayscale data to RGBA by replicating the gray value
 * to R, G, B channels with full alpha.
 */
function expandGray(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.byteLength * 4);
  let outIdx = 0;
  for (let i = 0; i < data.byteLength; i++) {
    const v = data[i] ?? 0;
    out[outIdx++] = v;
    out[outIdx++] = v;
    out[outIdx++] = v;
    out[outIdx++] = 255;
  }
  return out;
}

/**
 * Expand grayscale+alpha data to RGBA by replicating the gray value
 * to R, G, B channels and preserving the alpha channel.
 */
function expandGrayAlpha(data: Uint8Array): Uint8Array {
  const pixels = Math.floor(data.byteLength / 2);
  const out = new Uint8Array(pixels * 4);
  let outIdx = 0;
  for (let i = 0; i < pixels; i++) {
    const gray = data[i * 2] ?? 0;
    const alpha = data[i * 2 + 1] ?? 255;
    out[outIdx++] = gray;
    out[outIdx++] = gray;
    out[outIdx++] = gray;
    out[outIdx++] = alpha;
  }
  return out;
}
