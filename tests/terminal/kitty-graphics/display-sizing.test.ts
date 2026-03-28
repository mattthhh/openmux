import { describe, expect, it } from 'bun:test';
import { computePlacementRender } from '../../../src/terminal/kitty-graphics/geometry';
import { buildDisplay } from '../../../src/terminal/kitty-graphics/commands';
import type { PaneState } from '../../../src/terminal/kitty-graphics/types';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
} from '../../../src/terminal/emulator-interface';

const pane: PaneState = {
  ptyId: 'pty-1',
  emulator: null,
  offsetX: 0,
  offsetY: 0,
  width: 80,
  height: 24,
  cols: 80,
  rows: 24,
  viewportOffset: 0,
  scrollbackLength: 0,
  isAlternateScreen: false,
  layer: 'base',
  hidden: false,
  needsClear: false,
  removed: false,
};

const metrics = { cellWidth: 8, cellHeight: 16 };

const image: KittyGraphicsImageInfo = {
  id: 1,
  number: 0,
  width: 640,
  height: 418,
  dataLength: 0,
  format: KittyGraphicsFormat.PNG,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime: 1n,
};

function makePlacement(overrides: Partial<KittyGraphicsPlacement> = {}): KittyGraphicsPlacement {
  return {
    imageId: 1,
    placementId: 1,
    placementTag: KittyGraphicsPlacementTag.INTERNAL,
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
    ...overrides,
  };
}

describe('kitty display sizing replay', () => {
  it('omits c/r for native-size placements', () => {
    const largePane = { ...pane, height: 40, rows: 40 };
    const render = computePlacementRender(largePane, makePlacement(), image, metrics);
    expect(render).not.toBeNull();
    expect(render!.includeColumns).toBe(false);
    expect(render!.includeRows).toBe(false);

    const sequence = buildDisplay({ ...render!, hostImageId: 7, hostPlacementId: 9 });
    expect(sequence).not.toContain(',c=');
    expect(sequence).not.toContain(',r=');
    expect(sequence).toContain(',w=640');
    expect(sequence).toContain(',h=418');
  });

  it('preserves single-dimension sizing when only columns are explicit', () => {
    const render = computePlacementRender(
      pane,
      makePlacement({ columns: 20, rows: 0, sourceWidth: 400, sourceHeight: 200 }),
      { ...image, width: 400, height: 200 },
      metrics
    );
    expect(render).not.toBeNull();
    expect(render!.includeColumns).toBe(true);
    expect(render!.includeRows).toBe(false);

    const sequence = buildDisplay({ ...render!, hostImageId: 7, hostPlacementId: 9 });
    expect(sequence).toContain(',c=20');
    expect(sequence).not.toContain(',r=');
  });

  it('keeps both c/r when the original placement explicitly set both', () => {
    const render = computePlacementRender(
      pane,
      makePlacement({ columns: 20, rows: 6, sourceWidth: 400, sourceHeight: 200 }),
      { ...image, width: 400, height: 200 },
      metrics
    );
    expect(render).not.toBeNull();
    expect(render!.includeColumns).toBe(true);
    expect(render!.includeRows).toBe(true);

    const sequence = buildDisplay({ ...render!, hostImageId: 7, hostPlacementId: 9 });
    expect(sequence).toContain(',c=20');
    expect(sequence).toContain(',r=6');
  });
});
