import { createEffect, on, type Accessor } from 'solid-js';
import { deferNextTick } from '../../core/scheduling';
import type { SessionState } from '../../core/operations/session-actions';

export function setupAppLayoutEffects(params: {
  width: Accessor<number>;
  height: Accessor<number>;
  setViewport: (rect: { x: number; y: number; width: number; height: number }) => void;
  sessionState: SessionState;
  hasAnyPanes: () => boolean;
  newPane: (type?: 'shell') => void;
  ensurePixelResize: () => void;
  layout: { layoutGeometryVersion: unknown };
  terminal: { isInitialized: boolean };
  paneResizeHandlers: {
    scheduleResizeAllPanes: () => void;
    restorePaneSizes: () => void;
  };
  aggregateState: { showAggregateView: boolean };
}): void {
  const {
    width,
    height,
    setViewport,
    sessionState,
    hasAnyPanes,
    newPane,
    ensurePixelResize,
    layout,
    terminal,
    paneResizeHandlers,
    aggregateState,
  } = params;

  // Update viewport when terminal resizes
  createEffect(() => {
    const w = width();
    const h = height();
    if (w > 0 && h > 0) {
      // Reserve 1 row for status bar
      setViewport({ x: 0, y: 0, width: w, height: h - 1 });
    }
  });

  // Create first pane only if session loaded with no panes
  createEffect(
    on(
      () => sessionState.initialized,
      (initialized) => {
        if (!initialized) return;
        if (!hasAnyPanes()) {
          newPane('shell');
        }
        deferNextTick(() => {
          ensurePixelResize();
        });
      },
      { defer: true }
    )
  );

  // Resize PTYs and update positions when pane geometry or terminal size changes
  // Skip when aggregate view is open - InteractivePreview handles preview sizing
  createEffect(() => {
    if (!terminal.isInitialized) return;
    if (aggregateState.showAggregateView) return;
    layout.layoutGeometryVersion;
    const w = width();
    const h = height();
    if (w <= 0 || h <= 0) return;
    paneResizeHandlers.scheduleResizeAllPanes();
  });

  // Restore PTY sizes when aggregate view closes
  // Defer to next tick to allow preview unmount to complete first
  createEffect(
    on(
      () => aggregateState.showAggregateView,
      (isOpen, wasOpen) => {
        if (wasOpen && !isOpen && terminal.isInitialized) {
          deferNextTick(() => {
            paneResizeHandlers.restorePaneSizes();
          });
        }
      },
      { defer: true }
    )
  );
}
