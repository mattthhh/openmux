import type {
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../emulator-interface';

/**
 * Renderer-like interface for output operations.
 *
 * Supports both OpenTUI renderer objects and raw stdout streams.
 * Used to abstract where Kitty graphics commands are written to.
 */
export type RendererLike = {
  resolution?: { width: number; height: number } | null;
  terminalWidth?: number;
  terminalHeight?: number;
  width?: number;
  height?: number;
  writeOut?: (chunk: string) => void;
  stdout?: NodeJS.WriteStream;
  realStdoutWrite?: (chunk: any, encoding?: any, callback?: any) => boolean;
};

export type KittyPaneLayer = 'base' | 'overlay';

export type ClipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CellMetrics = {
  cellWidth: number;
  cellHeight: number;
};

export type PaneState = {
  ptyId: string | null;
  emulator: ITerminalEmulator | null;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  viewportOffset: number;
  scrollbackLength: number;
  isAlternateScreen: boolean;
  layer: KittyPaneLayer;
  hidden: boolean;
  needsClear: boolean;
  removed: boolean;
};

export type PtyKittyState = {
  images: Map<number, ImageCache>;
  placements: KittyGraphicsPlacement[];
  initialized: boolean;
};

/**
 * Cache entry for a transmitted image.
 *
 * Maps host image IDs to their metadata for tracking
 * which images are available for placement.
 */
export type ImageCache = {
  hostId: number;
  info: KittyGraphicsImageInfo;
};

/**
 * Parameters for rendering a single image placement.
 *
 * Contains both the image reference (hostImageId) and
 * positioning/sizing information for where to display it.
 *
 * Coordinates are in cells (rows/cols) with pixel offsets.
 * Source coordinates allow cropping the source image.
 */
export type PlacementRender = {
  key: string;
  imageId: number;
  hostImageId: number;
  hostPlacementId: number;
  globalRow: number;
  globalCol: number;
  columns: number;
  rows: number;
  includeColumns: boolean;
  includeRows: boolean;
  xOffset: number;
  yOffset: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  z: number;
};
