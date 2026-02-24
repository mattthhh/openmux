import type { ITerminalEmulator } from '../../emulator-interface';
import { buildDeleteImage, buildTransmitImage } from '../commands';
import { getKittyTransmitBroker } from '../transmit-broker';
import { tracePtyEvent } from '../../pty-trace';
import {
  buildScreenKey,
  getScreenKeys,
  isSameImage,
} from '../renderer-helpers';
import type { ImageCache, PtyKittyState, PlacementRender } from '../types';
import { deletePlacementsForImage } from './placements';

function getScreenState(
  screenStates: Map<string, PtyKittyState>,
  screenKey: string
): PtyKittyState {
  let state = screenStates.get(screenKey);
  if (!state) {
    state = { images: new Map(), placements: [], initialized: false };
    screenStates.set(screenKey, state);
  }
  return state;
}

function getImageRegistry(
  imageRegistry: Map<string, Map<number, ImageCache>>,
  ptyId: string
): Map<number, ImageCache> {
  let registry = imageRegistry.get(ptyId);
  if (!registry) {
    registry = new Map();
    imageRegistry.set(ptyId, registry);
  }
  return registry;
}

export function updatePtyState(params: {
  ptyId: string;
  emulator: ITerminalEmulator;
  isAlternateScreen: boolean;
  output: string[];
  allowPlacementReuse: boolean;
  screenStates: Map<string, PtyKittyState>;
  imageRegistry: Map<string, Map<number, ImageCache>>;
  placementsByPane: Map<string, Map<string, PlacementRender>>;
  nextHostImageId: number;
}): number {
  const {
    ptyId,
    emulator,
    isAlternateScreen,
    output,
    allowPlacementReuse,
    screenStates,
    imageRegistry,
    placementsByPane,
  } = params;
  let nextHostImageId = params.nextHostImageId;

  if (emulator.isDisposed) return nextHostImageId;
  const supportsKitty = !!emulator.getKittyImageIds && !!emulator.getKittyPlacements;
  if (!supportsKitty) return nextHostImageId;

  const dirty = emulator.getKittyImagesDirty?.() ?? false;
  const screenKey = buildScreenKey(ptyId, isAlternateScreen);
  const screenState = getScreenState(screenStates, screenKey);
  const broker = getKittyTransmitBroker();
  if (screenState.initialized && !dirty && !allowPlacementReuse) {
    tracePtyEvent('kitty-render-update-skip', {
      ptyId,
      screen: isAlternateScreen ? 'alt' : 'main',
      allowReuse: allowPlacementReuse,
    });
    return nextHostImageId;
  }

  const ids = emulator.getKittyImageIds?.() ?? [];
  const nextImages = new Map<number, ImageCache>();
  const previousImages = screenState.images;
  const registry = getImageRegistry(imageRegistry, ptyId);
  let imagesChanged = ids.length !== previousImages.size;

  for (const id of ids) {
    const info = emulator.getKittyImageInfo?.(id);
    if (!info) continue;

    const previousScreen = previousImages.get(id);
    const previous = registry.get(id);
    const brokerHostId = broker?.resolveHostId(ptyId, info) ?? null;
    const hostId = brokerHostId ?? previous?.hostId ?? nextHostImageId++;
    const changed = !previous || !isSameImage(previous.info, info);
    if (!previousScreen || !isSameImage(previousScreen.info, info)) {
      imagesChanged = true;
    }

    if (changed) {
      const data = emulator.getKittyImageData?.(id);
      if (data) {
        const transmit = buildTransmitImage(hostId, info, data);
        if (transmit) {
          output.push(transmit);
          if (brokerHostId) {
            tracePtyEvent('kitty-render-image-seed', {
              ptyId,
              imageId: id,
              hostId,
              reason: 'broker-mapped',
            });
          }
        }
      }
    }

    const cache = previous ?? { hostId, info };
    cache.hostId = hostId;
    cache.info = info;
    registry.set(id, cache);
    nextImages.set(id, cache);
  }

  const nextPlacements = emulator.getKittyPlacements?.() ?? [];
  // Only reuse placements during an alt/main screen transition. When scrollback
  // trims, Ghostty returns no placements; reusing them keeps stale images pinned.
  const shouldReusePlacements =
    allowPlacementReuse &&
    nextPlacements.length === 0 &&
    nextImages.size > 0;
  if (shouldReusePlacements) {
    screenState.images = nextImages;
  } else {
    screenState.images = nextImages;
    screenState.placements = nextPlacements;
  }
  tracePtyEvent('kitty-render-update', {
    ptyId,
    screen: isAlternateScreen ? 'alt' : 'main',
    dirty,
    allowReuse: allowPlacementReuse,
    imagesChanged,
    reused: shouldReusePlacements,
    images: nextImages.size,
    placements: nextPlacements.length,
    cachedPlacements: screenState.placements.length,
  });
  screenState.initialized = true;
  emulator.clearKittyImagesDirty?.();

  const activeIds = new Set<number>();
  for (const key of getScreenKeys(ptyId)) {
    const state = screenStates.get(key);
    if (!state) continue;
    for (const id of state.images.keys()) {
      activeIds.add(id);
    }
  }
  for (const [id, image] of registry) {
    if (activeIds.has(id)) continue;
    output.push(buildDeleteImage(image.hostId));
    deletePlacementsForImage({ imageId: id, placementsByPane, output });
    broker?.dropMapping(ptyId, image.info);
    registry.delete(id);
  }
  if (registry.size === 0) {
    imageRegistry.delete(ptyId);
  }

  return nextHostImageId;
}
