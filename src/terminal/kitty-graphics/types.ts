import type {
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../emulator-interface';

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

export type ImageCache = {
  hostId: number;
  info: KittyGraphicsImageInfo;
};

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
