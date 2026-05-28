/**
 * Tests for batched pane resize scheduling.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from 'bun:test';
import type { PaneData } from '../../../src/core/types';
import { createPaneResizeHandlers } from '../../../src/components/app/pane-resize';

type ImmediateTask = () => void;

describe('createPaneResizeHandlers', () => {
  let immediateQueue: ImmediateTask[] = [];
  let originalSetImmediate: typeof setImmediate | undefined;
  let hadSetImmediate = false;

  const runNextTick = () => {
    const task = immediateQueue.shift();
    if (!task) {
      throw new Error('Expected scheduled task but queue was empty');
    }
    task();
  };

  beforeEach(() => {
    immediateQueue = [];
    hadSetImmediate = 'setImmediate' in globalThis;
    originalSetImmediate = hadSetImmediate ? globalThis.setImmediate : undefined;
    globalThis.setImmediate = ((fn: ImmediateTask) => {
      immediateQueue.push(fn);
      return 0 as unknown as NodeJS.Immediate;
    }) as typeof setImmediate;
  });

  afterEach(() => {
    if (hadSetImmediate && originalSetImmediate) {
      globalThis.setImmediate = originalSetImmediate;
    } else {
      delete (globalThis as { setImmediate?: typeof setImmediate }).setImmediate;
    }
  });

  const makePane = (index: number): PaneData => ({
    id: `pane-${index}`,
    ptyId: `pty-${index}`,
    rectangle: { x: index * 10, y: 0, width: 10, height: 6 },
  });

  test('batches resize work across ticks', () => {
    const panes = [0, 1, 2, 3, 4].map(makePane);
    const resizePTY = vi.fn();

    const handlers = createPaneResizeHandlers({
      getPanes: () => panes,
      resizePTY,
    });

    handlers.scheduleResizeAllPanes();

    expect(resizePTY).not.toHaveBeenCalled();

    runNextTick();
    expect(resizePTY).toHaveBeenCalledTimes(2);

    runNextTick();
    expect(resizePTY).toHaveBeenCalledTimes(4);

    runNextTick();
    expect(resizePTY).toHaveBeenCalledTimes(5);
  });

  test('coalesces rapid resize scheduling', () => {
    const panes = [0, 1, 2].map(makePane);
    const resizePTY = vi.fn();

    const handlers = createPaneResizeHandlers({
      getPanes: () => panes,
      resizePTY,
    });

    handlers.scheduleResizeAllPanes();
    handlers.scheduleResizeAllPanes();

    expect(immediateQueue.length).toBe(1);

    while (immediateQueue.length > 0) {
      runNextTick();
    }

    expect(resizePTY).toHaveBeenCalledTimes(3);
  });

  test('re-applies resize when pixel metrics change', () => {
    const panes = [makePane(0)];
    const resizePTY = vi.fn();
    let metrics = { cellWidth: 8, cellHeight: 16 };

    const handlers = createPaneResizeHandlers({
      getPanes: () => panes,
      resizePTY,
      getCellMetrics: () => metrics,
    });

    handlers.resizeAllPanes();

    expect(resizePTY).toHaveBeenCalledTimes(1);
    expect(resizePTY).toHaveBeenLastCalledWith('pty-0', 8, 4, 64, 64);

    metrics = { cellWidth: 10, cellHeight: 20 };
    handlers.resizeAllPanes();

    expect(resizePTY).toHaveBeenCalledTimes(2);
    expect(resizePTY).toHaveBeenLastCalledWith('pty-0', 8, 4, 80, 80);
  });
});
