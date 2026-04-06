import { Buffer } from 'buffer';
import type { KittyGraphicsImageInfo } from '../emulator-interface';
import type { PlacementRender } from './types';
import { prepareImageData } from './image';

const ESC = '\x1b';
const KITTY_ESCAPE = `${ESC}_G`;
const KITTY_END = `${ESC}\\`;
const BASE64_CHUNK_SIZE = 4096;

/**
 * Build a Kitty graphics transmit command for image data.
 *
 * Prepares the image data (converting format if needed), then builds
 * a chunked transmit sequence. Large images are split into multiple
 * sequences with the m=1 flag (more data coming).
 *
 * @param hostId - Host-assigned image ID
 * @param info - Image metadata (width, height, format)
 * @param data - Raw image pixel data
 * @returns Complete transmit sequence string
 */
export function buildTransmitImage(
  hostId: number,
  info: KittyGraphicsImageInfo,
  data: Uint8Array
): string {
  const prepared = prepareImageData(info, data);
  if (!prepared) {
    return '';
  }
  const { format, payload } = prepared;
  const params: Array<[string, string | number]> = [
    ['a', 't'],
    ['q', 2],
    ['f', format],
    ['t', 'd'],
    ['s', info.width],
    ['v', info.height],
    ['i', hostId],
  ];

  const buffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const encoded = buffer.toString('base64');
  const chunks: string[] = [];

  for (let offset = 0; offset < encoded.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = encoded.slice(offset, offset + BASE64_CHUNK_SIZE);
    const more = offset + BASE64_CHUNK_SIZE < encoded.length;
    const chunkParams: Array<[string, string | number]> = more
      ? [...params, ['m', 1] as [string, number]]
      : params;
    chunks.push(buildKittyCommand(chunkParams, chunk));
  }

  return chunks.join('');
}

/**
 * Build a Kitty graphics display (placement) command.
 *
 * Positions the cursor, saves cursor position (ESC 7),
 * sends the placement command, then restores cursor (ESC 8).
 *
 * Parameters include:
 * - C=1: Do not move cursor after display
 * - c,r: Cell dimensions for the placement
 * - x,y: Source image crop offset
 * - w,h: Source image crop dimensions
 * - X,Y: Cell offset within the target cell
 * - z: Z-index for layering
 *
 * @param render - Placement render parameters
 * @returns Complete display sequence with cursor positioning
 */
export function buildDisplay(render: PlacementRender): string {
  const params: Array<[string, string | number]> = [
    ['a', 'p'],
    ['q', 2],
    ['C', 1],
    ['i', render.hostImageId],
    ['p', render.hostPlacementId],
  ];

  if (render.includeColumns) params.push(['c', render.columns]);
  if (render.includeRows) params.push(['r', render.rows]);
  if (render.sourceX > 0) params.push(['x', render.sourceX]);
  if (render.sourceY > 0) params.push(['y', render.sourceY]);
  if (render.sourceWidth > 0) params.push(['w', render.sourceWidth]);
  if (render.sourceHeight > 0) params.push(['h', render.sourceHeight]);
  if (render.xOffset > 0) params.push(['X', render.xOffset]);
  if (render.yOffset > 0) params.push(['Y', render.yOffset]);
  if (render.z !== 0) params.push(['z', render.z]);

  const position = `${ESC}[${render.globalRow + 1};${render.globalCol + 1}H`;
  return `${ESC}7${position}${buildKittyCommand(params)}${ESC}8`;
}

/**
 * Build a Kitty graphics delete placement command.
 *
 * Deletes a specific placement (instance) of an image without
 * deleting the image itself (which may have other placements).
 *
 * @param hostImageId - Host image ID
 * @param hostPlacementId - Placement ID to delete
 * @returns Delete placement sequence
 */
export function buildDeletePlacement(hostImageId: number, hostPlacementId: number): string {
  return buildKittyCommand([
    ['a', 'd'],
    ['q', 2],
    ['d', 'i'],
    ['i', hostImageId],
    ['p', hostPlacementId],
  ]);
}

/**
 * Build a Kitty graphics delete image command.
 *
 * Deletes an image entirely (d=I), removing all its placements.
 * Unlike delete placement, this removes the image from the host
 * terminal's storage.
 *
 * @param hostImageId - Host image ID to delete
 * @returns Delete image sequence
 */
export function buildDeleteImage(hostImageId: number): string {
  return buildKittyCommand([
    ['a', 'd'],
    ['q', 2],
    ['d', 'I'],
    ['i', hostImageId],
  ]);
}

function buildKittyCommand(params: Array<[string, string | number]>, data = ''): string {
  const control = params.map(([key, value]) => `${key}=${value}`).join(',');
  return `${KITTY_ESCAPE}${control};${data}${KITTY_END}`;
}
