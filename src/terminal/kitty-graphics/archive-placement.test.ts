/**
 * Unit tests for ArchivePlacement serialization
 */

import { describe, it, expect } from 'bun:test';
import type { KittyGraphicsPlacement, KittyGraphicsPlacementTag } from '../emulator-interface';
import {
  PLACEMENT_SIZE,
  packPlacement,
  unpackPlacement,
  packPlacements,
  unpackPlacements,
  toArchivePlacement,
  type ArchivePlacement,
  PlacementSerializeError,
} from './archive-placement';

describe('ArchivePlacement serialization', () => {
  // Base placement fixture
  const basePlacement: KittyGraphicsPlacement = {
    imageId: 42,
    placementId: 7,
    placementTag: 0 as KittyGraphicsPlacementTag, // INTERNAL
    screenX: 10,
    screenY: 5,
    xOffset: 0,
    yOffset: 0,
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 100,
    sourceHeight: 50,
    columns: 10,
    rows: 5,
    z: 0,
  };

  describe('PLACEMENT_SIZE', () => {
    it('should be 64 bytes', () => {
      expect(PLACEMENT_SIZE).toBe(64);
    });
  });

  describe('packPlacement / unpackPlacement', () => {
    it('should round-trip a basic placement', () => {
      const archivePlacement: ArchivePlacement = {
        ...basePlacement,
        archiveOffset: 12345,
        originalScreenY: 100,
      };

      const packed = packPlacement(archivePlacement);
      expect(packed.byteLength).toBe(PLACEMENT_SIZE);

      const unpacked = unpackPlacement(packed);
      expect(unpacked).toEqual(archivePlacement);
    });

    it('should round-trip with zero values', () => {
      const zeroPlacement: ArchivePlacement = {
        imageId: 0,
        placementId: 0,
        placementTag: 0 as KittyGraphicsPlacementTag,
        screenX: 0,
        screenY: 0,
        xOffset: 0,
        yOffset: 0,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 0,
        sourceHeight: 0,
        columns: 0,
        rows: 0,
        z: 0,
        archiveOffset: 0,
        originalScreenY: 0,
      };

      const packed = packPlacement(zeroPlacement);
      const unpacked = unpackPlacement(packed);
      expect(unpacked).toEqual(zeroPlacement);
    });

    it('should round-trip with maximum u32 values', () => {
      const maxPlacement: ArchivePlacement = {
        imageId: 0xffffffff,
        placementId: 0xffffffff,
        placementTag: 1 as KittyGraphicsPlacementTag, // EXTERNAL
        screenX: 0xffffffff,
        screenY: 0xffffffff,
        xOffset: 0xffffffff,
        yOffset: 0xffffffff,
        sourceX: 0xffffffff,
        sourceY: 0xffffffff,
        sourceWidth: 0xffffffff,
        sourceHeight: 0xffffffff,
        columns: 0xffffffff,
        rows: 0xffffffff,
        z: 0x7fffffff, // Max i32 positive
        archiveOffset: 0xffffffff,
        originalScreenY: 0xffffffff,
      };

      const packed = packPlacement(maxPlacement);
      const unpacked = unpackPlacement(packed);
      expect(unpacked).toEqual(maxPlacement);
    });

    it('should handle negative z values', () => {
      const negativeZPlacement: ArchivePlacement = {
        ...basePlacement,
        z: -100,
        archiveOffset: 0,
        originalScreenY: 0,
      };

      const packed = packPlacement(negativeZPlacement);
      const unpacked = unpackPlacement(packed);
      expect(unpacked.z).toBe(-100);
    });

    it('should return error on buffer too small', () => {
      const smallBuffer = new ArrayBuffer(59);
      const result = unpackPlacement(smallBuffer);
      expect(result).toBeInstanceOf(PlacementSerializeError);
      expect((result as PlacementSerializeError).message).toMatch(/Buffer too small/);
    });

    it('should handle external placement tag', () => {
      const externalPlacement: ArchivePlacement = {
        ...basePlacement,
        placementTag: 1 as KittyGraphicsPlacementTag, // EXTERNAL
        archiveOffset: 999,
        originalScreenY: 50,
      };

      const packed = packPlacement(externalPlacement);
      const unpacked = unpackPlacement(packed);
      expect(unpacked.placementTag).toBe(1);
    });
  });

  describe('packPlacements / unpackPlacements', () => {
    it('should round-trip multiple placements', () => {
      const placements: ArchivePlacement[] = [
        {
          ...basePlacement,
          imageId: 1,
          placementId: 1,
          archiveOffset: 100,
          originalScreenY: 10,
        },
        {
          ...basePlacement,
          imageId: 2,
          placementId: 2,
          archiveOffset: 200,
          originalScreenY: 20,
        },
        {
          ...basePlacement,
          imageId: 3,
          placementId: 3,
          archiveOffset: 300,
          originalScreenY: 30,
        },
      ];

      const packed = packPlacements(placements);
      expect(packed.byteLength).toBe(placements.length * PLACEMENT_SIZE);

      const unpacked = unpackPlacements(packed);
      expect(unpacked).toEqual(placements);
    });

    it('should handle empty array', () => {
      const placements: ArchivePlacement[] = [];
      const packed = packPlacements(placements);
      expect(packed.byteLength).toBe(0);

      const unpacked = unpackPlacements(packed);
      expect(unpacked).toEqual([]);
    });

    it('should unpack specific count from larger buffer', () => {
      const placements: ArchivePlacement[] = [
        {
          ...basePlacement,
          imageId: 1,
          archiveOffset: 100,
          originalScreenY: 10,
        },
        {
          ...basePlacement,
          imageId: 2,
          archiveOffset: 200,
          originalScreenY: 20,
        },
      ];

      const packed = packPlacements(placements);
      // Unpack only first placement
      const unpacked = unpackPlacements(packed, 1);
      expect(unpacked.length).toBe(1);
      expect(unpacked[0].imageId).toBe(1);
    });

    it('should return error when count exceeds buffer size', () => {
      const packed = packPlacements([{ ...basePlacement, archiveOffset: 0, originalScreenY: 0 }]);
      const result = unpackPlacements(packed, 2);
      expect(result).toBeInstanceOf(PlacementSerializeError);
      expect((result as PlacementSerializeError).message).toMatch(/Buffer too small/);
    });
  });

  describe('toArchivePlacement', () => {
    it('should convert KittyGraphicsPlacement to ArchivePlacement', () => {
      const result = toArchivePlacement(basePlacement, 500, 50);

      expect(result.imageId).toBe(basePlacement.imageId);
      expect(result.placementId).toBe(basePlacement.placementId);
      expect(result.screenX).toBe(basePlacement.screenX);
      expect(result.screenY).toBe(basePlacement.screenY);
      expect(result.archiveOffset).toBe(500);
      expect(result.originalScreenY).toBe(50);
    });

    it('should not mutate original placement', () => {
      const original = { ...basePlacement };
      const result = toArchivePlacement(original, 100, 10);

      // Ensure original wasn't mutated
      expect(original).not.toHaveProperty('archiveOffset');
      expect(original).not.toHaveProperty('originalScreenY');
      expect(result).not.toBe(original);
    });
  });

  describe('binary format compliance', () => {
    it('should produce exactly 64 bytes', () => {
      const placement: ArchivePlacement = {
        ...basePlacement,
        archiveOffset: 0xdeadbeef,
        originalScreenY: 0xcafebabe,
      };

      const packed = packPlacement(placement);
      expect(packed.byteLength).toBe(64);
    });

    it('should use little-endian encoding', () => {
      const placement: ArchivePlacement = {
        ...basePlacement,
        imageId: 0x01020304,
        archiveOffset: 0xdeadbeef,
        originalScreenY: 0,
      };

      const packed = packPlacement(placement);
      const view = new DataView(packed);

      // First 4 bytes should be imageId in little-endian: 04 03 02 01
      expect(view.getUint8(0)).toBe(0x04);
      expect(view.getUint8(1)).toBe(0x03);
      expect(view.getUint8(2)).toBe(0x02);
      expect(view.getUint8(3)).toBe(0x01);

      // archiveOffset at offset 56 should be 0xdeadbeef in little-endian: ef be ad de
      expect(view.getUint8(56)).toBe(0xef);
      expect(view.getUint8(57)).toBe(0xbe);
      expect(view.getUint8(58)).toBe(0xad);
      expect(view.getUint8(59)).toBe(0xde);
    });

    it('should have correct field offsets', () => {
      // Verify the binary layout matches the documented format
      const placement: ArchivePlacement = {
        imageId: 1,
        placementId: 2,
        placementTag: 3 as KittyGraphicsPlacementTag,
        screenX: 4,
        screenY: 5,
        xOffset: 6,
        yOffset: 7,
        sourceX: 8,
        sourceY: 9,
        sourceWidth: 10,
        sourceHeight: 11,
        columns: 12,
        rows: 13,
        z: 14,
        archiveOffset: 15,
        originalScreenY: 16,
      };

      const packed = packPlacement(placement);
      const view = new DataView(packed);

      expect(view.getUint32(0, true)).toBe(1); // imageId
      expect(view.getUint32(4, true)).toBe(2); // placementId
      expect(view.getUint8(8)).toBe(3); // placementTag
      // bytes 9-11: padding
      expect(view.getUint32(12, true)).toBe(4); // screenX
      expect(view.getUint32(16, true)).toBe(5); // screenY
      expect(view.getUint32(20, true)).toBe(6); // xOffset
      expect(view.getUint32(24, true)).toBe(7); // yOffset
      expect(view.getUint32(28, true)).toBe(8); // sourceX
      expect(view.getUint32(32, true)).toBe(9); // sourceY
      expect(view.getUint32(36, true)).toBe(10); // sourceWidth
      expect(view.getUint32(40, true)).toBe(11); // sourceHeight
      expect(view.getUint32(44, true)).toBe(12); // columns
      expect(view.getUint32(48, true)).toBe(13); // rows
      expect(view.getInt32(52, true)).toBe(14); // z
      expect(view.getUint32(56, true)).toBe(15); // archiveOffset
      expect(view.getUint32(60, true)).toBe(16); // originalScreenY
    });
  });
});
