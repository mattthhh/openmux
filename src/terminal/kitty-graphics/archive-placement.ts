/**
 * Archive Placement Types and Serialization
 *
 * Defines the ArchivePlacement type for storing Kitty graphics placement
 * metadata in scrollback archives, with binary serialization support.
 *
 * Binary format per placement (64 bytes total):
 * - bytes 0-3:   imageId (u32, little-endian)
 * - bytes 4-7:   placementId (u32, little-endian)
 * - byte 8:      placementTag (u8, 0=INTERNAL, 1=EXTERNAL)
 * - bytes 9-11:  padding (reserved)
 * - bytes 12-15: screenX (u32, little-endian)
 * - bytes 16-19: screenY (u32, little-endian)
 * - bytes 20-23: xOffset (u32, little-endian)
 * - bytes 24-27: yOffset (u32, little-endian)
 * - bytes 28-31: sourceX (u32, little-endian)
 * - bytes 32-35: sourceY (u32, little-endian)
 * - bytes 36-39: sourceWidth (u32, little-endian)
 * - bytes 40-43: sourceHeight (u32, little-endian)
 * - bytes 44-47: columns (u32, little-endian)
 * - bytes 48-51: rows (u32, little-endian)
 * - bytes 52-55: z (i32, little-endian, signed for z-order)
 * - bytes 56-59: archiveOffset (u32, little-endian) - offset in archive where this placement belongs
 * - bytes 60-63: originalScreenY (u32, little-endian) - original screen Y position when archived
 */

import type { KittyGraphicsPlacement, KittyGraphicsPlacementTag } from '../emulator-interface';

/**
 * Extended placement type with archive-specific metadata.
 * Used to track Kitty graphics placements that have scrolled into the archive.
 */
export type ArchivePlacement = KittyGraphicsPlacement & {
  /** Offset in the scrollback archive where this placement's line resides */
  archiveOffset: number;
  /** Original screen Y position when the placement was archived */
  originalScreenY: number;
};

/** Size of a serialized placement in bytes (64 bytes) */
export const PLACEMENT_SIZE = 64;

/**
 * Pack a single placement into a DataView at the given offset
 */
function packPlacementAt(view: DataView, offset: number, placement: ArchivePlacement): void {
  view.setUint32(offset, placement.imageId, true);
  view.setUint32(offset + 4, placement.placementId, true);
  view.setUint8(offset + 8, placement.placementTag);
  // bytes 9-11: padding (reserved)
  view.setUint8(offset + 9, 0);
  view.setUint8(offset + 10, 0);
  view.setUint8(offset + 11, 0);
  view.setUint32(offset + 12, placement.screenX, true);
  view.setUint32(offset + 16, placement.screenY, true);
  view.setUint32(offset + 20, placement.xOffset, true);
  view.setUint32(offset + 24, placement.yOffset, true);
  view.setUint32(offset + 28, placement.sourceX, true);
  view.setUint32(offset + 32, placement.sourceY, true);
  view.setUint32(offset + 36, placement.sourceWidth, true);
  view.setUint32(offset + 40, placement.sourceHeight, true);
  view.setUint32(offset + 44, placement.columns, true);
  view.setUint32(offset + 48, placement.rows, true);
  view.setInt32(offset + 52, placement.z, true);
  view.setUint32(offset + 56, placement.archiveOffset, true);
  view.setUint32(offset + 60, placement.originalScreenY, true);
}

/**
 * Unpack a single placement from a DataView at the given offset
 */
function unpackPlacementAt(view: DataView, offset: number): ArchivePlacement {
  return {
    imageId: view.getUint32(offset, true),
    placementId: view.getUint32(offset + 4, true),
    placementTag: view.getUint8(offset + 8) as KittyGraphicsPlacementTag,
    screenX: view.getUint32(offset + 12, true),
    screenY: view.getUint32(offset + 16, true),
    xOffset: view.getUint32(offset + 20, true),
    yOffset: view.getUint32(offset + 24, true),
    sourceX: view.getUint32(offset + 28, true),
    sourceY: view.getUint32(offset + 32, true),
    sourceWidth: view.getUint32(offset + 36, true),
    sourceHeight: view.getUint32(offset + 40, true),
    columns: view.getUint32(offset + 44, true),
    rows: view.getUint32(offset + 48, true),
    z: view.getInt32(offset + 52, true),
    archiveOffset: view.getUint32(offset + 56, true),
    originalScreenY: view.getUint32(offset + 60, true),
  };
}

/**
 * Pack an ArchivePlacement into an ArrayBuffer
 * @param placement The placement to serialize
 * @returns ArrayBuffer containing the serialized placement (60 bytes)
 */
export function packPlacement(placement: ArchivePlacement): ArrayBuffer {
  const buffer = new ArrayBuffer(PLACEMENT_SIZE);
  const view = new DataView(buffer);
  packPlacementAt(view, 0, placement);
  return buffer;
}

/**
 * Unpack an ArchivePlacement from an ArrayBuffer
 * @param buffer The buffer to deserialize (must be at least 60 bytes)
 * @returns The deserialized ArchivePlacement
 */
export function unpackPlacement(buffer: ArrayBuffer): ArchivePlacement {
  if (buffer.byteLength < PLACEMENT_SIZE) {
    throw new Error(
      `Buffer too small for placement: expected at least ${PLACEMENT_SIZE} bytes, got ${buffer.byteLength}`
    );
  }
  const view = new DataView(buffer);
  return unpackPlacementAt(view, 0);
}

/**
 * Pack multiple placements into an ArrayBuffer
 * @param placements Array of placements to serialize
 * @returns ArrayBuffer containing all serialized placements
 */
export function packPlacements(placements: ArchivePlacement[]): ArrayBuffer {
  const buffer = new ArrayBuffer(placements.length * PLACEMENT_SIZE);
  const view = new DataView(buffer);

  for (let i = 0; i < placements.length; i++) {
    packPlacementAt(view, i * PLACEMENT_SIZE, placements[i]);
  }

  return buffer;
}

/**
 * Unpack multiple placements from an ArrayBuffer
 * @param buffer The buffer to deserialize
 * @param count Number of placements to unpack (defaults to buffer.length / PLACEMENT_SIZE)
 * @returns Array of deserialized ArchivePlacements
 */
export function unpackPlacements(buffer: ArrayBuffer, count?: number): ArchivePlacement[] {
  const placementCount = count ?? Math.floor(buffer.byteLength / PLACEMENT_SIZE);

  if (buffer.byteLength < placementCount * PLACEMENT_SIZE) {
    throw new Error(
      `Buffer too small for ${placementCount} placements: expected at least ${placementCount * PLACEMENT_SIZE} bytes, got ${buffer.byteLength}`
    );
  }

  const view = new DataView(buffer);
  const placements: ArchivePlacement[] = new Array(placementCount);

  for (let i = 0; i < placementCount; i++) {
    placements[i] = unpackPlacementAt(view, i * PLACEMENT_SIZE);
  }

  return placements;
}

/**
 * Convert a KittyGraphicsPlacement to an ArchivePlacement with archive metadata
 * @param placement The base Kitty graphics placement
 * @param archiveOffset The offset in the scrollback archive
 * @param originalScreenY The original screen Y position when archived
 * @returns ArchivePlacement with archive metadata
 */
export function toArchivePlacement(
  placement: KittyGraphicsPlacement,
  archiveOffset: number,
  originalScreenY: number
): ArchivePlacement {
  return {
    ...placement,
    archiveOffset,
    originalScreenY,
  };
}
