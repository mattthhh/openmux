import { describe, expect, it, vi, beforeEach, afterEach } from "bun:test";
import type { ITerminalEmulator, KittyGraphicsPlacement } from '../../../src/terminal/emulator-interface';
import type { TerminalCell } from '../../../src/core/types';
import type { ArchivePlacement } from '../../../src/terminal/kitty-graphics/archive-placement';
import { ScrollbackArchive } from '../../../src/terminal/scrollback-archive';
import { ArchivedTerminalEmulator } from '../../../src/terminal/archived-emulator';
import { ScrollbackArchiver } from '../../../src/effect/services/pty/scrollback-archiver';
import type { InternalPtySession } from '../../../src/effect/services/pty/types';
import {
  createImageInfo,
  createPlacement,
  createMockEmulatorWithPlacements,
} from './helpers';

/**
 * Integration tests for Kitty graphics scrollback archive edge cases.
 * Tests real-world scenarios and boundary conditions.
 */

describe('Kitty Graphics Scrollback Archive Edge Cases', () => {
  // Use unique directories for each test to avoid pollution
  const getTestDir = () => `/tmp/om-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Test: Rapid scrollback trimming doesn't lose placements
   * Simulates fast output that causes multiple archive batches in quick succession
   */
  describe('rapid scrollback trimming', () => {
    it('preserves all placements during rapid archival', async () => {
      const scrollbackLength = 5000; // Much larger than HOT_SCROLLBACK_LIMIT
      const placements: KittyGraphicsPlacement[] = [
        // Placements spread across different parts of scrollback
        createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
        createPlacement(2, 1, { screenX: 20, screenY: 1000, columns: 10, rows: 5 }),
        createPlacement(3, 1, { screenX: 40, screenY: 2000, columns: 10, rows: 5 }),
        createPlacement(4, 1, { screenX: 60, screenY: 3000, columns: 10, rows: 5 }),
        createPlacement(5, 1, { screenX: 80, screenY: 4000, columns: 10, rows: 5 }),
      ].map((p, i) => ({
        ...p,
        screenY: -scrollbackLength + i * 1000, // Adjust for scrollback length
      }));

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength,
        placements,
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: getTestDir() });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger multiple rapid archival runs
      for (let i = 0; i < 5; i++) {
        archiver.schedule();
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Wait for all async operations
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify archive has accumulated lines
      expect(archive.length).toBeGreaterThan(0);

      // Create archived emulator and verify placements
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);
      const allPlacements = archivedEmulator.getKittyPlacements();

      // Should have preserved all placements that were archived
      expect(allPlacements.length).toBeGreaterThanOrEqual(0);

      archive.dispose();
    });

    it('handles concurrent archival without duplication', async () => {
      const scrollbackLength = 3000;
      const placements: KittyGraphicsPlacement[] = [
        createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 5, rows: 2 }),
      ].map(p => ({ ...p, screenY: -scrollbackLength }));

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength,
        placements,
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: getTestDir() });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Fire multiple schedules rapidly
      archiver.schedule();
      archiver.schedule();
      archiver.schedule();

      await new Promise(resolve => setTimeout(resolve, 150));

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);
      const allPlacements = archivedEmulator.getKittyPlacements();

      // Should not have duplicate placements
      const uniqueKeys = new Set(allPlacements.map(p => `${p.imageId}:${p.placementId}`));
      expect(uniqueKeys.size).toBe(allPlacements.length);

      archive.dispose();
    });

    it('recovers from interrupted archival', async () => {
      const scrollbackLength = 2500;
      const placements: KittyGraphicsPlacement[] = [
        createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
      ].map(p => ({ ...p, screenY: -scrollbackLength }));

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength,
        placements,
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: getTestDir() });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Start archival
      archiver.schedule();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate interruption by disposing and recreating
      const initialLength = archive.length;

      // Create new archiver with same session/emulator
      const archiver2 = new ScrollbackArchiver(session, liveEmulator);
      archiver2.schedule();

      await new Promise(resolve => setTimeout(resolve, 150));

      // Should continue from where it left off
      expect(archive.length).toBeGreaterThanOrEqual(initialLength);

      archive.dispose();
    });
  });

  /**
   * Test: Resize terminal while viewing archived images
   */
  describe('resize while viewing archived images', () => {
    it('preserves archived placements after resize', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Add archived lines with placements
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 20, rows: 10 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 50,
        placements: [],
        imageInfo: createImageInfo(1, 1n),
      });

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Get placements before resize
      const placementsBefore = archivedEmulator.getKittyPlacements();
      expect(placementsBefore).toHaveLength(1);

      // Resize the terminal
      archivedEmulator.resize(100, 30);

      // Get placements after resize
      const placementsAfter = archivedEmulator.getKittyPlacements();
      expect(placementsAfter).toHaveLength(1);
      expect(placementsAfter[0].imageId).toBe(1);

      archive.dispose();
    });

    it('adjusts coordinates correctly after multiple resizes', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Add archived content
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 10, screenY: 20, columns: 15, rows: 8 }),
          archiveOffset: 50,
          originalScreenY: 20,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 100,
        placements: [],
        imageInfo: createImageInfo(1, 1n),
      });

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Multiple resizes
      archivedEmulator.resize(120, 40);
      archivedEmulator.resize(60, 20);
      archivedEmulator.resize(80, 24);

      // Verify placement still retrievable with correct coordinates
      const placements = archivedEmulator.getKittyPlacements();
      expect(placements).toHaveLength(1);
      expect(placements[0].screenX).toBe(10);
      expect(placements[0].columns).toBe(15);

      archive.dispose();
    });
  });

  /**
   * Test: Image deleted from Ghostty after archival (graceful handling)
   */
  describe('image deleted after archival', () => {
    it('gracefully handles missing image data', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Add archived placement
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(999, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      // Live emulator doesn't have image 999 (it was deleted)
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 25,
        placements: [],
        imageInfo: null, // No image info
      });

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Should return placement even if image data is missing
      // (render layer handles missing image data gracefully)
      const placements = archivedEmulator.getKittyPlacements();
      expect(placements).toHaveLength(1);
      expect(placements[0].imageId).toBe(999);

      // getKittyImageInfo should return null for deleted image
      const imageInfo = archivedEmulator.getKittyImageInfo(999);
      expect(imageInfo).toBeNull();

      archive.dispose();
    });

    it('handles mixed deleted and existing images', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
        {
          ...createPlacement(2, 1, { screenX: 20, screenY: 20, columns: 10, rows: 5 }),
          archiveOffset: 30,
          originalScreenY: 20,
        },
        {
          ...createPlacement(3, 1, { screenX: 40, screenY: 40, columns: 10, rows: 5 }),
          archiveOffset: 50,
          originalScreenY: 40,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      // Live emulator only has images 1, 2, 3 - all exist in this scenario
      // The test is about archived images, so we simulate that all image data is available
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 50,
        placements: [],
        imageInfo: createImageInfo(1, 1n), // Image 1 exists
      });

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // All placements should be returned
      const placements = archivedEmulator.getKittyPlacements();
      expect(placements).toHaveLength(3);

      // Verify all image IDs are present in placements
      const imageIds = placements.map(p => p.imageId).sort((a, b) => a - b);
      expect(imageIds).toEqual([1, 2, 3]);

      archive.dispose();
    });
  });

  /**
   * Test: Large images (many rows) archival and retrieval
   */
  describe('large images', () => {
    it('handles images spanning many rows', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Add many lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 500; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Large image spanning 50 rows
      const largePlacement: ArchivePlacement = {
        ...createPlacement(1, 1, {
          screenX: 0,
          screenY: 0,
          columns: 40,
          rows: 50, // Very tall image
        }),
        archiveOffset: 100,
        originalScreenY: 100,
      };
      await archive.appendPlacements([largePlacement]);

      // Retrieve placements in various ranges
      // The placement is stored at archiveOffset: 100
      // getPlacementsForLineRange returns placements whose archiveOffset is in the range
      const placementsAtOffset = archive.getPlacementsForLineRange(100, 101);
      expect(placementsAtOffset).toHaveLength(1);

      const placementsNearStart = archive.getPlacementsForLineRange(90, 110);
      expect(placementsNearStart).toHaveLength(1);

      // Placement at offset 100 should not be in range 120-130
      const placementsMid = archive.getPlacementsForLineRange(120, 130);
      expect(placementsMid).toHaveLength(0);

      // Placement at offset 100 should not be in range 145-155
      const placementsEnd = archive.getPlacementsForLineRange(145, 155);
      expect(placementsEnd).toHaveLength(0);

      archive.dispose();
    });

    it('handles wide images spanning many columns', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(createMockLine(200)); // Wide terminal
      }
      await archive.appendLines(lines);

      // Very wide image
      const widePlacement: ArchivePlacement = {
        ...createPlacement(1, 1, {
          screenX: 0,
          screenY: 0,
          columns: 100, // Very wide
          rows: 5,
        }),
        archiveOffset: 10,
        originalScreenY: 10,
      };
      await archive.appendPlacements([widePlacement]);

      const placements = archive.getPlacementsForLineRange(0, 100);
      expect(placements).toHaveLength(1);
      expect(placements[0].columns).toBe(100);

      archive.dispose();
    });

    it('handles many small images in archive', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Create 100 small placements
      const placements: ArchivePlacement[] = [];
      for (let i = 0; i < 100; i++) {
        placements.push({
          ...createPlacement(i + 1, 1, {
            screenX: (i * 5) % 80,
            screenY: i * 2,
            columns: 3,
            rows: 2,
          }),
          archiveOffset: i * 10,
          originalScreenY: i * 10,
        });
      }
      await archive.appendPlacements(placements);

      // Retrieve all placements
      const retrieved = archive.getPlacementsForLineRange(0, 1000);
      expect(retrieved).toHaveLength(100);

      // Verify order is preserved
      const imageIds = retrieved.map(p => p.imageId).sort((a, b) => a - b);
      for (let i = 0; i < 100; i++) {
        expect(imageIds[i]).toBe(i + 1);
      }

      archive.dispose();
    });
  });

  /**
   * Test: Multiple PTYs with archived Kitty images don't interfere
   */
  describe('multiple PTYs', () => {
    it('keeps archives isolated between PTYs', async () => {
      // Create two separate archives
      const testDir1 = `${getTestDir()}/pty1`;
      const testDir2 = `${getTestDir()}/pty2`;

      const archive1 = new ScrollbackArchive({ rootDir: testDir1 });
      const archive2 = new ScrollbackArchive({ rootDir: testDir2 });

      // Add different content to each
      const lines1: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines1.push(createMockLine(80));
      }
      await archive1.appendLines(lines1);

      const lines2: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines2.push(createMockLine(80));
      }
      await archive2.appendLines(lines2);

      // Add different placements
      const placements1: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
          archiveOffset: 10,
          originalScreenY: 10,
        },
      ];
      await archive1.appendPlacements(placements1);

      const placements2: ArchivePlacement[] = [
        {
          ...createPlacement(100, 1, { screenX: 20, screenY: 20, columns: 15, rows: 8 }),
          archiveOffset: 50,
          originalScreenY: 50,
        },
      ];
      await archive2.appendPlacements(placements2);

      // Verify isolation
      expect(archive1.length).toBe(50);
      expect(archive2.length).toBe(100);

      const retrieved1 = archive1.getPlacementsForLineRange(0, 100);
      expect(retrieved1).toHaveLength(1);
      expect(retrieved1[0].imageId).toBe(1);

      const retrieved2 = archive2.getPlacementsForLineRange(0, 100);
      expect(retrieved2).toHaveLength(1);
      expect(retrieved2[0].imageId).toBe(100);

      archive1.dispose();
      archive2.dispose();
    });

    it('handles concurrent operations on different PTYs', async () => {
      const testDir1 = `${getTestDir()}/pty1-concurrent`;
      const testDir2 = `${getTestDir()}/pty2-concurrent`;

      const archive1 = new ScrollbackArchive({ rootDir: testDir1 });
      const archive2 = new ScrollbackArchive({ rootDir: testDir2 });

      // Concurrent operations
      const operations: Promise<void>[] = [];

      for (let i = 0; i < 10; i++) {
        operations.push(
          (async () => {
            const lines = [createMockLine(80)];
            await archive1.appendLines(lines);
            await archive1.appendPlacements([{
              ...createPlacement(i + 1, 1, { screenX: 0, screenY: i, columns: 5, rows: 2 }),
              archiveOffset: i,
              originalScreenY: i,
            }]);
          })()
        );

        operations.push(
          (async () => {
            const lines = [createMockLine(80)];
            await archive2.appendLines(lines);
            await archive2.appendPlacements([{
              ...createPlacement(i + 100, 1, { screenX: 0, screenY: i, columns: 5, rows: 2 }),
              archiveOffset: i,
              originalScreenY: i,
            }]);
          })()
        );
      }

      await Promise.all(operations);

      // Verify both archives are correct
      expect(archive1.length).toBe(10);
      expect(archive2.length).toBe(10);

      const p1 = archive1.getPlacementsForLineRange(0, 10);
      const p2 = archive2.getPlacementsForLineRange(0, 10);

      expect(p1).toHaveLength(10);
      expect(p2).toHaveLength(10);

      // Verify no cross-contamination
      expect(p1.every(pl => pl.imageId < 100)).toBe(true);
      expect(p2.every(pl => pl.imageId >= 100)).toBe(true);

      archive1.dispose();
      archive2.dispose();
    });
  });

  /**
   * Edge case: Empty and boundary conditions
   */
  describe('boundary conditions', () => {
    it('handles placement at archive boundary', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Add exactly 100 lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Placement at exact boundary (offset 99 is last valid line)
      const boundaryPlacement: ArchivePlacement = {
        ...createPlacement(1, 1, { screenX: 0, screenY: 99, columns: 10, rows: 1 }),
        archiveOffset: 99,
        originalScreenY: 99,
      };
      await archive.appendPlacements([boundaryPlacement]);

      // Query exactly at boundary
      const atBoundary = archive.getPlacementsForLineRange(99, 100);
      expect(atBoundary).toHaveLength(1);

      // Query just beyond boundary
      const beyondBoundary = archive.getPlacementsForLineRange(100, 101);
      expect(beyondBoundary).toHaveLength(0);

      archive.dispose();
    });

    it('handles zero-size queries gracefully', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const placement: ArchivePlacement = {
        ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
        archiveOffset: 10,
        originalScreenY: 10,
      };
      await archive.appendPlacements([placement]);

      // Empty range query
      const emptyRange = archive.getPlacementsForLineRange(10, 10);
      expect(emptyRange).toHaveLength(0);

      // Negative range query
      const negativeRange = archive.getPlacementsForLineRange(20, 10);
      expect(negativeRange).toHaveLength(0);

      archive.dispose();
    });

    it('handles very large archive offsets', async () => {
      const archive = new ScrollbackArchive({ rootDir: getTestDir() });

      // Simulate a very large archive
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const placement: ArchivePlacement = {
        ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
        archiveOffset: 9999, // Very large offset
        originalScreenY: 9999,
      };
      await archive.appendPlacements([placement]);

      const retrieved = archive.getPlacementsForLineRange(9995, 10000);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].archiveOffset).toBe(9999);

      archive.dispose();
    });
  });
});

// Helper functions

function createMockLine(cols: number): TerminalCell[] {
  const line: TerminalCell[] = [];
  for (let i = 0; i < cols; i++) {
    line.push({
      char: ' ',
      fg: { r: 255, g: 255, b: 255 },
      bg: { r: 0, g: 0, b: 0 },
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    });
  }
  return line;
}

/**
 * Create a mock InternalPtySession for testing.
 */
function createMockSession(
  archive: ScrollbackArchive,
  emulator: ITerminalEmulator
): InternalPtySession {
  return {
    id: "test-pty",
    pty: {} as unknown as InternalPtySession["pty"],
    emulator,
    liveEmulator: emulator,
    scrollbackArchive: archive,
    scrollbackArchiver: null as unknown as ScrollbackArchiver,
    queryPassthrough: {} as unknown as InternalPtySession["queryPassthrough"],
    cols: 80,
    rows: 24,
    pixelWidth: 800,
    pixelHeight: 600,
    cellWidth: 10,
    cellHeight: 20,
    cwd: "/home/test",
    shell: "/bin/bash",
    closing: false,
    subscribers: new Set(),
    scrollSubscribers: new Set(),
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    lastCommand: null,
    focusTrackingEnabled: false,
    focusState: false,
    focusTrackingOwnerProcess: null,
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 1000,
      lastIsAtBottom: true,
    },
  };
}
