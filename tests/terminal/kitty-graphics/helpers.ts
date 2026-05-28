import { Buffer } from 'buffer';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
  type ITerminalEmulator,
} from '../../../src/terminal/emulator-interface';
import type { TerminalCell } from '../../../src/core/types';
import type { KittyTransmitBroker } from '../../../src/terminal/kitty-graphics';
import type { ArchivePlacement } from '../../../src/terminal/kitty-graphics/archive-placement';

export const defaultRenderTarget = (output: string[], size = 10) => ({
  resolution: { width: size, height: size },
  terminalWidth: size,
  terminalHeight: size,
  writeOut: (chunk: string) => output.push(chunk),
});

export const createImageInfo = (id: number, transmitTime: bigint): KittyGraphicsImageInfo => ({
  id,
  number: 0,
  width: 1,
  height: 1,
  dataLength: 3,
  format: KittyGraphicsFormat.RGB,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime,
});

export interface CreatePlacementOptions {
  screenX?: number;
  screenY?: number;
  xOffset?: number;
  yOffset?: number;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  columns?: number;
  rows?: number;
  z?: number;
  placementTag?: KittyGraphicsPlacementTag;
}

export const createPlacement = (
  imageId: number,
  placementId: number = 1,
  options: CreatePlacementOptions = {}
): KittyGraphicsPlacement => ({
  imageId,
  placementId,
  placementTag: options.placementTag ?? KittyGraphicsPlacementTag.INTERNAL,
  screenX: options.screenX ?? 0,
  screenY: options.screenY ?? 0,
  xOffset: options.xOffset ?? 0,
  yOffset: options.yOffset ?? 0,
  sourceX: options.sourceX ?? 0,
  sourceY: options.sourceY ?? 0,
  sourceWidth: options.sourceWidth ?? 0,
  sourceHeight: options.sourceHeight ?? 0,
  columns: options.columns ?? 1,
  rows: options.rows ?? 1,
  z: options.z ?? 0,
});

/**
 * Create an ArchivePlacement from a KittyGraphicsPlacement with archive metadata.
 *
 * @param placement - The base Kitty graphics placement
 * @param archiveOffset - The offset in the scrollback archive where this placement belongs
 * @param originalScreenY - The original Y coordinate on screen when archived
 * @returns ArchivePlacement with archive-specific metadata
 */
export const createArchivePlacement = (
  placement: KittyGraphicsPlacement,
  archiveOffset: number,
  originalScreenY: number
): ArchivePlacement => ({
  ...placement,
  archiveOffset,
  originalScreenY,
});

export interface MockEmulatorOptions {
  scrollbackLength?: number;
  placements?: KittyGraphicsPlacement[];
  imageInfo?: KittyGraphicsImageInfo | null;
  imageData?: Uint8Array | null;
  imageIds?: number[];
  dirty?: boolean;
  cols?: number;
  rows?: number;
  isAlternateScreen?: boolean;
}

/**
 * Create a mock terminal emulator with Kitty graphics support for testing.
 * Useful for testing scrollback archive functionality without a real Ghostty VT.
 *
 * @param options - Configuration for the mock emulator
 * @returns A mock ITerminalEmulator with Kitty graphics methods
 */
export const createMockEmulatorWithPlacements = (
  options: MockEmulatorOptions = {}
): ITerminalEmulator => {
  const {
    scrollbackLength = 0,
    placements = [],
    imageInfo = null,
    imageData = null,
    imageIds: explicitImageIds,
    dirty = false,
    cols = 80,
    rows = 24,
    isAlternateScreen = false,
  } = options;

  let imagesDirty = dirty;
  const imageIds: number[] =
    explicitImageIds ??
    (placements.length > 0
      ? [...new Set(placements.map((p) => p.imageId))]
      : imageInfo
        ? [imageInfo.id]
        : []);

  return {
    cols,
    rows,
    isDisposed: false,
    write: () => {},
    resize: () => {},
    reset: () => {},
    dispose: () => {},
    getScrollbackLength: () => scrollbackLength,
    getScrollbackLine: (offset: number) => {
      if (offset < 0 || offset >= scrollbackLength) return null;
      // Return a mock line with empty cells
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
    },
    getDirtyUpdate: () => ({ rows: [], cursor: null }),
    getTerminalState: () => ({
      rows: [],
      cursor: { x: 0, y: 0, visible: true },
      modes: {
        mouseTracking: false,
        cursorKeyMode: 'normal',
        alternateScreen: false,
        inBandResize: false,
      },
    }),
    getCursor: () => ({ x: 0, y: 0, visible: true }),
    getCursorKeyMode: () => 'normal' as const,
    getKittyKeyboardFlags: () => 0,
    isMouseTrackingEnabled: () => false,
    isAlternateScreen: () => isAlternateScreen,
    getMode: () => false,
    getColors: () => ({ background: '#000000', foreground: '#ffffff' }),
    getTitle: () => 'mock',
    onTitleChange: () => () => {},
    onUpdate: () => () => {},
    onModeChange: () => () => {},
    search: async () => ({ matches: [], query: '' }),

    // Kitty graphics support
    getKittyImagesDirty: () => imagesDirty,
    clearKittyImagesDirty: () => {
      imagesDirty = false;
    },
    getKittyImageIds: () => imageIds,
    getKittyImageInfo: () => imageInfo,
    getKittyImageData: () => imageData,
    getKittyPlacements: () => placements,
  };
};

export const sendKittyTransmit = (
  broker: KittyTransmitBroker,
  ptyId: string,
  imageId: number,
  data: number[]
) => {
  const ESC = '\x1b';
  const payload = Buffer.from(data).toString('base64');
  broker.handleSequence(ptyId, `${ESC}_Ga=t,f=24,i=${imageId};${payload}${ESC}\\`);
};
