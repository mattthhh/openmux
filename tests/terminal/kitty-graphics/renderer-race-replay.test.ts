import { afterEach, beforeAll, describe, expect, it, vi } from 'bun:test';
import * as capabilitiesActual from '../../../src/terminal/capabilities';
import {
  createImageInfo,
  createMockEmulatorWithPlacements,
  createPlacement,
  defaultRenderTarget,
  sendKittyTransmit,
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

afterEach(() => {
  setKittyTransmitBroker(null);
});

describe('KittyGraphicsRenderer full-state recovery', () => {
  it('replays placements again after PTY invalidation even when geometry is unchanged', () => {
    const output: string[] = [];
    const broker = new KittyTransmitBroker();
    broker.setWriter((chunk) => output.push(chunk));
    setKittyTransmitBroker(broker);

    const renderer = new KittyGraphicsRenderer();
    const emulator = createMockEmulatorWithPlacements({
      scrollbackLength: 900,
      placements: [createPlacement(1, 1, { screenX: 0, screenY: 905, columns: 0, rows: 0 })],
      imageInfo: createImageInfo(1, 1n),
      imageData: new Uint8Array([255, 0, 0]),
      dirty: true,
      cols: 80,
      rows: 24,
    });

    renderer.updatePane('pane-1', {
      ptyId: 'pty-1',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 80,
      height: 24,
      cols: 80,
      rows: 24,
      viewportOffset: 0,
      scrollbackLength: 900,
      isAlternateScreen: false,
    });

    sendKittyTransmit(broker, 'pty-1', 1, [255, 0, 0]);
    renderer.flush(defaultRenderTarget(output, 100));
    const first = output.join('');
    expect(first).toContain('\x1b_Ga=p');

    output.length = 0;
    renderer.flush(defaultRenderTarget(output, 100));
    expect(output.join('')).toBe('');

    renderer.invalidatePty('pty-1');
    renderer.flush(defaultRenderTarget(output, 100));
    const replayed = output.join('');
    expect(replayed).toContain('\x1b_Ga=p');
  });
});
