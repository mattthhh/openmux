import type { KittyGraphicsImageInfo, KittyGraphicsPlacement } from '../emulator-interface';
import {
  KittyGraphicsFormat,
  KittyGraphicsCompression,
  KittyGraphicsPlacementTag,
} from '../emulator-interface';
import type { GhosttyVtTerminal } from './terminal';
import {
  GhosttyKittyImageFormat,
  GhosttyKittyCompression,
  GhosttyKittyPlacementTag,
} from './types';

/** Map native Ghostty image format to interface format */
function mapImageFormat(format: GhosttyKittyImageFormat): KittyGraphicsFormat {
  switch (format) {
    case GhosttyKittyImageFormat.RGB:
      return KittyGraphicsFormat.RGB;
    case GhosttyKittyImageFormat.RGBA:
      return KittyGraphicsFormat.RGBA;
    case GhosttyKittyImageFormat.PNG:
      return KittyGraphicsFormat.PNG;
    case GhosttyKittyImageFormat.GRAY_ALPHA:
      return KittyGraphicsFormat.GRAY_ALPHA;
    case GhosttyKittyImageFormat.GRAY:
      return KittyGraphicsFormat.GRAY;
    default:
      return KittyGraphicsFormat.RGB;
  }
}

/** Map native Ghostty compression to interface compression */
function mapCompression(compression: GhosttyKittyCompression): KittyGraphicsCompression {
  switch (compression) {
    case GhosttyKittyCompression.NONE:
      return KittyGraphicsCompression.NONE;
    case GhosttyKittyCompression.ZLIB_DEFLATE:
      return KittyGraphicsCompression.ZLIB_DEFLATE;
    default:
      return KittyGraphicsCompression.NONE;
  }
}

/** Map native Ghostty placement tag to interface tag */
function mapPlacementTag(tag: GhosttyKittyPlacementTag): KittyGraphicsPlacementTag {
  switch (tag) {
    case GhosttyKittyPlacementTag.INTERNAL:
      return KittyGraphicsPlacementTag.INTERNAL;
    case GhosttyKittyPlacementTag.EXTERNAL:
      return KittyGraphicsPlacementTag.EXTERNAL;
    default:
      return KittyGraphicsPlacementTag.INTERNAL;
  }
}

export function mapKittyImageInfo(
  terminal: GhosttyVtTerminal,
  imageId: number
): KittyGraphicsImageInfo | null {
  const info = terminal.getKittyImageInfo(imageId);
  if (!info) return null;

  return {
    id: info.id,
    number: info.number,
    width: info.width,
    height: info.height,
    dataLength: info.data_len,
    format: mapImageFormat(info.format),
    compression: mapCompression(info.compression),
    implicitId: info.implicit_id !== 0,
    transmitTime: info.transmit_time,
  };
}

export function mapKittyPlacements(terminal: GhosttyVtTerminal): KittyGraphicsPlacement[] {
  const placements = terminal.getKittyPlacements();
  return placements.map((placement) => ({
    imageId: placement.image_id,
    placementId: placement.placement_id,
    placementTag: mapPlacementTag(placement.placement_tag),
    screenX: placement.screen_x,
    screenY: placement.screen_y,
    xOffset: placement.x_offset,
    yOffset: placement.y_offset,
    sourceX: placement.source_x,
    sourceY: placement.source_y,
    sourceWidth: placement.source_width,
    sourceHeight: placement.source_height,
    columns: placement.columns,
    rows: placement.rows,
    z: placement.z,
  }));
}
