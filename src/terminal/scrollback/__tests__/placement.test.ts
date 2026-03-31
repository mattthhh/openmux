/**
 * Placement operations litmus tests.
 * Fast, single-concept tests for Kitty graphics placement handling.
 */

import { describe, it, expect } from 'bun:test';
import type { ArchiveChunk } from '../types';
import {
  packPlacements,
  unpackPlacements,
  rebasePlacementOffset,
  setupPlacementPath,
} from '../placement/manager';
import { type ArchivePlacement } from '../placement';

describe('placement.litmus', () => {
  describe('packPlacements / unpackPlacements', () => {
    it('round-trips single placement', () => {
      const placement: ArchivePlacement = {
        imageId: 1,
        placementId: 1,
        placementTag: 0,
        screenX: 10,
        screenY: 20,
        xOffset: 0,
        yOffset: 0,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 100,
        sourceHeight: 50,
        columns: 10,
        rows: 5,
        z: 0,
        archiveOffset: 100,
        originalScreenY: 30,
      };

      const packed = packPlacements([placement]);
      expect(packed.length).toBe(64); // PLACEMENT_SIZE

      const unpacked = unpackPlacements(packed);
      expect(unpacked).toHaveLength(1);
      expect(unpacked[0]).toEqual(placement);
    });

    it('round-trips multiple placements', () => {
      const placements: ArchivePlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 10,
          screenY: 20,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 50,
          columns: 10,
          rows: 5,
          z: 0,
          archiveOffset: 100,
          originalScreenY: 30,
        },
        {
          imageId: 2,
          placementId: 2,
          placementTag: 1,
          screenX: 50,
          screenY: 60,
          xOffset: 5,
          yOffset: 10,
          sourceX: 10,
          sourceY: 20,
          sourceWidth: 200,
          sourceHeight: 100,
          columns: 20,
          rows: 10,
          z: 1,
          archiveOffset: 200,
          originalScreenY: 70,
        },
      ];

      const packed = packPlacements(placements);
      expect(packed.length).toBe(128); // 2 * 64 bytes

      const unpacked = unpackPlacements(packed);
      expect(unpacked).toHaveLength(2);
      expect(unpacked[0]).toEqual(placements[0]);
      expect(unpacked[1]).toEqual(placements[1]);
    });

    it('handles empty placements array', () => {
      const packed = packPlacements([]);
      expect(packed.length).toBe(0);

      const unpacked = unpackPlacements(packed);
      expect(unpacked).toHaveLength(0);
    });

    it('handles negative z values', () => {
      const placement: ArchivePlacement = {
        imageId: 1,
        placementId: 1,
        placementTag: 0,
        screenX: 0,
        screenY: 0,
        xOffset: 0,
        yOffset: 0,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 100,
        sourceHeight: 50,
        columns: 10,
        rows: 5,
        z: -5,
        archiveOffset: 100,
        originalScreenY: 0,
      };

      const packed = packPlacements([placement]);
      const unpacked = unpackPlacements(packed);
      expect(unpacked[0].z).toBe(-5);
    });
  });

  describe('rebasePlacementOffset', () => {
    it('returns stored offset when no delta', () => {
      const chunk: ArchiveChunk = {
        id: 1,
        filename: 'chunk-1.bin',
        path: '/tmp/chunk-1.bin',
        cols: 80,
        rowBytes: 1284,
        lineCount: 100,
        bytes: 128400,
        createdAt: 1000,
        startOffsetAtWrite: 50,
      };

      // Chunk was written starting at offset 50, current chunk start is also 50
      // No chunks dropped, so delta is 0
      const result = rebasePlacementOffset(chunk, 50, 75);
      expect(result).toBe(75); // 75 - (50 - 50) = 75
    });

    it('adjusts offset when chunks were dropped', () => {
      const chunk: ArchiveChunk = {
        id: 2,
        filename: 'chunk-2.bin',
        path: '/tmp/chunk-2.bin',
        cols: 80,
        rowBytes: 1284,
        lineCount: 100,
        bytes: 128400,
        createdAt: 2000,
        startOffsetAtWrite: 100, // Chunk 1 had 50 lines, so this was written at offset 100
      };

      // Chunk was written starting at offset 100
      // After dropping chunk 1 (50 lines), current chunk start is 50
      // Delta = 100 - 50 = 50
      // Stored offset 150 should rebase to 100 (150 - 50)
      const result = rebasePlacementOffset(chunk, 50, 150);
      expect(result).toBe(100); // 150 - (100 - 50) = 100
    });

    it('handles multiple chunks dropped', () => {
      const chunk: ArchiveChunk = {
        id: 3,
        filename: 'chunk-3.bin',
        path: '/tmp/chunk-3.bin',
        cols: 80,
        rowBytes: 1284,
        lineCount: 100,
        bytes: 128400,
        createdAt: 3000,
        startOffsetAtWrite: 250, // Chunks 1 and 2 had 100 + 150 lines
      };

      // After dropping chunks 1 and 2 (250 lines total), current chunk start is 0
      // Delta = 250 - 0 = 250
      // Stored offset 300 should rebase to 50
      const result = rebasePlacementOffset(chunk, 0, 300);
      expect(result).toBe(50); // 300 - (250 - 0) = 50
    });
  });

  describe('setupPlacementPath', () => {
    it('sets up placement path when not present', () => {
      const chunk: ArchiveChunk = {
        id: 5,
        filename: 'chunk-5.bin',
        path: '/tmp/chunk-5.bin',
        cols: 80,
        rowBytes: 1284,
        lineCount: 100,
        bytes: 128400,
        createdAt: 1000,
        startOffsetAtWrite: 0,
      };

      setupPlacementPath(chunk, '/tmp');

      expect(chunk.placementFilename).toBe('chunk-5-placements.bin');
      expect(chunk.placementPath).toBe('/tmp/chunk-5-placements.bin');
      expect(chunk.placementBytes).toBe(0);
    });

    it('does not modify existing placement path', () => {
      const chunk: ArchiveChunk = {
        id: 5,
        filename: 'chunk-5.bin',
        path: '/tmp/chunk-5.bin',
        cols: 80,
        rowBytes: 1284,
        lineCount: 100,
        bytes: 128400,
        createdAt: 1000,
        startOffsetAtWrite: 0,
        placementFilename: 'existing.bin',
        placementPath: '/other/existing.bin',
        placementBytes: 1000,
      };

      setupPlacementPath(chunk, '/tmp');

      // Should keep existing values
      expect(chunk.placementFilename).toBe('existing.bin');
      expect(chunk.placementPath).toBe('/other/existing.bin');
      expect(chunk.placementBytes).toBe(1000);
    });
  });
});
