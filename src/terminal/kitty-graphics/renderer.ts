import { getHostCapabilities } from '../capabilities';
import { buildDeleteImage } from './commands';
import { getKittyTransmitBroker } from './transmit-broker';
import { tracePtyEvent } from '../pty-trace';
import {
  buildScreenKey,
  getCellMetrics,
  getScreenKeys,
  getWriter,
} from './renderer-helpers';
import { updatePtyState } from './renderer/pty-state';
import {
  clearPanePlacements,
  deletePlacementsForImage,
  renderPanePlacements,
} from './renderer/placements';
import type {
  ClipRect,
  KittyPaneLayer,
  PaneState,
  PlacementRender,
  PtyKittyState,
  RendererLike,
  ImageCache,
} from './types';

let activeKittyRenderer: KittyGraphicsRenderer | null = null;

export function getKittyGraphicsRenderer(): KittyGraphicsRenderer | null {
  return activeKittyRenderer;
}

export function setKittyGraphicsRenderer(renderer: KittyGraphicsRenderer | null): void {
  activeKittyRenderer = renderer;
}

export class KittyGraphicsRenderer {
  private panes = new Map<string, PaneState>();
  private screenStates = new Map<string, PtyKittyState>();
  private imageRegistry = new Map<string, Map<number, ImageCache>>();
  private placementsByPane = new Map<string, Map<string, PlacementRender>>();
  private screenTransitionTarget = new Map<string, boolean>();
  private pendingPtyDeletes = new Set<string>();
  private nextHostImageId = 1;
  private nextHostPlacementId = 1;
  private enabled = getHostCapabilities()?.kittyGraphics ?? false;
  private clipRects: ClipRect[] = [];
  private clipRectsKey = '';
  private visibleLayers = new Set<KittyPaneLayer>(['base', 'overlay']);

  updatePane(
    paneKey: string,
    state: Omit<PaneState, 'needsClear' | 'removed' | 'hidden' | 'layer'> & { layer?: KittyPaneLayer }
  ): void {
    const layer = state.layer ?? 'base';
    const emulator = state.emulator && !state.emulator.isDisposed ? state.emulator : null;
    const existing = this.panes.get(paneKey);
    if (existing) {
      if (existing.ptyId !== state.ptyId) {
        existing.needsClear = true;
      }
      if (existing.isAlternateScreen !== state.isAlternateScreen) {
        existing.needsClear = true;
        if (existing.ptyId) {
          this.screenTransitionTarget.set(existing.ptyId, state.isAlternateScreen);
          tracePtyEvent('kitty-render-screen-switch', {
            ptyId: existing.ptyId,
            target: state.isAlternateScreen ? 'alt' : 'main',
          });
        }
      }
      if (existing.layer !== layer) {
        existing.needsClear = true;
      }
      if (existing.emulator && !emulator) {
        existing.needsClear = true;
      }
      existing.ptyId = state.ptyId;
      existing.emulator = emulator;
      existing.offsetX = state.offsetX;
      existing.offsetY = state.offsetY;
      existing.width = state.width;
      existing.height = state.height;
      existing.cols = state.cols;
      existing.rows = state.rows;
      existing.viewportOffset = state.viewportOffset;
      existing.scrollbackLength = state.scrollbackLength;
      existing.isAlternateScreen = state.isAlternateScreen;
      existing.layer = layer;
      existing.removed = false;
      return;
    }

    this.panes.set(paneKey, {
      ...state,
      emulator,
      layer,
      hidden: false,
      needsClear: false,
      removed: false,
    });
  }

  removePane(paneKey: string): void {
    const pane = this.panes.get(paneKey);
    if (pane) {
      pane.removed = true;
    }
  }

  markPtyDestroyed(ptyId: string): void {
    this.pendingPtyDeletes.add(ptyId);
  }

  setClipRects(rects: ClipRect[]): void {
    const nextRects = rects
      .map((rect) => ({
        x: Math.max(0, Math.floor(rect.x)),
        y: Math.max(0, Math.floor(rect.y)),
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      }))
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const nextKey = nextRects.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join('|');
    if (nextKey === this.clipRectsKey) return;
    this.clipRects = nextRects;
    this.clipRectsKey = nextKey;
    tracePtyEvent('kitty-render-clips', {
      clipCount: nextRects.length,
      clipKeyLen: nextKey.length,
    });
  }

  setVisibleLayers(layers: Iterable<KittyPaneLayer>): void {
    const next = new Set<KittyPaneLayer>(layers);
    if (next.size === this.visibleLayers.size) {
      let same = true;
      for (const layer of next) {
        if (!this.visibleLayers.has(layer)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.visibleLayers = next;
    for (const pane of this.panes.values()) {
      pane.needsClear = true;
    }
  }

  dispose(): void {
    const broker = getKittyTransmitBroker();
    if (broker) {
      for (const ptyId of this.imageRegistry.keys()) {
        broker.clearPty(ptyId);
      }
    }
    this.panes.clear();
    this.screenStates.clear();
    this.imageRegistry.clear();
    this.placementsByPane.clear();
    this.clipRects = [];
    this.clipRectsKey = '';
    this.visibleLayers = new Set<KittyPaneLayer>(['base', 'overlay']);
  }

  flush(renderer: RendererLike): void {
    if (!this.enabled) return;

    const writeOut = getWriter(renderer);
    if (!writeOut) return;

    const broker = getKittyTransmitBroker();
    const flushedBroker = broker?.flushPending(writeOut) ?? false;

    const metrics = getCellMetrics(renderer);
    if (!metrics) {
      if (flushedBroker) return;
      return;
    }

    const output: string[] = [];

    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        continue;
      }
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      const shouldBeVisible = this.visibleLayers.has(pane.layer);
      if (shouldBeVisible && pane.hidden) {
        pane.hidden = false;
        pane.needsClear = true;
      } else if (!shouldBeVisible && !pane.hidden) {
        pane.hidden = true;
        pane.needsClear = true;
      }
    }

    const updatedScreens = new Set<string>();
    for (const [paneKey, pane] of this.panes) {
      if (pane.removed || !pane.ptyId || !pane.emulator) continue;
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      if (pane.hidden) continue;
      const emulatorScreen = pane.emulator.isAlternateScreen();
      const screenKey = buildScreenKey(pane.ptyId, emulatorScreen);
      if (updatedScreens.has(screenKey)) continue;
      updatedScreens.add(screenKey);

      if (emulatorScreen !== pane.isAlternateScreen) {
        tracePtyEvent('kitty-render-screen-mismatch', {
          ptyId: pane.ptyId,
          paneKey,
          pane: pane.isAlternateScreen ? 'alt' : 'main',
          emulator: emulatorScreen ? 'alt' : 'main',
        });
      }

      const allowPlacementReuse =
        emulatorScreen === pane.isAlternateScreen &&
        this.screenTransitionTarget.get(pane.ptyId) === pane.isAlternateScreen;
      this.nextHostImageId = updatePtyState({
        ptyId: pane.ptyId,
        emulator: pane.emulator,
        isAlternateScreen: emulatorScreen,
        output,
        allowPlacementReuse,
        screenStates: this.screenStates,
        imageRegistry: this.imageRegistry,
        placementsByPane: this.placementsByPane,
        nextHostImageId: this.nextHostImageId,
      });
      if (allowPlacementReuse) {
        this.screenTransitionTarget.delete(pane.ptyId);
      }
    }

    for (const [paneKey, pane] of this.panes) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        const reason = pane.removed
          ? 'removed'
          : (!pane.ptyId ? 'missing-pty' : 'missing-emulator');
        clearPanePlacements({ paneKey, placementsByPane: this.placementsByPane, output, reason });
        if (pane.removed) {
          this.panes.delete(paneKey);
        }
        continue;
      }

      if (pane.hidden) {
        if (pane.needsClear) {
          clearPanePlacements({
            paneKey,
            placementsByPane: this.placementsByPane,
            output,
            reason: 'hidden-layer',
          });
          pane.needsClear = false;
        }
        continue;
      }

      if (pane.needsClear) {
        clearPanePlacements({
          paneKey,
          placementsByPane: this.placementsByPane,
          output,
          reason: 'pane-reset',
        });
        pane.needsClear = false;
      }

      const screenKey = buildScreenKey(pane.ptyId, pane.isAlternateScreen);
      const ptyState = this.screenStates.get(screenKey);
      if (!ptyState) continue;

      this.nextHostPlacementId = renderPanePlacements({
        paneKey,
        pane,
        state: ptyState,
        metrics,
        output,
        clipRects: this.clipRects,
        placementsByPane: this.placementsByPane,
        nextHostPlacementId: this.nextHostPlacementId,
      });
    }

    if (this.pendingPtyDeletes.size > 0) {
      for (const ptyId of this.pendingPtyDeletes) {
        const images = this.imageRegistry.get(ptyId);
        if (images) {
          for (const [id, image] of images) {
            output.push(buildDeleteImage(image.hostId));
            deletePlacementsForImage({ imageId: id, placementsByPane: this.placementsByPane, output });
            broker?.dropMapping(ptyId, image.info);
          }
          this.imageRegistry.delete(ptyId);
        }
        for (const screenKey of getScreenKeys(ptyId)) {
          this.screenStates.delete(screenKey);
        }
        this.screenTransitionTarget.delete(ptyId);
        broker?.clearPty(ptyId);
      }
      this.pendingPtyDeletes.clear();
    }

    if (output.length === 0) {
      if (flushedBroker) return;
      return;
    }
    writeOut(output.join(''));
  }

}
