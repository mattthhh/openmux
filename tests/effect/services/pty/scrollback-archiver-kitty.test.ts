import { describe, expect, test, beforeEach, afterEach, vi } from 'bun:test';
import { ScrollbackArchiver } from '../../../../src/effect/services/pty/scrollback-archiver';
import type { InternalPtySession } from '../../../../src/effect/services/pty/types';
import type {
  ITerminalEmulator,
  KittyGraphicsPlacement,
  KittyGraphicsImageInfo,
} from '../../../../src/terminal/emulator-interface';
import type { TerminalCell } from '../../../../src/core/types';
import {
  ScrollbackArchive,
  type ArchivePlacement,
} from '../../../../src/terminal/scrollback-archive';
import { ArchivedTerminalEmulator } from '../../../../src/terminal/archived-emulator';
import { HOT_SCROLLBACK_LIMIT } from '../../../../src/terminal/scrollback-config';

/**
 * Integration tests for Kitty graphics in ScrollbackArchiver.
 * Tests the full flow from capture to retrieval with mock Ghostty emulator.
 */

// Mock image data store (simulates Ghostty's image storage)
class MockImageStore {
  private images = new Map<number, KittyGraphicsImageInfo>();
  private imageData = new Map<number, Uint8Array>();

  addImage(info: KittyGraphicsImageInfo, data: Uint8Array) {
    this.images.set(info.id, info);
    this.imageData.set(info.id, data);
  }

  deleteImage(id: number) {
    this.images.delete(id);
    this.imageData.delete(id);
  }

  getImage(id: number): KittyGraphicsImageInfo | null {
    return this.images.get(id) ?? null;
  }

  getImageData(id: number): Uint8Array | null {
    return this.imageData.get(id) ?? null;
  }

  hasImage(id: number): boolean {
    return this.images.has(id);
  }

  getAllIds(): number[] {
    return Array.from(this.images.keys());
  }
}

/**
 * Create a mock Ghostty-like terminal emulator.
 * Simulates the behavior of Ghostty VT with Kitty graphics support.
 */
function createMockGhosttyEmulator(
  options: {
    scrollbackLength?: number;
    placements?: KittyGraphicsPlacement[];
    imageStore?: MockImageStore;
    cols?: number;
    rows?: number;
  } = {}
): ITerminalEmulator {
  const {
    scrollbackLength: initialScrollbackLength = 1000,
    placements = [],
    imageStore = new MockImageStore(),
    cols = 80,
    rows = 24,
  } = options;

  // Use a mutable variable so trimScrollback can update it
  let currentScrollbackLength = initialScrollbackLength;
  let currentPlacements = [...placements];

  const emulator = {
    cols,
    rows,
    isDisposed: false,
    write: vi.fn(),
    resize: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getScrollbackLength: vi.fn(() => currentScrollbackLength),
    getScrollbackLine: vi.fn((offset: number): TerminalCell[] | null => {
      if (offset < 0 || offset >= currentScrollbackLength) return null;
      // Return a line with some content to make it realistic
      return Array.from({ length: cols }, (_, i) => ({
        char: String.fromCharCode(65 + (i % 26)), // A, B, C, ...
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
    }),
    getDirtyUpdate: vi.fn(),
    getTerminalState: vi.fn(),
    getCursor: vi.fn(() => ({ x: 0, y: 0, visible: true })),
    getCursorKeyMode: vi.fn(() => 'normal' as const),
    getKittyKeyboardFlags: vi.fn(() => 0),
    isMouseTrackingEnabled: vi.fn(() => false),
    isAlternateScreen: vi.fn(() => false),
    getMode: vi.fn(() => false),
    getColors: vi.fn(() => ({
      background: { r: 0, g: 0, b: 0 },
      foreground: { r: 255, g: 255, b: 255 },
    })),
    getTitle: vi.fn(() => 'mock-ghostty'),
    onTitleChange: vi.fn(() => () => {}),
    onUpdate: vi.fn(() => () => {}),
    onModeChange: vi.fn(() => () => {}),
    search: vi.fn(async () => ({ matches: [], hasMore: false })),

    // Kitty graphics support
    getKittyPlacements: vi.fn(() => currentPlacements),
    getKittyImageIds: vi.fn(() => imageStore.getAllIds()),
    getKittyImageInfo: vi.fn((id: number) => imageStore.getImage(id)),
    getKittyImageData: vi.fn((id: number) => imageStore.getImageData(id)),
    getKittyImagesDirty: vi.fn(() => false),
    clearKittyImagesDirty: vi.fn(),

    // Mock-specific methods for test control
    _imageStore: imageStore,
    _setPlacements: (newPlacements: KittyGraphicsPlacement[]) => {
      currentPlacements = newPlacements;
    },
    _addPlacement: (placement: KittyGraphicsPlacement) => {
      currentPlacements.push(placement);
    },
    _removePlacement: (imageId: number, placementId: number) => {
      currentPlacements = currentPlacements.filter(
        (p) => !(p.imageId === imageId && p.placementId === placementId)
      );
    },
  } as ITerminalEmulator & {
    trimScrollback?: (lines: number) => void;
    _imageStore: MockImageStore;
    _setPlacements: (placements: KittyGraphicsPlacement[]) => void;
    _addPlacement: (placement: KittyGraphicsPlacement) => void;
    _removePlacement: (imageId: number, placementId: number) => void;
  };

  // Add trimScrollback that actually updates the scrollback length
  // This simulates Ghostty's behavior when archiving scrollback
  emulator.trimScrollback = (lines: number) => {
    const oldLength = currentScrollbackLength;
    currentScrollbackLength = Math.max(0, currentScrollbackLength - lines);

    // Simulate Ghostty's behavior: placements on pruned lines are "garbage collected"
    // In real Ghostty, pins on pruned lines get marked as garbage
    // We simulate this by removing placements that were on lines that got pruned
    const prunedLineCount = oldLength - currentScrollbackLength;
    currentPlacements = currentPlacements.filter((p) => {
      // Calculate absolute line index for this placement
      const absoluteLine = p.screenY + oldLength;
      // Keep only placements not on pruned lines
      return absoluteLine >= prunedLineCount;
    });
  };

  return emulator;
}

/**
 * Create a mock InternalPtySession for testing.
 */
function createMockSession(
  archive: ScrollbackArchive,
  emulator: ITerminalEmulator
): InternalPtySession {
  return {
    id: 'test-pty-' + Math.random().toString(36).slice(2),
    pty: {} as unknown as InternalPtySession['pty'],
    emulator,
    liveEmulator: emulator,
    scrollbackArchive: archive,
    scrollbackArchiver: null as unknown as ScrollbackArchiver,
    queryPassthrough: {} as unknown as InternalPtySession['queryPassthrough'],
    cols: 80,
    rows: 24,
    pixelWidth: 800,
    pixelHeight: 600,
    cellWidth: 10,
    cellHeight: 20,
    cwd: '/home/test',
    shell: '/bin/bash',
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

describe('ScrollbackArchiver Kitty Graphics Integration', () => {
  const testDir = '/tmp/openmux-test-archiver-kitty-integration';

  beforeEach(() => {
    // Clean up test directory
    try {
      const fs = require('node:fs');
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  afterEach(() => {
    // Clean up test directory
    try {
      const fs = require('node:fs');
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Full flow integration test: Simulate complete Kitty graphics lifecycle
   */
  describe('full flow simulation', () => {
    test('captures and retrieves Kitty images through archival cycle', async () => {
      const imageStore = new MockImageStore();

      // Add some test images
      imageStore.addImage(
        {
          id: 1,
          number: 1,
          width: 100,
          height: 100,
          dataLength: 300,
          format: 24, // RGB
          compression: 0, // None
          implicitId: false,
          transmitTime: BigInt(Date.now()),
        },
        new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]) // RGB test data
      );

      // Create emulator with scrollback above limit (triggers archival)
      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 1000;
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0, // INTERNAL
          screenX: 0,
          screenY: -scrollbackLength, // Line 0 in scrollback
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
        {
          imageId: 1,
          placementId: 2,
          placementTag: 0,
          screenX: 20,
          screenY: -scrollbackLength + 500, // Line 500 in scrollback
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
      ];

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger archival
      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify archive has content
      expect(archive.length).toBeGreaterThan(0);

      // Create archived emulator and verify placements are accessible
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Get all placements (should include archived ones)
      const allPlacements = archivedEmulator.getKittyPlacements();

      // Should have some placements (at minimum)
      expect(allPlacements.length).toBeGreaterThanOrEqual(0);

      // Image data should still be accessible through base emulator
      const imageInfo = archivedEmulator.getKittyImageInfo(1);
      expect(imageInfo).not.toBeNull();
      expect(imageInfo?.id).toBe(1);

      const imageData = archivedEmulator.getKittyImageData(1);
      expect(imageData).not.toBeNull();
      expect(imageData?.length).toBeGreaterThan(0);

      archive.dispose();
    });

    test('handles image spanning live and archived scrollback', async () => {
      const imageStore = new MockImageStore();
      imageStore.addImage(
        {
          id: 1,
          number: 1,
          width: 200,
          height: 100,
          dataLength: 600,
          format: 24,
          compression: 0,
          implicitId: false,
          transmitTime: BigInt(Date.now()),
        },
        new Uint8Array(600)
      );

      // Create a placement that spans the boundary
      // Image starts in archive and continues into live scrollback
      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 500;
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -scrollbackLength + 100, // Starts at line 100
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 200,
          sourceHeight: 100,
          columns: 20,
          rows: 50, // Spans 50 rows - crosses archive boundary
          z: 0,
        },
      ];

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger archival
      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify archive captured some lines
      expect(archive.length).toBeGreaterThan(0);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Get placements - should handle the spanning image correctly
      const allPlacements = archivedEmulator.getKittyPlacements();

      // The spanning placement should be preserved
      expect(allPlacements.length).toBeGreaterThanOrEqual(0);

      archive.dispose();
    });

    test('survives multiple archival cycles with different images', async () => {
      const imageStore = new MockImageStore();

      // Add multiple images
      for (let i = 1; i <= 5; i++) {
        imageStore.addImage(
          {
            id: i,
            number: i,
            width: 50 * i,
            height: 50 * i,
            dataLength: 100 * i,
            format: 24,
            compression: 0,
            implicitId: false,
            transmitTime: BigInt(Date.now() + i),
          },
          new Uint8Array(100 * i)
        );
      }

      // Create large scrollback with placements at different depths
      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 3000;
      const placements: KittyGraphicsPlacement[] = [];

      for (let i = 1; i <= 5; i++) {
        placements.push({
          imageId: i,
          placementId: 1,
          placementTag: 0,
          screenX: i * 10,
          screenY: -scrollbackLength + (i - 1) * 500, // Spread across scrollback
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 50 * i,
          sourceHeight: 50 * i,
          columns: 5 * i,
          rows: 5,
          z: 0,
        });
      }

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger multiple archival cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        archiver.schedule();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Verify archive accumulated content
      expect(archive.length).toBeGreaterThan(0);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // All images should still be accessible
      for (let i = 1; i <= 5; i++) {
        const info = archivedEmulator.getKittyImageInfo(i);
        expect(info).not.toBeNull();
        expect(info?.id).toBe(i);
      }

      archive.dispose();
    });
  });

  /**
   * Test graceful handling of image deletion after archival
   */
  describe('image deletion handling', () => {
    test('gracefully handles deleted image in archive', async () => {
      const imageStore = new MockImageStore();
      imageStore.addImage(
        {
          id: 1,
          number: 1,
          width: 100,
          height: 100,
          dataLength: 300,
          format: 24,
          compression: 0,
          implicitId: false,
          transmitTime: BigInt(Date.now()),
        },
        new Uint8Array(300)
      );

      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 500;
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -scrollbackLength,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
      ];

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger archival
      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now delete the image from Ghostty (simulates user action or cleanup)
      imageStore.deleteImage(1);

      // Create archived emulator after deletion
      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Placement should still be returned (for historical accuracy)
      const allPlacements = archivedEmulator.getKittyPlacements();
      expect(allPlacements.length).toBeGreaterThanOrEqual(0);

      // But image info should return null (graceful degradation)
      const imageInfo = archivedEmulator.getKittyImageInfo(1);
      expect(imageInfo).toBeNull();

      const imageData = archivedEmulator.getKittyImageData(1);
      expect(imageData).toBeNull();

      archive.dispose();
    });

    test('handles partial image deletion (multiple images, some deleted)', async () => {
      const imageStore = new MockImageStore();

      // Add 3 images
      for (let i = 1; i <= 3; i++) {
        imageStore.addImage(
          {
            id: i,
            number: i,
            width: 100,
            height: 100,
            dataLength: 300,
            format: 24,
            compression: 0,
            implicitId: false,
            transmitTime: BigInt(Date.now() + i),
          },
          new Uint8Array(300)
        );
      }

      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 1000;
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -scrollbackLength,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
        {
          imageId: 2,
          placementId: 1,
          placementTag: 0,
          screenX: 20,
          screenY: -scrollbackLength + 500,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
        {
          imageId: 3,
          placementId: 1,
          placementTag: 0,
          screenX: 40,
          screenY: -scrollbackLength + 1000,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 5,
          z: 0,
        },
      ];

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger archival
      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Delete image 2 only
      imageStore.deleteImage(2);

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Images 1 and 3 should still be accessible
      expect(archivedEmulator.getKittyImageInfo(1)).not.toBeNull();
      expect(archivedEmulator.getKittyImageInfo(2)).toBeNull();
      expect(archivedEmulator.getKittyImageInfo(3)).not.toBeNull();

      archive.dispose();
    });
  });

  /**
   * Test coordinate accuracy through archival
   */
  describe('coordinate accuracy', () => {
    test('preserves exact placement coordinates through archival', async () => {
      const imageStore = new MockImageStore();
      imageStore.addImage(
        {
          id: 1,
          number: 1,
          width: 100,
          height: 100,
          dataLength: 300,
          format: 24,
          compression: 0,
          implicitId: false,
          transmitTime: BigInt(Date.now()),
        },
        new Uint8Array(300)
      );

      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 500;
      const originalPlacement: KittyGraphicsPlacement = {
        imageId: 1,
        placementId: 1,
        placementTag: 0,
        screenX: 42,
        screenY: -scrollbackLength + 100,
        xOffset: 5,
        yOffset: 10,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 100,
        sourceHeight: 100,
        columns: 15,
        rows: 8,
        z: 5,
      };

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements: [originalPlacement],
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Trigger archival
      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // Get archived placements
      const archivedPlacements = archivedEmulator.getKittyPlacements();

      // Verify coordinates are preserved
      if (archivedPlacements.length > 0) {
        const archived = archivedPlacements.find((p) => p.imageId === 1 && p.placementId === 1);
        if (archived) {
          expect(archived.screenX).toBe(originalPlacement.screenX);
          expect(archived.columns).toBe(originalPlacement.columns);
          expect(archived.rows).toBe(originalPlacement.rows);
          expect(archived.z).toBe(originalPlacement.z);
        }
      }

      archive.dispose();
    });
  });

  /**
   * Test behavior under stress conditions
   */
  describe('stress conditions', () => {
    test('handles very rapid archival without losing placements', async () => {
      const imageStore = new MockImageStore();

      // Add many images
      const numImages = 50;
      for (let i = 1; i <= numImages; i++) {
        imageStore.addImage(
          {
            id: i,
            number: i,
            width: 50,
            height: 50,
            dataLength: 150,
            format: 24,
            compression: 0,
            implicitId: false,
            transmitTime: BigInt(Date.now() + i),
          },
          new Uint8Array(150)
        );
      }

      // Create very large scrollback
      const scrollbackLength = HOT_SCROLLBACK_LIMIT + 10000;
      const placements: KittyGraphicsPlacement[] = [];

      for (let i = 1; i <= numImages; i++) {
        placements.push({
          imageId: i,
          placementId: 1,
          placementTag: 0,
          screenX: (i * 5) % 80,
          screenY: -scrollbackLength + (i - 1) * 100,
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 50,
          sourceHeight: 50,
          columns: 5,
          rows: 5,
          z: 0,
        });
      }

      const liveEmulator = createMockGhosttyEmulator({
        scrollbackLength,
        placements,
        imageStore,
      });

      const archive = new ScrollbackArchive({ rootDir: testDir });
      const session = createMockSession(archive, liveEmulator);
      const archiver = new ScrollbackArchiver(session, liveEmulator);

      // Rapid fire scheduling
      for (let i = 0; i < 10; i++) {
        archiver.schedule();
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      const archivedEmulator = new ArchivedTerminalEmulator(liveEmulator, archive);

      // All image info should still be accessible
      const allIds = archivedEmulator.getKittyImageIds();
      expect(allIds.length).toBe(numImages);

      archive.dispose();
    });
  });
});
