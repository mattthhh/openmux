/**
 * Interactive terminal preview component for aggregate view
 * Thin wrapper around TerminalView that handles PTY resize
 */

import { Show, createEffect, on } from 'solid-js';
import { useRenderer, useTerminalDimensions } from '@opentui/solid';
import { resizePty } from '../../effect/bridge';
import { isSavedAggregatePtyId } from '../../contexts/aggregate/rows';
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

export function InteractivePreview(props: InteractivePreviewProps) {
  const { subtle: overlaySubtle } = useOverlayColors();
  const renderer = useRenderer();
  const previewablePtyId = () => {
    if (!props.ptyId || isSavedAggregatePtyId(props.ptyId)) {
      return null;
    }
    return props.ptyId;
  };
  const dimensions = useTerminalDimensions();
  // Track last resize to avoid redundant calls
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
    const terminalWidth =
      dimensions().width || rendererAny?.terminalWidth || rendererAny?.width || 0;
    const terminalHeight =
      dimensions().height || rendererAny?.terminalHeight || rendererAny?.height || 0;
    if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;
    return {
      cellWidth: Math.max(1, Math.floor(resolution.width / terminalWidth)),
      cellHeight: Math.max(1, Math.floor(resolution.height / terminalHeight)),
    };
  };

  // Resize PTY when previewing to match preview dimensions
  // When aggregate view closes, App.tsx will restore the original pane dimensions
  createEffect(
    on(
      [previewablePtyId, () => props.width, () => props.height],
      ([ptyId, width, height]) => {
        if (!ptyId) return;

        const metrics = getCellMetrics();
        const pixelWidth = metrics ? width * metrics.cellWidth : null;
        const pixelHeight = metrics ? height * metrics.cellHeight : null;

        // Only resize if dimensions actually changed
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

        resizePty(ptyId, width, height, pixelWidth ?? undefined, pixelHeight ?? undefined);
        lastResize = { ptyId, width, height, pixelWidth, pixelHeight };
      },
      { defer: false }
    )
  );

  return (
    <Show
      when={previewablePtyId()}
      fallback={
        <box
          style={{
            width: props.width,
            height: props.height,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <text fg={overlaySubtle()}>No terminal selected</text>
        </box>
      }
    >
      <TerminalView
        ptyId={previewablePtyId()!}
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
