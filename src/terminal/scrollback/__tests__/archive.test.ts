/**
 * Full test coverage for ScrollbackArchive.
 * Integration tests covering all public API methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TerminalCell } from '../../../core/types';
import { ScrollbackArchive } from '../archive';
import { ScrollbackArchiveManager } from '../manager';
import type { ArchivePlacement } from '../placement';

describe('ScrollbackArchive', () => {
  let tempDir: string;
  let archive: ScrollbackArchive;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrollback-test-'));
  });

  afterEach(() => {
    archive?.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates archive with default options', () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });
      expect(archive.length).toBe(0);
      expect(archive.bytes).toBe(0);
    });

    it('creates directory structure', () => {
      const newDir = path.join(tempDir, 'archive');
      expect(fs.existsSync(newDir)).toBe(false);

      archive = new ScrollbackArchive({ rootDir: newDir });

      expect(fs.existsSync(newDir)).toBe(true);
      expect(fs.statSync(newDir).isDirectory()).toBe(true);
    });

    it('registers with manager when provided', () => {
      const manager = new ScrollbackArchiveManager(100 * 1024 * 1024);
      archive = new ScrollbackArchive({ rootDir: tempDir, manager });
      expect(manager.getArchiveCount()).toBe(1);
    });
  });

  describe('appendLines', () => {
    it('appends single line', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const line: TerminalCell[] = Array.from({ length: 80 }, (_, i) => ({
        char: String.fromCharCode(65 + (i % 26)),
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
      }));

      await archive.appendLines([line]);

      expect(archive.length).toBe(1);
      expect(archive.bytes).toBeGreaterThan(0);
    });

    it('appends multiple lines', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 10 }, (_, row) =>
        Array.from({ length: 80 }, (_, col) => ({
          char: String.fromCharCode(65 + ((row + col) % 26)),
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
        }))
      );

      await archive.appendLines(lines);

      expect(archive.length).toBe(10);
    });

    it('handles empty lines array', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      await archive.appendLines([]);

      expect(archive.length).toBe(0);
    });

    it('creates chunks based on column count', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir, chunkMaxLines: 1000 });

      const line80: TerminalCell[] = Array.from({ length: 80 }, () => ({
        char: 'A',
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
      }));

      const line120: TerminalCell[] = Array.from({ length: 120 }, () => ({
        char: 'B',
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
      }));

      await archive.appendLines([line80]);
      await archive.appendLines([line120]);

      expect(archive.length).toBe(2);
    });
  });

  describe('getLine', () => {
    it('returns null for empty archive', () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });
      const line = archive.getLine(0);
      expect(line).toBeNull();
    });

    it('returns null for negative offset', () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });
      const line = archive.getLine(-1);
      expect(line).toBeNull();
    });

    it('returns null for offset beyond length', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const line: TerminalCell[] = Array.from({ length: 80 }, () => ({
        char: 'A',
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
      }));

      await archive.appendLines([line]);
      const result = archive.getLine(1);
      expect(result).toBeNull();
    });

    it('retrieves previously stored line', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 80 }, (_, _col) => ({
          char: String.fromCharCode(65 + row),
          fg: { r: row * 50, g: 100, b: 150 },
          bg: { r: 0, g: 0, b: 0 },
          bold: row % 2 === 0,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
          blink: false,
          dim: false,
          width: 1,
        }))
      );

      await archive.appendLines(lines);

      // Retrieve line 2
      const line2 = archive.getLine(2);
      expect(line2).not.toBeNull();
      expect(line2).toHaveLength(80);
      expect(line2![0].char).toBe('C'); // 65 + 2
      expect(line2![0].bold).toBe(true); // 2 % 2 === 0
    });

    it('uses cache for repeated reads', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const line: TerminalCell[] = Array.from({ length: 80 }, () => ({
        char: 'A',
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
      }));

      await archive.appendLines([line]);

      // First read
      const line1 = archive.getLine(0);
      // Second read should come from cache
      const line2 = archive.getLine(0);

      expect(line1).toEqual(line2);
    });
  });

  describe('prefetchLines', () => {
    it('prefetches lines into cache', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 10 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

      // Prefetch first 5 lines
      archive.prefetchLines(0, 5);

      // All prefetched lines should now be in cache
      for (let i = 0; i < 5; i++) {
        const line = archive.getLine(i);
        expect(line).not.toBeNull();
      }
    });

    it('handles count of 0', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const line: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(line);

      // Should not throw
      archive.prefetchLines(0, 0);
    });
  });

  describe('appendPlacements', () => {
    it('appends placements to current chunk', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      // First append some lines to create a chunk
      const lines: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

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
          archiveOffset: 2,
          originalScreenY: 20,
        },
      ];

      await archive.appendPlacements(placements);

      // Verify placement was stored
      const retrieved = archive.getPlacementsForLineRange(0, 5);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].imageId).toBe(1);
      expect(retrieved[0].archiveOffset).toBe(2);
    });

    it('handles empty placements array', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);
      await archive.appendPlacements([]);

      // Should not throw
      expect(archive.length).toBe(5);
    });

    it('does nothing when no chunks exist', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

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
          archiveOffset: 0,
          originalScreenY: 0,
        },
      ];

      // Should not throw, but placement won't be stored
      await archive.appendPlacements(placements);
    });
  });

  describe('getPlacementsForLineRange', () => {
    it('returns empty array for no placements', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

      const placements = archive.getPlacementsForLineRange(0, 5);
      expect(placements).toHaveLength(0);
    });

    it('returns placements within range', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 10 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

      const testPlacements: ArchivePlacement[] = [
        { ...createTestPlacement(), archiveOffset: 2 },
        { ...createTestPlacement(), archiveOffset: 5 },
        { ...createTestPlacement(), archiveOffset: 8 },
      ];

      await archive.appendPlacements(testPlacements);

      // Get placements for lines 3-6
      const placements = archive.getPlacementsForLineRange(3, 7);
      expect(placements).toHaveLength(1);
      expect(placements[0].archiveOffset).toBe(5);
    });
  });

  describe('dropOldestChunk', () => {
    it('returns null when archive is empty', () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });
      const result = archive.dropOldestChunk();
      expect(result).toBeNull();
    });

    it('removes oldest chunk and returns stats', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir, chunkMaxLines: 5 });

      // Add 10 lines (will create 2 chunks with chunkMaxLines = 5)
      const lines: TerminalCell[][] = Array.from({ length: 10 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);
      expect(archive.length).toBe(10);

      const result = archive.dropOldestChunk();
      expect(result).not.toBeNull();
      expect(result!.linesRemoved).toBe(5);
      expect(archive.length).toBe(5);
    });
  });

  describe('reset', () => {
    it('clears all data', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);
      expect(archive.length).toBe(5);

      archive.reset();
      // Wait for async reset
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(archive.length).toBe(0);
      expect(archive.bytes).toBe(0);
    });
  });

  describe('clearCache', () => {
    it('clears the line cache', async () => {
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

      // Populate cache
      archive.getLine(0);

      // Clear cache - should not throw
      archive.clearCache();
    });
  });

  describe('persistence', () => {
    it('persists data across archive recreation', async () => {
      // Create first archive and add data
      archive = new ScrollbackArchive({ rootDir: tempDir });

      const lines: TerminalCell[][] = Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 80 }, () => ({
          char: String.fromCharCode(65 + row),
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
        }))
      );

      await archive.appendLines(lines);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _revision = archive.getRevision();

      // Dispose first archive
      archive.dispose();
      archive = null as unknown as ScrollbackArchive;

      // Create new archive with same directory
      const newArchive = new ScrollbackArchive({ rootDir: tempDir });

      // Data should be restored
      expect(newArchive.length).toBe(5);

      // Verify data integrity
      const line0 = newArchive.getLine(0);
      expect(line0).not.toBeNull();
      expect(line0![0].char).toBe('A');

      const line4 = newArchive.getLine(4);
      expect(line4).not.toBeNull();
      expect(line4![0].char).toBe('E');

      newArchive.dispose();
    });
  });

  describe('size limits', () => {
    it('enforces per-archive byte limit', async () => {
      // Set a small limit to trigger chunk dropping
      const maxBytes = 10000;
      archive = new ScrollbackArchive({
        rootDir: tempDir,
        maxBytes,
        chunkMaxLines: 1000, // Large chunk limit to avoid chunk-based splitting
      });

      // Add many lines to exceed limit
      const lines: TerminalCell[][] = Array.from({ length: 100 }, () =>
        Array.from({ length: 80 }, () => ({
          char: 'A',
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
        }))
      );

      await archive.appendLines(lines);

      // Should have dropped chunks to stay under limit
      expect(archive.bytes).toBeLessThanOrEqual(maxBytes);
    });
  });
});

describe('ScrollbackArchiveManager', () => {
  let tempDir: string;
  let manager: ScrollbackArchiveManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrollback-manager-test-'));
    manager = new ScrollbackArchiveManager(100000); // 100KB global limit
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('tracks multiple archives', () => {
    const archive1 = new ScrollbackArchive({ rootDir: `${tempDir}/1`, manager });
    const archive2 = new ScrollbackArchive({ rootDir: `${tempDir}/2`, manager });

    expect(manager.getArchiveCount()).toBe(2);

    archive1.dispose();
    archive2.dispose();
  });

  it('unregisters archives on dispose', () => {
    const archive = new ScrollbackArchive({ rootDir: tempDir, manager });
    expect(manager.getArchiveCount()).toBe(1);

    archive.dispose();
    expect(manager.getArchiveCount()).toBe(0);
  });

  it('enforces global byte limit', async () => {
    const smallManager = new ScrollbackArchiveManager(5000); // Very small limit
    const archive1 = new ScrollbackArchive({
      rootDir: `${tempDir}/1`,
      manager: smallManager,
      maxBytes: 10000, // Per-archive limit higher than global
    });
    const archive2 = new ScrollbackArchive({
      rootDir: `${tempDir}/2`,
      manager: smallManager,
      maxBytes: 10000,
    });

    // Add data to both archives
    const lines: TerminalCell[][] = Array.from({ length: 50 }, () =>
      Array.from({ length: 80 }, () => ({
        char: 'A',
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
      }))
    );

    await archive1.appendLines(lines);
    await archive2.appendLines(lines);

    // Trigger global limit enforcement
    smallManager.enforceGlobalLimit();

    // Total should be under global limit
    expect(smallManager.getTotalBytes()).toBeLessThanOrEqual(5000);

    archive1.dispose();
    archive2.dispose();
  });
});

function createTestPlacement(): ArchivePlacement {
  return {
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
    archiveOffset: 0,
    originalScreenY: 20,
  };
}
