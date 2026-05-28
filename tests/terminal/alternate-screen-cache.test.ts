/**
 * Tests for scrollback cache invalidation on alternate screen transitions.
 */

import { describe, it, expect } from 'bun:test';
import { shouldClearCacheOnUpdate } from '../../src/terminal/emulator-utils/scrollback-cache';
import type { DirtyTerminalUpdate, TerminalCell } from '../../src/core/types';
import type { TerminalModes } from '../../src/terminal/emulator-interface';

function createUpdate(alternateScreen: boolean): DirtyTerminalUpdate {
  return {
    dirtyRows: new Map<number, TerminalCell[]>(),
    cursor: { x: 0, y: 0, visible: false },
    scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
    cols: 80,
    rows: 24,
    isFull: false,
    alternateScreen,
    mouseTracking: false,
    cursorKeyMode: 'normal',
    kittyKeyboardFlags: 0,
    inBandResize: false,
  };
}

describe('alternate screen cache invalidation', () => {
  it('clears cache when entering alternate screen', () => {
    const currentModes: TerminalModes = {
      mouseTracking: false,
      cursorKeyMode: 'normal',
      alternateScreen: false,
      inBandResize: false,
    };

    const update = createUpdate(true);
    expect(shouldClearCacheOnUpdate(update, currentModes)).toBe(true);
  });

  it('clears cache when exiting alternate screen', () => {
    const currentModes: TerminalModes = {
      mouseTracking: false,
      cursorKeyMode: 'normal',
      alternateScreen: true,
      inBandResize: false,
    };

    const update = createUpdate(false);
    expect(shouldClearCacheOnUpdate(update, currentModes)).toBe(true);
  });

  it('does not clear cache when alternate screen state is unchanged', () => {
    const currentModes: TerminalModes = {
      mouseTracking: false,
      cursorKeyMode: 'normal',
      alternateScreen: false,
      inBandResize: false,
    };

    const update = createUpdate(false);
    expect(shouldClearCacheOnUpdate(update, currentModes)).toBe(false);
  });
});
