import { Buffer } from 'buffer';
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
import * as capabilitiesActual from '../../../src/terminal/capabilities';
import { createImageInfo, createPlacement, defaultRenderTarget, sendKittyTransmit } from './helpers';

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

describe('KittyGraphicsRenderer (basic)', () => {
  afterEach(() => {
    setKittyTransmitBroker(null);
  });

  it('litmus: renders kitty placements when broker provides ids', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    const imageInfo = createImageInfo(1, 1n);
    const placement = createPlacement(1);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => [placement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    sendKittyTransmit(broker, 'pty-1', 1, [255, 0, 0]);

    renderer.updatePane('pane-1', {
      ptyId: 'pty-1',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('\x1b_Ga=p');
    expect(dirty).toBe(false);
  });

  it('seeds host image data even when broker mapping already exists', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    const imageInfo = createImageInfo(9, 9n);
    const placement = createPlacement(9);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [9],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([10, 20, 30]),
      getKittyPlacements: () => [placement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    const ESC = '\x1b';
    const shmPayload = Buffer.from('SHMKEY').toString('base64');
    broker.handleSequence('pty-9', `${ESC}_Ga=T,q=2,t=s,s=1,v=1,S=3,i=9;${shmPayload}${ESC}\\`);

    renderer.updatePane('pane-9', {
      ptyId: 'pty-9',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('a=t');
    expect(joined).toContain('t=d');
    expect(joined).toContain('\x1b_Ga=p');
  });

  it('ignores disposed emulators', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    const emulator = {
      isDisposed: true,
      getKittyImagesDirty: () => {
        throw new Error('should not query disposed emulator');
      },
      getKittyImageIds: () => {
        throw new Error('should not query disposed emulator');
      },
      getKittyPlacements: () => {
        throw new Error('should not query disposed emulator');
      },
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    renderer.updatePane('pane-disposed', {
      ptyId: 'pty-disposed',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    expect(output.join('')).toBe('');
  });

  it('clears placements when panes are removed', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    const imageInfo = createImageInfo(2, 2n);
    const placement = createPlacement(2);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [2],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 255, 0]),
      getKittyPlacements: () => [placement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    renderer.updatePane('pane-2', {
      ptyId: 'pty-2',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    output.length = 0;

    renderer.removePane('pane-2');
    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('a=d');
    expect(joined).toContain('d=i');
    expect(joined).not.toContain('d=I');
  });

  it('clears placements when emulator stops reporting them', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    let includePlacements = true;
    const imageInfo = createImageInfo(3, 3n);
    const placement = createPlacement(3);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [3],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 255, 0]),
      getKittyPlacements: () => (includePlacements ? [placement] : []),
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    renderer.updatePane('pane-3', {
      ptyId: 'pty-3',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    output.length = 0;

    dirty = true;
    includePlacements = false;
    renderer.updatePane('pane-3', {
      ptyId: 'pty-3',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });
    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('a=d');
    expect(joined).toContain('d=i');
    expect(joined).not.toContain('d=I');
  });

  it('clears host images when a PTY is destroyed', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    const imageInfo = createImageInfo(7, 7n);
    const placement = createPlacement(7);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [7],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 128, 255]),
      getKittyPlacements: () => [placement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    sendKittyTransmit(broker, 'pty-7', 7, [0, 128, 255]);

    renderer.updatePane('pane-7', {
      ptyId: 'pty-7',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    output.length = 0;

    renderer.removePane('pane-7');
    renderer.markPtyDestroyed('pty-7');
    renderer.flush(renderTarget);

    expect(output.join('')).toContain('d=i');
  });
});
