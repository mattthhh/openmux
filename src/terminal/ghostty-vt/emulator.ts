/**
 * GhosttyVTEmulator - ITerminalEmulator implementation backed by native libghostty-vt.
 */

import type {
  IKittyGraphicsEmulator,
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { mapKittyImageInfo, mapKittyPlacements } from './kitty';
import { drainTerminalResponses } from './responses';
import { GhosttyVTEmulatorCore } from './emulator-core';

export class GhosttyVTEmulator
  extends GhosttyVTEmulatorCore
  implements ITerminalEmulator, IKittyGraphicsEmulator
{
  getKittyKeyboardFlags(): number {
    if (this._disposed) return 0;
    return this.terminal.getKittyKeyboardFlags();
  }

  getKittyImagesDirty(): boolean {
    if (this._disposed) return false;
    return this.terminal.getKittyImagesDirty();
  }

  clearKittyImagesDirty(): void {
    if (this._disposed) return;
    this.terminal.clearKittyImagesDirty();
  }

  getKittyImageIds(): number[] {
    if (this._disposed) return [];
    return this.terminal.getKittyImageIds();
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    if (this._disposed) return null;
    return mapKittyImageInfo(this.terminal, imageId);
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    if (this._disposed) return null;
    return this.terminal.getKittyImageData(imageId);
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    if (this._disposed) return [];
    return mapKittyPlacements(this.terminal);
  }

  drainResponses(): string[] {
    if (this._disposed) return [];
    return drainTerminalResponses(this.terminal);
  }
}

export function createGhosttyVTEmulator(
  cols: number,
  rows: number,
  colors: TerminalColors
): GhosttyVTEmulator {
  return new GhosttyVTEmulator(cols, rows, colors);
}
