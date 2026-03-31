/**
 * Tests for GhosttyVTEmulator update gating.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'bun:test';
import { DirtyState } from '../../src/terminal/ghostty-vt/types';
import { getDefaultColors } from '../../src/terminal/terminal-colors';

class MockTerminal {
  static instances: MockTerminal[] = [];
  updateCalls = 0;
  writeCalls: Array<string | Uint8Array> = [];
  cols: number;
  rows: number;
  freed = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    MockTerminal.instances.push(this);
  }

  private assertAlive(): void {
    if (this.freed) {
      throw new Error('terminal used after free');
    }
  }

  write(data: string | Uint8Array): void {
    this.assertAlive();
    this.writeCalls.push(data);
  }

  update(): DirtyState {
    this.assertAlive();
    this.updateCalls += 1;
    return DirtyState.FULL;
  }

  markClean(): void {
    this.assertAlive();
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    this.assertAlive();
    return { x: 0, y: 0, visible: true };
  }

  getScrollbackLength(): number {
    this.assertAlive();
    return 0;
  }

  getViewport(): any[] {
    this.assertAlive();
    return [];
  }

  isRowDirty(): boolean {
    this.assertAlive();
    return true;
  }

  resize(cols: number, rows: number): void {
    this.assertAlive();
    this.cols = cols;
    this.rows = rows;
  }

  getMode(): boolean {
    this.assertAlive();
    return false;
  }

  getKittyKeyboardFlags(): number {
    this.assertAlive();
    return 0;
  }

  getKittyImagesDirty(): boolean {
    this.assertAlive();
    return false;
  }

  clearKittyImagesDirty(): void {
    this.assertAlive();
  }

  getKittyImageIds(): number[] {
    this.assertAlive();
    return [];
  }

  getKittyImageInfo(): null {
    this.assertAlive();
    return null;
  }

  getKittyImageData(): null {
    this.assertAlive();
    return null;
  }

  getKittyPlacements(): any[] {
    this.assertAlive();
    return [];
  }

  readResponse(): null {
    this.assertAlive();
    return null;
  }

  isAlternateScreen(): boolean {
    this.assertAlive();
    return false;
  }

  free(): void {
    this.freed = true;
  }
}

const terminalState = {
  reset() {
    MockTerminal.instances = [];
  },
  get last(): MockTerminal | null {
    return MockTerminal.instances.at(-1) ?? null;
  },
};

vi.mock('../../src/terminal/ghostty-vt/terminal', () => ({
  GhosttyVtTerminal: MockTerminal,
}));

let GhosttyVTEmulator: typeof import('../../src/terminal/ghostty-vt/emulator').GhosttyVTEmulator;

beforeAll(async () => {
  ({ GhosttyVTEmulator } = await import('../../src/terminal/ghostty-vt/emulator'));
});

beforeEach(() => {
  terminalState.reset();
});

describe('GhosttyVTEmulator', () => {
  it('tracks dirty rows while disabled but defers update callbacks until enabled', () => {
    const emulator = new GhosttyVTEmulator(2, 1, getDefaultColors());
    const terminal = terminalState.last;
    expect(terminal).not.toBeNull();

    const updateSpy = vi.fn();
    emulator.onUpdate(updateSpy);
    updateSpy.mockClear();

    const updateCallsBefore = terminal!.updateCalls;

    emulator.setUpdateEnabled(false);
    emulator.write('hello');

    expect(terminal!.writeCalls).toContain('hello');
    expect(terminal!.updateCalls).toBeGreaterThan(updateCallsBefore);
    expect(updateSpy).not.toHaveBeenCalled();

    emulator.setUpdateEnabled(true);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('returns safe defaults after dispose', () => {
    const emulator = new GhosttyVTEmulator(2, 1, getDefaultColors());
    emulator.dispose();

    expect(emulator.getCursor()).toEqual({ x: 0, y: 0, visible: false });
    expect(emulator.getKittyImagesDirty()).toBe(false);
    expect(emulator.getKittyImageIds()).toEqual([]);
    expect(emulator.getKittyPlacements()).toEqual([]);
    expect(emulator.drainResponses()).toEqual([]);
  });
});
