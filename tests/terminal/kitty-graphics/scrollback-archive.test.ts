import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { ITerminalEmulator, KittyGraphicsPlacement } from '../../../src/terminal/emulator-interface';
import type { TerminalCell } from '../../../src/core/types';
import type { ArchivePlacement } from '../../../src/terminal/kitty-graphics/archive-placement';
import { ScrollbackArchive } from '../../../src/terminal/scrollback-archive';
import { ArchivedTerminalEmulator } from '../../../src/terminal/archived-emulator';
import * as capabilitiesActual from '../../../src/terminal/capabilities';
import { 
  createImageInfo, 
  createPlacement, 
  defaultRenderTarget, 
  sendKittyTransmit,
  createMockEmulatorWithPlacements,
} from './helpers';

let KittyGraphicsRenderer: typeof import('../../../src/terminal/kitty-graphics').KittyGraphicsRenderer;
let KittyTransmitBroker: typeof import('../../../src/terminal/kitty-graphics').KittyTransmitBroker;
let setKittyTransmitBroker: typeof import('../../../src/terminal/kitty-graphics').setKittyTransmitBroker;

vi.mock('../../../src/terminal/capabilities', () => ({
  ...capabilitiesActual,
  getHostCapabilities: () => ({
    terminalName: 'kitty',
    da1Response: null,
    da2Response: null,
    xtversionResponse: null,
    kittyGraphics: true,
    trueColor: true,
    colors: null,
  }),
}));

beforeAll(async () => {
  ({ KittyGraphicsRenderer, KittyTransmitBroker, setKittyTransmitBroker } =
    await import('../../../src/terminal/kitty-graphics'));
});

describe('Kitty Graphics Scrollback Archive', () => {
  const testDir = '/tmp/openmux-test-scrollback-kitty';

  afterEach(() => {
    setKittyTransmitBroker(null);
    // Clean up test directory
    try {
      const fs = require('node:fs');
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('litmus: Kitty image captured to archive', () => {
    it('preserves image metadata when lines scroll into archive', async () => {
      // Create a mock emulator with Kitty placements
      const placement: KittyGraphicsPlacement = createPlacement(1, 1, {
        screenX: 0,
        screenY: 0,
        columns: 10,
        rows: 5,
      });
      
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 100,
        placements: [placement],
        imageInfo: createImageInfo(1, 1n),
      });

      // Create archive and wrap emulator
      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Initially, placements should come from live emulator only
      const initialPlacements = archivedEmulator.getKittyPlacements();
      expect(initialPlacements).toHaveLength(1);
      expect(initialPlacements[0].imageId).toBe(1);
      expect(initialPlacements[0].placementId).toBe(1);

      // Simulate archiving by adding lines to archive
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(createMockLine(80));
      }
      
      // Manually add placements to archive (simulating what ScrollbackArchiver does)
      const archivePlacements: ArchivePlacement[] = [{
        ...placement,
        archiveOffset: 0,
        originalScreenY: 0,
      }];

      // Store in archive (await async operations)
      await archive.appendLines(lines);
      await archive.appendPlacements(archivePlacements);

      // Now the archive has lines and placements
      expect(archive.length).toBe(50);

      // The archived emulator should return merged placements
      const mergedPlacements = archivedEmulator.getKittyPlacements();
      expect(mergedPlacements.length).toBeGreaterThanOrEqual(1);

      archive.dispose();
    });

    it('adjusts screenY coordinates for archived placements', async () => {
      const placement: KittyGraphicsPlacement = createPlacement(1, 1, {
        screenX: 0,
        screenY: 5, // Original screen position
        columns: 10,
        rows: 3,
      });

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 20,
        placements: [placement],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Add 30 lines to archive
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Archive placement at offset 5
      const archivePlacements: ArchivePlacement[] = [{
        ...placement,
        archiveOffset: 5,
        originalScreenY: 5,
      }];
      await archive.appendPlacements(archivePlacements);

      // Get placements - archived ones should have adjusted screenY
      const placements = archivedEmulator.getKittyPlacements();
      const archivedPlacement = placements.find(p => p.imageId === 1 && p.placementId === 1);
      
      expect(archivedPlacement).toBeDefined();
      // screenY is set to archiveOffset (absolute line position)
      expect(archivedPlacement!.screenY).toBe(5);

      archive.dispose();
    });

    it('offsets live placement coordinates by archive length', async () => {
      // Live emulator placement coordinates are relative to the live buffer.
      // Once lines are archived, wrapped emulator should shift by archive length
      // so geometry math still aligns with total scrollback.
      const livePlacement: KittyGraphicsPlacement = createPlacement(1, 7, {
        screenX: 2,
        screenY: 2000,
        columns: 10,
        rows: 3,
      });

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 1980,
        placements: [livePlacement],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);
      const placements = archivedEmulator.getKittyPlacements();
      const placement = placements.find((p) => p.imageId === 1 && p.placementId === 7);

      expect(placement).toBeDefined();
      expect(placement!.screenY).toBe(2020);

      archive.dispose();
    });
  });

  describe('litmus: Archived image renders correctly', () => {
    it('renders archived placements when viewport shows archived scrollback', async () => {
      const broker = new KittyTransmitBroker();
      broker.setWriter(() => {});
      setKittyTransmitBroker(broker);

      const renderer = new KittyGraphicsRenderer();
      const output: string[] = [];
      const renderTarget = defaultRenderTarget(output, 100);

      // Create emulator with archived scrollback
      // Note: Live emulator needs image IDs so renderer knows about archived images
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 10,
        placements: [], // Live emulator has no placements
        imageInfo: createImageInfo(1, 1n),
        imageIds: [1], // But it knows about image 1
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      
      // Add archived lines with placements
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Place image at archive offset 30
      // scrollbackLength = 60, rows = 25
      // Formula: viewportRow = screenY - scrollbackLength + viewportOffset
      // For archiveOffset 30 to be at row 5: 30 - 60 + viewportOffset = 5, so viewportOffset = 35
      const archivePlacement: ArchivePlacement = {
        ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
        archiveOffset: 30,
        originalScreenY: 0,
      };
      await archive.appendPlacements([archivePlacement]);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      const totalScrollback = archive.length + liveEmulator.getScrollbackLength();
      
      // Update renderer with archived emulator
      // viewportOffset = 35: viewing archive offsets 0-25 (archiveOffset 30 is at row 5)
      renderer.updatePane('pane-1', {
        ptyId: 'pty-1',
        emulator: archivedEmulator,
        offsetX: 0,
        offsetY: 0,
        width: 800,
        height: 500,
        cols: 80,
        rows: 25,
        viewportOffset: 35, // Viewing archive offsets 0-25 + live rows (archiveOffset 30 visible at row 5)
        scrollbackLength: totalScrollback,
        isAlternateScreen: false,
      });

      // Feed the image data to broker
      sendKittyTransmit(broker, 'pty-1', 1, [255, 0, 0]);

      renderer.flush(renderTarget);

      // Should emit placement command for archived placement
      const joined = output.join('');
      expect(joined).toContain('\x1b_Ga=p'); // placement command
      expect(joined).toContain('i=1'); // image id

      archive.dispose();
    });

    it('caches archived placements for performance', async () => {
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 10,
        placements: [],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Add archived lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      const archivePlacement: ArchivePlacement = {
        ...createPlacement(1, 1),
        archiveOffset: 5,
        originalScreenY: 5,
      };
      await archive.appendPlacements([archivePlacement]);

      // First call should build cache
      const placements1 = archivedEmulator.getKittyPlacements();
      expect(placements1).toHaveLength(1);

      // Second call should use cache (same results)
      const placements2 = archivedEmulator.getKittyPlacements();
      expect(placements2).toEqual(placements1);

      archive.dispose();
    });
  });

  describe('litmus: Image spanning live/archive boundary', () => {
    it('shows image correctly when part is in archive and part is live', async () => {
      const livePlacement: KittyGraphicsPlacement = createPlacement(1, 1, {
        screenX: 0,
        screenY: -5, // Spans from archive into live area
        columns: 10,
        rows: 10, // 5 rows in archive, 5 in live
      });

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 5,
        placements: [livePlacement],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Add 20 archived lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Archive placement for the part in archive
      const archivePlacement: ArchivePlacement = {
        ...livePlacement,
        archiveOffset: 15, // Line 15 in archive
        originalScreenY: -5,
        rows: 5, // Only 5 rows visible in archive
      };
      await archive.appendPlacements([archivePlacement]);

      // Get merged placements
      const placements = archivedEmulator.getKittyPlacements();
      
      // Should have placements from both archive and live
      expect(placements.length).toBeGreaterThanOrEqual(1);

      // Check that archived placement has archiveOffset property (marks it as archived)
      const archived = placements.find(p => 'archiveOffset' in p);
      expect(archived).toBeDefined();
      // Archived placements have screenY = archiveOffset (absolute position)
      expect(archived!.screenY).toBe(15);

      archive.dispose();
    });

    it('deduplicates overlapping archive and live placements', async () => {
      // Same placement exists in both archive and live (edge case during transition)
      const sharedPlacement = createPlacement(1, 1, {
        screenX: 0,
        screenY: 0,
        columns: 5,
        rows: 3,
      });

      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 5,
        placements: [sharedPlacement],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Add archived lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Same placement also in archive (during transition period)
      const archivePlacement: ArchivePlacement = {
        ...sharedPlacement,
        archiveOffset: 5,
        originalScreenY: 0,
      };
      await archive.appendPlacements([archivePlacement]);

      // Get merged placements - should be deduplicated
      const placements = archivedEmulator.getKittyPlacements();
      
      // Should only have one placement (deduplicated by imageId:placementId)
      const matchingPlacements = placements.filter(
        p => p.imageId === 1 && p.placementId === 1
      );
      expect(matchingPlacements).toHaveLength(1);

      archive.dispose();
    });
  });

  describe('litmus: Multiple images in archive', () => {
    it('renders all archived images correctly', async () => {
      const broker = new KittyTransmitBroker();
      broker.setWriter(() => {});
      setKittyTransmitBroker(broker);

      const renderer = new KittyGraphicsRenderer();
      const output: string[] = [];
      const renderTarget = defaultRenderTarget(output, 100);

      // Live emulator needs to know about all image IDs
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 5,
        placements: [],
        imageInfo: createImageInfo(1, 1n),
        imageIds: [1, 2, 3],
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      
      // Add many archived lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Add multiple archive placements (positioned to be visible)
      // scrollbackLength = 105 (100 archive + 5 live), rows = 25
      // Formula: viewportRow = archiveOffset - scrollbackLength + viewportOffset
      // For archiveOffset 80 to be at viewportRow 0: 80 - 105 + viewportOffset = 0, so viewportOffset = 25
      // Using imageId 1 for all since mock only has image 1 data
      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5 }),
          archiveOffset: 80, // viewportRow = 80 - 105 + 25 = 0
          originalScreenY: 0,
        },
        {
          ...createPlacement(1, 2, { screenX: 20, screenY: 2, columns: 15, rows: 8 }),
          archiveOffset: 85, // viewportRow = 5
          originalScreenY: 2,
        },
        {
          ...createPlacement(1, 3, { screenX: 5, screenY: 5, columns: 8, rows: 4 }),
          archiveOffset: 90, // viewportRow = 10
          originalScreenY: 5,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Transmit all images
      sendKittyTransmit(broker, 'pty-1', 1, [255, 0, 0]);
      sendKittyTransmit(broker, 'pty-1', 2, [0, 255, 0]);
      sendKittyTransmit(broker, 'pty-1', 3, [0, 0, 255]);

      // View archive offsets 80-104 (end of archive into live area)
      renderer.updatePane('pane-1', {
        ptyId: 'pty-1',
        emulator: archivedEmulator,
        offsetX: 0,
        offsetY: 0,
        width: 800,
        height: 500,
        cols: 80,
        rows: 25,
        viewportOffset: 25, // Viewing archive offsets 80-104 (rows 0-24)
        scrollbackLength: archive.length + liveEmulator.getScrollbackLength(),
        isAlternateScreen: false,
      });

      renderer.flush(renderTarget);

      // Should emit placements for all images (all use i=1 but different placement IDs)
      const joined = output.join('');
      expect(joined).toContain('i=1');
      expect(joined).toContain('p=1');
      expect(joined).toContain('p=2');
      expect(joined).toContain('p=3');

      archive.dispose();
    });

    it('handles images with different z-order correctly', async () => {
      const archive = new ScrollbackArchive({ rootDir: testDir });
      
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Add placements with different z values
      const archivePlacements: ArchivePlacement[] = [
        {
          ...createPlacement(1, 1, { screenX: 0, screenY: 0, columns: 10, rows: 5, z: 0 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
        {
          ...createPlacement(2, 1, { screenX: 2, screenY: 2, columns: 10, rows: 5, z: 10 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
        {
          ...createPlacement(3, 1, { screenX: 4, screenY: 4, columns: 10, rows: 5, z: -5 }),
          archiveOffset: 10,
          originalScreenY: 0,
        },
      ];
      await archive.appendPlacements(archivePlacements);

      // Retrieve and verify
      const retrievedPlacements = archive.getPlacementsForLineRange(0, 50);
      expect(retrievedPlacements).toHaveLength(3);

      // Verify z values are preserved
      const zValues = retrievedPlacements.map(p => p.z).sort((a, b) => a - b);
      expect(zValues).toEqual([-5, 0, 10]);

      archive.dispose();
    });
  });

  describe('litmus: Placement cleanup after chunk drop', () => {
    it('removes placements when archive chunk is dropped', async () => {
      const archive = new ScrollbackArchive({ 
        rootDir: testDir,
        chunkMaxLines: 10, // Small chunks for testing
      });

      // Add lines that will span multiple chunks
      for (let chunk = 0; chunk < 5; chunk++) {
        const lines: TerminalCell[][] = [];
        for (let i = 0; i < 10; i++) {
          lines.push(createMockLine(80));
        }
        await archive.appendLines(lines);

        // Add placement for this chunk
        const placement: ArchivePlacement = {
          ...createPlacement(chunk + 1, 1, { screenX: 0, screenY: chunk * 10, columns: 5, rows: 2 }),
          archiveOffset: chunk * 10,
          originalScreenY: chunk * 10,
        };
        await archive.appendPlacements([placement]);
      }

      // Verify all placements exist
      const allPlacements = archive.getPlacementsForLineRange(0, 50);
      expect(allPlacements).toHaveLength(5);

      // Drop oldest chunk
      const dropped = archive.dropOldestChunk();
      expect(dropped).not.toBeNull();
      expect(dropped!.linesRemoved).toBe(10);

      // Verify placement from dropped chunk is gone and remaining offsets are rebased.
      const remainingPlacements = archive.getPlacementsForLineRange(0, archive.length);
      expect(remainingPlacements).toHaveLength(4);

      const remainingIds = remainingPlacements.map((p) => p.imageId).sort((a, b) => a - b);
      expect(remainingIds).toEqual([2, 3, 4, 5]);

      const offsetByImageId = new Map(remainingPlacements.map((p) => [p.imageId, p.archiveOffset]));
      expect(offsetByImageId.get(2)).toBe(0);
      expect(offsetByImageId.get(3)).toBe(10);
      expect(offsetByImageId.get(4)).toBe(20);
      expect(offsetByImageId.get(5)).toBe(30);

      archive.dispose();
    });

    it('cleans up placement files when chunk is dropped', async () => {
      const fs = require('node:fs');

      const archive = new ScrollbackArchive({ 
        rootDir: testDir,
        chunkMaxLines: 10,
      });

      // Add first chunk (10 lines) with placements
      const lines1: TerminalCell[][] = [];
      for (let i = 0; i < 10; i++) {
        lines1.push(createMockLine(80));
      }
      await archive.appendLines(lines1);

      // Placement in first chunk - written to chunk 1
      const placement1: ArchivePlacement = {
        ...createPlacement(1, 1),
        archiveOffset: 5,
        originalScreenY: 5,
      };
      await archive.appendPlacements([placement1]);

      // Add second chunk (10 lines) with placements
      const lines2: TerminalCell[][] = [];
      for (let i = 0; i < 10; i++) {
        lines2.push(createMockLine(80));
      }
      await archive.appendLines(lines2);

      // Placement in second chunk - written to chunk 2
      const placement2: ArchivePlacement = {
        ...createPlacement(2, 1),
        archiveOffset: 12,
        originalScreenY: 12,
      };
      await archive.appendPlacements([placement2]);

      // Get chunk info before drop - oldest chunk should have placements
      const oldestChunk = archive.getOldestChunk();
      expect(oldestChunk).not.toBeNull();
      expect(oldestChunk!.placementPath).toBeDefined();

      const placementFilePath = oldestChunk!.placementPath;
      
      // Verify placement file exists before drop
      if (placementFilePath) {
        expect(fs.existsSync(placementFilePath)).toBe(true);
      }

      // Drop the oldest chunk (cleanup is async)
      archive.dropOldestChunk();

      // Wait for async cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify placement file is deleted
      if (placementFilePath) {
        expect(fs.existsSync(placementFilePath)).toBe(false);
      }

      archive.dispose();
    });

    it('invalidates placement cache when archive content changes without length change', async () => {
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 5,
        placements: [],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ 
        rootDir: testDir,
        chunkMaxLines: 10,
      });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Build two chunks (length=20) and put a placement in chunk 2.
      const initialLines: TerminalCell[][] = [];
      for (let i = 0; i < 20; i++) {
        initialLines.push(createMockLine(80));
      }
      await archive.appendLines(initialLines);
      await archive.appendPlacements([{
        ...createPlacement(1, 1),
        archiveOffset: 12,
        originalScreenY: 12,
      }]);

      // First access builds cache.
      const placements1 = archivedEmulator.getKittyPlacements();
      expect(placements1.map((p) => p.imageId)).toEqual([1]);

      // Drop one chunk and append another so archive length stays at 20.
      const dropped = archive.dropOldestChunk();
      expect(dropped?.linesRemoved).toBe(10);

      const refillLines: TerminalCell[][] = [];
      for (let i = 0; i < 10; i++) {
        refillLines.push(createMockLine(80));
      }
      await archive.appendLines(refillLines);
      await archive.appendPlacements([{
        ...createPlacement(2, 1),
        archiveOffset: 10,
        originalScreenY: 10,
      }]);

      expect(archive.length).toBe(20);

      // Cache must refresh even though archive length is unchanged.
      const placements2 = archivedEmulator.getKittyPlacements();
      const imageIds = placements2.map((p) => p.imageId).sort((a, b) => a - b);
      expect(imageIds).toEqual([1, 2]);

      const image1 = placements2.find((p) => p.imageId === 1);
      const image2 = placements2.find((p) => p.imageId === 2);
      expect(image1?.screenY).toBe(2);
      expect(image2?.screenY).toBe(10);

      archive.dispose();
    });
  });

  describe('edge cases', () => {
    it('handles empty archive gracefully', () => {
      const liveEmulator = createMockEmulatorWithPlacements({
        scrollbackLength: 10,
        placements: [createPlacement(1, 1)],
        imageInfo: createImageInfo(1, 1n),
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Empty archive should return live placements only
      const placements = archivedEmulator.getKittyPlacements();
      expect(placements).toHaveLength(1);
      expect(placements[0].imageId).toBe(1);

      archive.dispose();
    });

    it('handles emulator without Kitty support', () => {
      const liveEmulator: ITerminalEmulator = {
        cols: 80,
        rows: 24,
        isDisposed: false,
        write: () => {},
        resize: () => {},
        reset: () => {},
        dispose: () => {},
        getScrollbackLength: () => 10,
        getScrollbackLine: (offset: number) => {
          if (offset < 0 || offset >= 10) return null;
          return createMockLine(80);
        },
        getDirtyUpdate: () => ({ rows: [], cursor: null }),
        getTerminalState: () => ({
          rows: [],
          cursor: { x: 0, y: 0, visible: true },
          modes: { mouseTracking: false, cursorKeyMode: 'normal', alternateScreen: false, inBandResize: false },
        }),
        getCursor: () => ({ x: 0, y: 0, visible: true }),
        getCursorKeyMode: () => 'normal',
        getKittyKeyboardFlags: () => 0,
        isMouseTrackingEnabled: () => false,
        isAlternateScreen: () => false,
        getMode: () => false,
        getColors: () => ({ background: '#000000', foreground: '#ffffff' }),
        getTitle: () => 'test',
        onTitleChange: () => () => {},
        onUpdate: () => () => {},
        onModeChange: () => () => {},
        search: async () => ({ matches: [], query: '' }),
      };

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Should not throw when Kitty methods are missing
      expect(() => archivedEmulator.getKittyPlacements()).not.toThrow();
      expect(archivedEmulator.getKittyPlacements()).toEqual([]);

      archive.dispose();
    });

    it('handles large archive offsets correctly', async () => {
      const archive = new ScrollbackArchive({ rootDir: testDir });
      
      // Add many lines
      const lines: TerminalCell[][] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(createMockLine(80));
      }
      await archive.appendLines(lines);

      // Placement at high offset
      const placement: ArchivePlacement = {
        ...createPlacement(1, 1, { screenX: 0, screenY: 500, columns: 10, rows: 5 }),
        archiveOffset: 500,
        originalScreenY: 500,
      };
      await archive.appendPlacements([placement]);

      // Retrieve and verify
      const retrieved = archive.getPlacementsForLineRange(495, 510);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].archiveOffset).toBe(500);

      archive.dispose();
    });
  });
});

// Helper function to create mock terminal lines
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
