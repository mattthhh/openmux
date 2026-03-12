/**
 * Interactive terminal preview component for aggregate view
 * Thin wrapper around TerminalView that manages temporary PTY resize while preview is interactive
 */

import { Show, createEffect, onCleanup } from 'solid-js';
import { useRenderer, useTerminalDimensions } from '@opentui/solid';
import { useTerminal } from '../../contexts/TerminalContext';
import { useOverlayColors } from '../overlay-colors';
import { TerminalView } from '../TerminalView';

export interface InteractivePreviewProps {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}

interface PtyDimensions {
  cols: number;
  rows: number;
}

export function InteractivePreview(props: InteractivePreviewProps) {
  const { subtle: overlaySubtle } = useOverlayColors();
  const terminal = useTerminal();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  const originalSizes = new Map<string, PtyDimensions>();
  let activePreviewPtyId: string | null = null;
  let lastResize: {
    ptyId: string;
    width: number;
    height: number;
    pixelWidth: number | null;
    pixelHeight: number | null;
  } | null = null;

  const getCellMetrics = () => {
    const rendererAny = renderer as any;
    const resolution = rendererAny?.resolution ?? null;
    const terminalWidth = dimensions().width || rendererAny?.terminalWidth || rendererAny?.width || 0;
    const terminalHeight = dimensions().height || rendererAny?.terminalHeight || rendererAny?.height || 0;
    if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;
    return {
      cellWidth: Math.max(1, Math.floor(resolution.width / terminalWidth)),
      cellHeight: Math.max(1, Math.floor(resolution.height / terminalHeight)),
    };
  };

  const getCurrentPtyDimensions = (ptyId: string): PtyDimensions | null => {
    const state = terminal.getTerminalStateSync(ptyId);
    if (state) {
      return { cols: state.cols, rows: state.rows };
    }

    const emulator = terminal.getEmulatorSync(ptyId);
    if (!emulator) return null;
    return { cols: emulator.cols, rows: emulator.rows };
  };

  const getPixelDimensions = (cols: number, rows: number) => {
    const metrics = getCellMetrics();
    const pixelWidth = metrics ? cols * metrics.cellWidth : null;
    const pixelHeight = metrics ? rows * metrics.cellHeight : null;
    return { pixelWidth, pixelHeight };
  };

  const resizeWithCurrentCellMetrics = (ptyId: string, cols: number, rows: number) => {
    const { pixelWidth, pixelHeight } = getPixelDimensions(cols, rows);
    terminal.resizePTY(ptyId, cols, rows, pixelWidth ?? undefined, pixelHeight ?? undefined);
    return { pixelWidth, pixelHeight };
  };

  const restoreOriginalSize = (ptyId: string) => {
    const original = originalSizes.get(ptyId);
    if (!original) return;
    resizeWithCurrentCellMetrics(ptyId, original.cols, original.rows);
    originalSizes.delete(ptyId);
  };

  createEffect(() => {
    const ptyId = props.ptyId;
    const width = props.width;
    const height = props.height;
    const isInteractive = props.isInteractive;

    if (!isInteractive || !ptyId) {
      if (activePreviewPtyId) {
        restoreOriginalSize(activePreviewPtyId);
      }
      activePreviewPtyId = null;
      lastResize = null;
      return;
    }

    if (activePreviewPtyId && activePreviewPtyId !== ptyId) {
      restoreOriginalSize(activePreviewPtyId);
      lastResize = null;
    }

    activePreviewPtyId = ptyId;

    if (!originalSizes.has(ptyId)) {
      const currentSize = getCurrentPtyDimensions(ptyId);
      if (currentSize) {
        originalSizes.set(ptyId, currentSize);
      }
    }

    const { pixelWidth, pixelHeight } = getPixelDimensions(width, height);

    if (
      lastResize &&
      lastResize.ptyId === ptyId &&
      lastResize.width === width &&
      lastResize.height === height &&
      lastResize.pixelWidth === pixelWidth &&
      lastResize.pixelHeight === pixelHeight
    ) {
      return;
    }

    terminal.resizePTY(ptyId, width, height, pixelWidth ?? undefined, pixelHeight ?? undefined);
    lastResize = { ptyId, width, height, pixelWidth, pixelHeight };
  });

  onCleanup(() => {
    if (activePreviewPtyId) {
      restoreOriginalSize(activePreviewPtyId);
    }
  });

  return (
    <Show
      when={props.ptyId}
      fallback={
        <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
          <text fg={overlaySubtle()}>No terminal selected</text>
        </box>
      }
    >
      <TerminalView
        ptyId={props.ptyId!}
        width={props.width}
        height={props.height}
        isFocused={props.isInteractive}
        offsetX={props.offsetX}
        offsetY={props.offsetY}
        kittyLayer="overlay"
      />
    </Show>
  );
}
