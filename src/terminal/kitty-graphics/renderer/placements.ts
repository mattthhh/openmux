import { buildDeletePlacement, buildDisplay } from '../commands';
import { applyClipRects, computePlacementRender } from '../geometry';
import { tracePtyEvent } from '../../pty-trace';
import { isSameRender } from '../renderer-helpers';
import type { CellMetrics, ClipRect, PaneState, PlacementRender, PtyKittyState } from '../types';

export function deletePlacementsForImage(params: {
  imageId: number;
  placementsByPane: Map<string, Map<string, PlacementRender>>;
  output: string[];
}): void {
  const { imageId, placementsByPane, output } = params;
  for (const [paneKey, placements] of placementsByPane) {
    for (const [key, placement] of placements) {
      if (placement.imageId !== imageId) continue;
      output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
      placements.delete(key);
    }
    if (placements.size === 0) {
      placementsByPane.delete(paneKey);
    }
  }
}

export function clearPanePlacements(params: {
  paneKey: string;
  placementsByPane: Map<string, Map<string, PlacementRender>>;
  output: string[];
  reason?: string;
}): void {
  const { paneKey, placementsByPane, output, reason } = params;
  const placements = placementsByPane.get(paneKey);
  if (!placements) return;

  for (const placement of placements.values()) {
    output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
  }
  const cleared = placements.size;
  placementsByPane.delete(paneKey);
  tracePtyEvent('kitty-render-clear', { paneKey, reason, cleared });
}

export function renderPanePlacements(params: {
  paneKey: string;
  pane: PaneState;
  state: PtyKittyState;
  metrics: CellMetrics;
  output: string[];
  clipRects: ClipRect[];
  placementsByPane: Map<string, Map<string, PlacementRender>>;
  nextHostPlacementId: number;
}): number {
  const { paneKey, pane, state, metrics, output, clipRects, placementsByPane } = params;
  let nextHostPlacementId = params.nextHostPlacementId;

  const prevPlacements = placementsByPane.get(paneKey) ?? new Map<string, PlacementRender>();
  const nextPlacements = new Map<string, PlacementRender>();
  if (state.placements.length === 0 && state.images.size > 0) {
    tracePtyEvent('kitty-render-empty-placements', {
      ptyId: pane.ptyId,
      paneKey,
      screen: pane.isAlternateScreen ? 'alt' : 'main',
      images: state.images.size,
    });
  }

  for (const placement of state.placements) {
    const image = state.images.get(placement.imageId);
    if (!image) continue;

    const baseRender = computePlacementRender(pane, placement, image.info, metrics);
    if (!baseRender) continue;

    const renders = applyClipRects(baseRender, metrics, clipRects);
    if (renders.length === 0) continue;

    for (const render of renders) {
      const existing = prevPlacements.get(render.key);
      const hostPlacementId = existing?.hostPlacementId ?? nextHostPlacementId++;
      const renderState: PlacementRender = {
        ...render,
        hostImageId: image.hostId,
        hostPlacementId,
      };

      nextPlacements.set(render.key, renderState);
      if (!existing || !isSameRender(existing, renderState)) {
        output.push(buildDisplay(renderState));
      }
    }
  }

  for (const [key, placement] of prevPlacements) {
    if (nextPlacements.has(key)) continue;
    output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
  }

  if (nextPlacements.size > 0) {
    placementsByPane.set(paneKey, nextPlacements);
  } else {
    placementsByPane.delete(paneKey);
  }
  if (nextPlacements.size > 0 || prevPlacements.size > 0) {
    tracePtyEvent('kitty-render-placements', {
      ptyId: pane.ptyId,
      paneKey,
      screen: pane.isAlternateScreen ? 'alt' : 'main',
      prevPlacements: prevPlacements.size,
      nextPlacements: nextPlacements.size,
    });
  }

  return nextHostPlacementId;
}
