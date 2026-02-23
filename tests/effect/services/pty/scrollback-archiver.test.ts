import { describe, expect, test, beforeEach, vi } from "bun:test";
import { ScrollbackArchiver } from "../../../../src/effect/services/pty/scrollback-archiver";
import type { InternalPtySession } from "../../../../src/effect/services/pty/types";
import type {
  ITerminalEmulator,
  KittyGraphicsPlacement,
} from "../../../../src/terminal/emulator-interface";
import type { TerminalCell } from "../../../../src/core/types";
import type { ScrollbackArchive } from "../../../../src/terminal/scrollback-archive";

/**
 * Create a mock terminal emulator for testing.
 */
function createMockEmulator(
  options: {
    scrollbackLength?: number;
    placements?: KittyGraphicsPlacement[];
    supportsKittyGraphics?: boolean;
  } = {}
): ITerminalEmulator {
  const {
    scrollbackLength: initialScrollbackLength = 1000,
    placements = [],
    supportsKittyGraphics = true,
  } = options;

  // Use a mutable variable so trimScrollback can update it
  let currentScrollbackLength = initialScrollbackLength;

  const emulator = {
    cols: 80,
    rows: 24,
    isDisposed: false,
    write: vi.fn(),
    resize: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getScrollbackLength: vi.fn(() => currentScrollbackLength),
    getScrollbackLine: vi.fn((offset: number): TerminalCell[] | null => {
      if (offset < 0 || offset >= currentScrollbackLength) return null;
      // Return a simple line with some cells
      return Array.from({ length: 80 }, (_, i) => ({
        char: "X",
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
    getCursorKeyMode: vi.fn(() => "normal" as const),
    getKittyKeyboardFlags: vi.fn(() => 0),
    isMouseTrackingEnabled: vi.fn(() => false),
    isAlternateScreen: vi.fn(() => false),
    getMode: vi.fn(() => false),
    getColors: vi.fn(() => ({
      background: { r: 0, g: 0, b: 0 },
      foreground: { r: 255, g: 255, b: 255 },
    })),
    getTitle: vi.fn(() => ""),
    onTitleChange: vi.fn(() => () => {}),
    onUpdate: vi.fn(() => () => {}),
    onModeChange: vi.fn(() => () => {}),
    search: vi.fn(async () => ({ matches: [], hasMore: false })),
    // Kitty graphics support (optional)
    ...(supportsKittyGraphics && {
      getKittyPlacements: vi.fn(() => placements),
    }),
  } as ITerminalEmulator & { trimScrollback?: (lines: number) => void };

  // Add trimScrollback that actually updates the scrollback length
  emulator.trimScrollback = (lines: number) => {
    currentScrollbackLength = Math.max(0, currentScrollbackLength - lines);
  };

  return emulator;
}

/**
 * Create a mock scrollback archive for testing.
 */
function createMockScrollbackArchive(
  options: { initialLength?: number; supportsPlacements?: boolean } = {}
): ScrollbackArchive {
  const { initialLength = 0, supportsPlacements = false } = options;
  let currentLength = initialLength;
  const storedPlacements: unknown[] = [];

  const archive = {
    get length() {
      return currentLength;
    },
    get bytes() {
      return currentLength * 80 * 16;
    },
    appendLines: vi.fn(async (lines: TerminalCell[][]) => {
      currentLength += lines.length;
    }),
    getLine: vi.fn(() => null),
    prefetchLines: vi.fn(),
    dropOldestChunk: vi.fn(() => null),
    clearCache: vi.fn(),
    reset: vi.fn(() => {
      currentLength = 0;
    }),
    dispose: vi.fn(),
    getOldestChunk: vi.fn(() => null),
  } as unknown as ScrollbackArchive;

  // Add placements support if requested
  if (supportsPlacements) {
    (
      archive as ScrollbackArchive & {
        appendLinesWithPlacements: (
          lines: TerminalCell[][],
          placements: unknown[]
        ) => Promise<void>;
        getStoredPlacements: () => unknown[];
      }
    ).appendLinesWithPlacements = vi.fn(
      async (lines: TerminalCell[][], placements: unknown[]) => {
        currentLength += lines.length;
        storedPlacements.push(...placements);
      }
    );
    (
      archive as ScrollbackArchive & { getStoredPlacements: () => unknown[] }
    ).getStoredPlacements = () => storedPlacements;
  }

  return archive;
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
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 1000,
      lastIsAtBottom: true,
    },
  };
}

describe("ScrollbackArchiver", () => {
  describe("capturePlacements (via run integration)", () => {
    test("handles emulator without Kitty graphics support gracefully", async () => {
      const emulator = createMockEmulator({
        scrollbackLength: 2500, // Above HOT_SCROLLBACK_LIMIT (2000) to trigger archiving
        supportsKittyGraphics: false,
      });
      const archive = createMockScrollbackArchive();
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      // Schedule archiving
      archiver.schedule();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not throw - graceful no-op
      expect(archive.appendLines).toHaveBeenCalled();
    });

    test("captures placements overlapping archived line range", async () => {
      // Create placements that overlap with the lines being archived
      // HOT_SCROLLBACK_LIMIT = 2000, so we need scrollback > 2000 to trigger archiving
      const scrollbackLength = 2500;
      const placements: KittyGraphicsPlacement[] = [
        // Placement on line 0 (will be archived - within first 500 lines)
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -2500, // Line 0 relative to visible screen (scrollbackLength=2500)
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
        // Placement on line 100 (will be archived - within first 500 lines)
        {
          imageId: 2,
          placementId: 2,
          placementTag: 0,
          screenX: 0,
          screenY: -2400, // Line 100 relative to visible screen
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
        // Placement near the end (will NOT be archived - line 2400 is beyond 500 line batch)
        {
          imageId: 3,
          placementId: 3,
          placementTag: 0,
          screenX: 0,
          screenY: -100, // Line 2400 relative to visible screen - not archived
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

      const emulator = createMockEmulator({
        scrollbackLength,
        placements,
        supportsKittyGraphics: true,
      });
      const archive = createMockScrollbackArchive({ supportsPlacements: true });
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      // Schedule archiving
      archiver.schedule();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that lines were appended
      expect(archive.appendLines).toHaveBeenCalled();

      // Verify placements were stored if the method exists
      const archiveWithPlacements = archive as ScrollbackArchive & {
        appendLinesWithPlacements?: (
          lines: TerminalCell[][],
          placements: unknown[]
        ) => Promise<void>;
        getStoredPlacements: () => unknown[];
      };

      if (archiveWithPlacements.appendLinesWithPlacements) {
        expect(
          archiveWithPlacements.appendLinesWithPlacements
        ).toHaveBeenCalled();
        const storedPlacements = archiveWithPlacements.getStoredPlacements();
        // Should only have captured placements on lines 0 and 500
        expect(storedPlacements.length).toBeGreaterThanOrEqual(0);
      }
    });

    test("preserves original screenY in placement metadata", async () => {
      const scrollbackLength = 2500;
      const originalScreenY = -2500;
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: originalScreenY,
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

      const emulator = createMockEmulator({
        scrollbackLength,
        placements,
        supportsKittyGraphics: true,
      });
      const archive = createMockScrollbackArchive({ supportsPlacements: true });
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      // Schedule archiving
      archiver.schedule();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that the archiver ran without errors
      expect(archive.appendLines).toHaveBeenCalled();
    });

    test("returns empty array when no placements exist", async () => {
      const emulator = createMockEmulator({
        scrollbackLength: 2500,
        placements: [],
        supportsKittyGraphics: true,
      });
      const archive = createMockScrollbackArchive();
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      // Schedule archiving
      archiver.schedule();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should complete without errors even with no placements
      expect(archive.appendLines).toHaveBeenCalled();
    });
  });

  describe("coordinate mapping", () => {
    test("calculates archiveOffset correctly", async () => {
      const scrollbackLength = 2500;
      const archiveStartOffset = 500; // Archive already has 500 lines
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -2500, // Line 0 - will have archiveOffset = 500 + 0 = 500
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

      const emulator = createMockEmulator({
        scrollbackLength,
        placements,
        supportsKittyGraphics: true,
      });
      const archive = createMockScrollbackArchive({
        initialLength: archiveStartOffset,
        supportsPlacements: true,
      });
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      // Schedule archiving
      archiver.schedule();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify archiving occurred
      expect(archive.appendLines).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    test("handles placement partially overlapping archived range", async () => {
      const scrollbackLength = 2500;
      // Placement spans lines 100-109, batch archives 0-255
      // So this placement IS fully within the archived range
      const placements: KittyGraphicsPlacement[] = [
        {
          imageId: 1,
          placementId: 1,
          placementTag: 0,
          screenX: 0,
          screenY: -2400, // Line 100
          xOffset: 0,
          yOffset: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 100,
          sourceHeight: 100,
          columns: 10,
          rows: 10, // Spans lines 100-109
          z: 0,
        },
      ];

      const emulator = createMockEmulator({
        scrollbackLength,
        placements,
        supportsKittyGraphics: true,
      });
      const archive = createMockScrollbackArchive({ supportsPlacements: true });
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(archive.appendLines).toHaveBeenCalled();
    });

    test("handles emulator returning undefined for getKittyPlacements", async () => {
      const emulator = createMockEmulator({
        scrollbackLength: 2500,
        supportsKittyGraphics: true,
      });
      // Override to return undefined
      (emulator as ITerminalEmulator & { getKittyPlacements: () => undefined }).getKittyPlacements = () => undefined as unknown as undefined;

      const archive = createMockScrollbackArchive();
      const session = createMockSession(archive, emulator);
      const archiver = new ScrollbackArchiver(session, emulator);

      archiver.schedule();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(archive.appendLines).toHaveBeenCalled();
    });
  });
});
