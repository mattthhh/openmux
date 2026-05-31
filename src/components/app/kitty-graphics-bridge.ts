/**
 * Kitty graphics bridge.
 *
 * Creates and wires the KittyGraphicsRenderer into the global singleton
 * (getKittyGraphicsRenderer) so that the terminal layer can access it
 * without reaching back through the UI component tree.
 *
 * The renderer is inherently process-global (one per terminal multiplexer),
 * so a global singleton is the right pattern. The DI threading through
 * App.tsx → setupAppEffects exists only to guarantee initialization order
 * (OpenTUI renderer must exist before kitty graphics can render), not for
 * dependency injection.
 */

import { onCleanup, onMount } from 'solid-js';
import { deferNextTick } from '../../core/scheduling';
import {
  KittyGraphicsRenderer,
  KittyTransmitBroker,
  setKittyGraphicsRenderer,
  setKittyTransmitBroker,
} from '../../terminal/kitty-graphics';
import { isShimClient } from '../../shim/mode';
import { subscribeKittyTransmit, subscribeKittyUpdate } from '../../shim/client';

export interface RendererWithNative {
  renderNative?: () => void;
  prependInputHandler?: (handler: (data: string) => boolean | void) => void;
  removeInputHandler?: (handler: (data: string) => boolean | void) => void;
  requestRender?: () => void;
  resolution?: { width: number; height: number };
  terminalWidth?: number;
  terminalHeight?: number;
  width?: number;
  height?: number;
}

export function createKittyGraphicsBridge(params: {
  renderer: RendererWithNative;
  ensurePixelResize: () => void;
  stopPixelResizePoll: () => void;
}): KittyGraphicsRenderer {
  const { renderer, ensurePixelResize, stopPixelResizePoll } = params;
  const kittyRenderer = new KittyGraphicsRenderer();
  const kittyBroker = new KittyTransmitBroker();
  setKittyGraphicsRenderer(kittyRenderer);
  setKittyTransmitBroker(kittyBroker);

  onMount(() => {
    const r = renderer as RendererWithNative;
    const originalRenderNative = r.renderNative?.bind(renderer);
    const pixelResolutionRegex = /\x1b\[4;\d+;\d+t/;
    const kittyResponseStartRegex = /(?:\x1b_G|\x9fG)/;
    const kittyResponseEndRegex = /(?:\x1b\\|\x9c)/;
    let kittyResponseBuffer = '';

    const handlePixelResolution = (sequence: string) => {
      if (!pixelResolutionRegex.test(sequence)) return false;
      deferNextTick(() => {
        ensurePixelResize();
      });
      return false;
    };

    const handleKittyResponses = (sequence: string) => {
      if (kittyResponseBuffer.length > 0) {
        kittyResponseBuffer += sequence;
        if (kittyResponseEndRegex.test(kittyResponseBuffer)) {
          kittyResponseBuffer = '';
        } else if (kittyResponseBuffer.length > 4096) {
          kittyResponseBuffer = '';
        }
        return true;
      }

      if (!kittyResponseStartRegex.test(sequence)) return false;
      if (!kittyResponseEndRegex.test(sequence)) {
        kittyResponseBuffer = sequence;
      }
      return true;
    };

    if (originalRenderNative) {
      r.renderNative = () => {
        originalRenderNative();
        kittyRenderer.flush(r);
      };
    }

    kittyBroker.setRenderer(r);
    kittyBroker.setAutoFlush(false);
    kittyBroker.setFlushScheduler(() => {
      r.requestRender?.();
    });
    let unsubscribeTransmit: (() => void) | null = null;
    let unsubscribeKittyUpdate: (() => void) | null = null;
    if (isShimClient()) {
      unsubscribeTransmit = subscribeKittyTransmit((event) => {
        kittyBroker.handleSequence(event.ptyId, event.sequence);
        queueMicrotask(() => {
          kittyBroker.flushPending();
        });
      });
      unsubscribeKittyUpdate = subscribeKittyUpdate(() => {
        queueMicrotask(() => {
          kittyRenderer.flush(r);
        });
        r.requestRender?.();
      });
    }
    r.prependInputHandler?.(handleKittyResponses);
    r.prependInputHandler?.(handlePixelResolution);
    ensurePixelResize();

    onCleanup(() => {
      if (originalRenderNative) {
        r.renderNative = originalRenderNative;
      }
      kittyBroker.setAutoFlush(true);
      kittyBroker.setFlushScheduler(null);
      r.removeInputHandler?.(handleKittyResponses);
      r.removeInputHandler?.(handlePixelResolution);
      stopPixelResizePoll();
      unsubscribeTransmit?.();
      unsubscribeKittyUpdate?.();
      kittyRenderer.dispose();
      kittyBroker.dispose();
      setKittyGraphicsRenderer(null);
      setKittyTransmitBroker(null);
      kittyResponseBuffer = '';
    });
  });

  return kittyRenderer;
}
