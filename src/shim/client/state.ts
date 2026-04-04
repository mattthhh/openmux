import type {
  TerminalCell,
  TerminalScrollState,
  TerminalState,
  UnifiedTerminalUpdate,
} from '../../core/types';
import type {
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../../terminal/emulator-interface';
import { tracePtyEvent } from '../../terminal/pty-trace';

type ScrollbackAwareEmulator = ITerminalEmulator & {
  handleScrollbackChange?: (newLength: number, isAtScrollbackLimit: boolean) => void;
};

export type PtyState = {
  terminalState: TerminalState | null;
  cachedRows: TerminalCell[][];
  scrollState: TerminalScrollState;
  title: string;
};

export type KittyGraphicsImageEntry = {
  info: KittyGraphicsImageInfo;
  data: Uint8Array | null;
};

export type KittyGraphicsState = {
  images: Map<number, KittyGraphicsImageEntry>;
  placements: KittyGraphicsPlacement[];
  dirty: boolean;
  seedImageIds: Set<number>;
};

export type KittyScreenKey = 'main' | 'alt';
type KittyScreenState = {
  main: KittyGraphicsState;
  alt: KittyGraphicsState;
};

export type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: string };

export type TitleEvent = { ptyId: string; title: string };
export type ActivityEvent = { ptyId: string };

export type KittyTransmitEvent = { ptyId: string; sequence: string };
export type KittyUpdateEvent = { ptyId: string };

type UnifiedSubscriber = (update: UnifiedTerminalUpdate) => void;

const unifiedSubscribers = new Map<string, Set<UnifiedSubscriber>>();
const stateSubscribers = new Map<string, Set<(state: TerminalState) => void>>();
const scrollSubscribers = new Map<string, Set<() => void>>();
const exitSubscribers = new Map<string, Set<(exitCode: number) => void>>();
const titleSubscribers = new Map<string, Set<(title: string) => void>>();
const globalTitleSubscribers = new Set<(event: TitleEvent) => void>();
const activitySubscribers = new Set<(event: ActivityEvent) => void>();
const lifecycleSubscribers = new Set<(event: LifecycleEvent) => void>();
const kittyTransmitSubscribers = new Set<(event: KittyTransmitEvent) => void>();
const kittyUpdateSubscribers = new Set<(event: KittyUpdateEvent) => void>();
const pendingKittyTransmitEvents: KittyTransmitEvent[] = [];
const MAX_PENDING_KITTY_TRANSMITS = 2048;

const ptyStates = new Map<string, PtyState>();
const emulatorCache = new Map<string, ScrollbackAwareEmulator>();
let emulatorFactory: ((ptyId: string) => ScrollbackAwareEmulator) | null = null;
const kittyStates = new Map<string, KittyScreenState>();

function clearPtySubscribers(ptyId: string): void {
  unifiedSubscribers.delete(ptyId);
  stateSubscribers.delete(ptyId);
  scrollSubscribers.delete(ptyId);
  exitSubscribers.delete(ptyId);
  titleSubscribers.delete(ptyId);
}

export function registerEmulatorFactory(factory: (ptyId: string) => ScrollbackAwareEmulator): void {
  emulatorFactory = factory;
}

export function getEmulator(ptyId: string): ITerminalEmulator {
  let emulator = emulatorCache.get(ptyId);
  if (!emulator) {
    if (!emulatorFactory) {
      throw new Error('Emulator factory not registered');
    }
    emulator = emulatorFactory(ptyId);
    emulatorCache.set(ptyId, emulator);
  }
  return emulator;
}

export function getPtyState(ptyId: string): PtyState | undefined {
  return ptyStates.get(ptyId);
}

export function setPtyState(ptyId: string, state: PtyState): void {
  ptyStates.set(ptyId, state);
}

export function deletePtyState(ptyId: string): void {
  ptyStates.delete(ptyId);
  emulatorCache.delete(ptyId);
  kittyStates.delete(ptyId);

  // Drop buffered kitty transmit events for destroyed PTYs.
  for (let i = pendingKittyTransmitEvents.length - 1; i >= 0; i--) {
    if (pendingKittyTransmitEvents[i]?.ptyId === ptyId) {
      pendingKittyTransmitEvents.splice(i, 1);
    }
  }
}

function createEmptyKittyState(): KittyGraphicsState {
  return { images: new Map(), placements: [], dirty: false, seedImageIds: new Set() };
}

function getKittyScreenState(ptyId: string, screen: KittyScreenKey): KittyGraphicsState {
  let state = kittyStates.get(ptyId);
  if (!state) {
    state = { main: createEmptyKittyState(), alt: createEmptyKittyState() };
    kittyStates.set(ptyId, state);
  }
  return state[screen];
}

export function handleUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
  applyUnifiedUpdate(ptyId, update);
  notifySubscribers(ptyId, update);
}

export function handlePtyExit(ptyId: string, exitCode: number): void {
  const subscribers = exitSubscribers.get(ptyId);
  if (subscribers) {
    for (const callback of subscribers) {
      callback(exitCode);
    }
  }
}

export function handlePtyTitle(ptyId: string, title: string): void {
  const existing = ptyStates.get(ptyId);
  if (existing) {
    existing.title = title;
  } else {
    ptyStates.set(ptyId, {
      terminalState: null,
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title,
    });
  }

  const perPty = titleSubscribers.get(ptyId);
  if (perPty) {
    for (const callback of perPty) {
      callback(title);
    }
  }
  for (const callback of globalTitleSubscribers) {
    callback({ ptyId, title });
  }
}

export function handlePtyActivity(ptyId: string): void {
  for (const callback of activitySubscribers) {
    callback({ ptyId });
  }
}

export function handlePtyLifecycle(ptyId: string, eventType: 'created' | 'destroyed'): void {
  if (eventType === 'destroyed') {
    deletePtyState(ptyId);
    clearPtySubscribers(ptyId);
  }
  for (const callback of lifecycleSubscribers) {
    callback({ type: eventType, ptyId });
  }
}

export function handlePtyKittyUpdate(
  ptyId: string,
  update: {
    images: KittyGraphicsImageInfo[];
    placements: KittyGraphicsPlacement[];
    removedImageIds: number[];
    imageData: Map<number, Uint8Array>;
    alternateScreen: boolean;
  }
): void {
  const screen: KittyScreenKey = update.alternateScreen ? 'alt' : 'main';
  const existing = getKittyScreenState(ptyId, screen);
  const nextImages = new Map<number, KittyGraphicsImageEntry>();

  for (const info of update.images) {
    const previous = existing?.images.get(info.id);
    const data = update.imageData.get(info.id) ?? previous?.data ?? null;
    nextImages.set(info.id, { info, data });
  }

  for (const id of update.removedImageIds) {
    nextImages.delete(id);
  }

  const nextState: KittyGraphicsState = {
    images: nextImages,
    placements: update.placements,
    dirty: true,
    seedImageIds: new Set(update.imageData.keys()),
  };
  const bundle = kittyStates.get(ptyId) ?? {
    main: createEmptyKittyState(),
    alt: createEmptyKittyState(),
  };
  bundle[screen] = nextState;
  kittyStates.set(ptyId, bundle);

  tracePtyEvent('kitty-client-update', {
    ptyId,
    screen,
    images: nextImages.size,
    placements: update.placements.length,
    removed: update.removedImageIds.length,
    imageData: update.imageData.size,
  });

  for (const callback of kittyUpdateSubscribers) {
    callback({ ptyId });
  }
}

export function handlePtyKittyTransmit(ptyId: string, sequence: string): void {
  const event: KittyTransmitEvent = { ptyId, sequence };

  if (kittyTransmitSubscribers.size === 0) {
    pendingKittyTransmitEvents.push(event);
    if (pendingKittyTransmitEvents.length > MAX_PENDING_KITTY_TRANSMITS) {
      pendingKittyTransmitEvents.splice(
        0,
        pendingKittyTransmitEvents.length - MAX_PENDING_KITTY_TRANSMITS
      );
    }
    return;
  }

  for (const callback of kittyTransmitSubscribers) {
    callback(event);
  }
}

export function getKittyState(
  ptyId: string,
  alternateScreen: boolean = false
): KittyGraphicsState | undefined {
  const state = kittyStates.get(ptyId);
  if (!state) return undefined;
  return alternateScreen ? state.alt : state.main;
}

export function subscribeUnified(ptyId: string, callback: UnifiedSubscriber): () => void {
  const set = unifiedSubscribers.get(ptyId) ?? new Set<UnifiedSubscriber>();
  set.add(callback);
  unifiedSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId);
  if (cached?.terminalState) {
    const fullState = cached.terminalState;
    const scrollState = cached.scrollState;
    const initialUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: fullState.cursor,
        scrollState,
        cols: fullState.cols,
        rows: fullState.rows,
        isFull: true,
        fullState,
        alternateScreen: fullState.alternateScreen,
        mouseTracking: fullState.mouseTracking,
        cursorKeyMode: fullState.cursorKeyMode ?? 'normal',
        kittyKeyboardFlags: fullState.kittyKeyboardFlags ?? 0,
        inBandResize: false,
      },
      scrollState,
    };
    callback(initialUpdate);
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      unifiedSubscribers.delete(ptyId);
    }
  };
}

export function subscribeState(
  ptyId: string,
  callback: (state: TerminalState) => void
): () => void {
  const set = stateSubscribers.get(ptyId) ?? new Set<(state: TerminalState) => void>();
  set.add(callback);
  stateSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId)?.terminalState;
  if (cached) {
    callback(cached);
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      stateSubscribers.delete(ptyId);
    }
  };
}

export function subscribeScroll(ptyId: string, callback: () => void): () => void {
  const set = scrollSubscribers.get(ptyId) ?? new Set<() => void>();
  set.add(callback);
  scrollSubscribers.set(ptyId, set);

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      scrollSubscribers.delete(ptyId);
    }
  };
}

export function subscribeExit(ptyId: string, callback: (exitCode: number) => void): () => void {
  const set = exitSubscribers.get(ptyId) ?? new Set<(exitCode: number) => void>();
  set.add(callback);
  exitSubscribers.set(ptyId, set);

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      exitSubscribers.delete(ptyId);
    }
  };
}

export function subscribeToTitle(ptyId: string, callback: (title: string) => void): () => void {
  const set = titleSubscribers.get(ptyId) ?? new Set<(title: string) => void>();
  set.add(callback);
  titleSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId)?.title;
  if (cached) {
    callback(cached);
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      titleSubscribers.delete(ptyId);
    }
  };
}

export function subscribeToAllTitles(callback: (event: TitleEvent) => void): () => void {
  globalTitleSubscribers.add(callback);
  return () => {
    globalTitleSubscribers.delete(callback);
  };
}

export function subscribeToActivity(callback: (event: ActivityEvent) => void): () => void {
  activitySubscribers.add(callback);
  return () => {
    activitySubscribers.delete(callback);
  };
}

export function subscribeToLifecycle(callback: (event: LifecycleEvent) => void): () => void {
  lifecycleSubscribers.add(callback);
  return () => {
    lifecycleSubscribers.delete(callback);
  };
}

export function subscribeKittyTransmit(callback: (event: KittyTransmitEvent) => void): () => void {
  kittyTransmitSubscribers.add(callback);

  // Rehydrate transmits received before bridge subscription (common during
  // shim attach snapshots where frames can arrive before UI mount).
  if (pendingKittyTransmitEvents.length > 0) {
    const pending = pendingKittyTransmitEvents.splice(0, pendingKittyTransmitEvents.length);
    for (const event of pending) {
      callback(event);
    }
  }

  return () => {
    kittyTransmitSubscribers.delete(callback);
  };
}

export function subscribeKittyUpdate(callback: (event: KittyUpdateEvent) => void): () => void {
  kittyUpdateSubscribers.add(callback);
  return () => {
    kittyUpdateSubscribers.delete(callback);
  };
}

function applyUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
  const existing = ptyStates.get(ptyId);

  if (update.terminalUpdate.isFull && update.terminalUpdate.fullState) {
    const fullState = update.terminalUpdate.fullState;
    if (update.terminalUpdate.kittyKeyboardFlags !== undefined) {
      fullState.kittyKeyboardFlags = update.terminalUpdate.kittyKeyboardFlags;
    }
    ptyStates.set(ptyId, {
      terminalState: fullState,
      cachedRows: [...fullState.cells],
      scrollState: update.scrollState,
      title: existing?.title ?? '',
    });
  } else if (existing?.terminalState) {
    const cachedRows = existing.cachedRows;
    for (const [rowIdx, newRow] of update.terminalUpdate.dirtyRows) {
      cachedRows[rowIdx] = newRow;
    }

    const nextState: TerminalState = {
      ...existing.terminalState,
      cells: cachedRows,
      cursor: update.terminalUpdate.cursor,
      alternateScreen: update.terminalUpdate.alternateScreen,
      mouseTracking: update.terminalUpdate.mouseTracking,
      cursorKeyMode: update.terminalUpdate.cursorKeyMode,
      kittyKeyboardFlags:
        update.terminalUpdate.kittyKeyboardFlags ?? existing.terminalState.kittyKeyboardFlags ?? 0,
    };

    ptyStates.set(ptyId, {
      terminalState: nextState,
      cachedRows,
      scrollState: update.scrollState,
      title: existing.title,
    });
  } else {
    ptyStates.set(ptyId, {
      terminalState: update.terminalUpdate.fullState ?? null,
      cachedRows: update.terminalUpdate.fullState?.cells
        ? [...update.terminalUpdate.fullState.cells]
        : [],
      scrollState: update.scrollState,
      title: existing?.title ?? '',
    });
  }

  const emulator = emulatorCache.get(ptyId);
  emulator?.handleScrollbackChange?.(
    update.scrollState.scrollbackLength,
    update.scrollState.isAtScrollbackLimit ?? false
  );
}

function notifySubscribers(ptyId: string, update: UnifiedTerminalUpdate): void {
  const unified = unifiedSubscribers.get(ptyId);
  if (unified) {
    for (const callback of unified) {
      callback(update);
    }
  }

  const state = ptyStates.get(ptyId)?.terminalState;
  if (state) {
    const legacy = stateSubscribers.get(ptyId);
    if (legacy) {
      for (const callback of legacy) {
        callback(state);
      }
    }
  }

  const scroll = scrollSubscribers.get(ptyId);
  if (scroll) {
    for (const callback of scroll) {
      callback();
    }
  }
}
