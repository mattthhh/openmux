import type { TerminalCell, TerminalState, TerminalScrollState } from '../../core/types';
import type {
  SearchResult,
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../../terminal/emulator-interface';
import { getDefaultColors, getHostColors } from '../../terminal/terminal-colors';
import { ScrollbackCache } from '../../terminal/emulator-utils/scrollback-cache';
import type { KittyGraphicsState } from './state';

export type RemoteEmulatorDeps = {
  getPtyState: (ptyId: string) => {
    terminalState: TerminalState | null;
    scrollState: TerminalScrollState;
    title: string;
  } | undefined;
  getKittyState: (ptyId: string, alternateScreen?: boolean) => KittyGraphicsState | undefined;
  fetchScrollbackLines: (
    ptyId: string,
    startOffset: number,
    count: number
  ) => Promise<Map<number, TerminalCell[]>>;
  searchPty: (
    ptyId: string,
    query: string,
    options?: { limit?: number }
  ) => Promise<SearchResult>;
};

export class RemoteEmulator implements ITerminalEmulator {
  private ptyId: string;
  private deps: RemoteEmulatorDeps;
  private scrollbackCache = new ScrollbackCache(1000);
  private disposed = false;

  constructor(ptyId: string, deps: RemoteEmulatorDeps) {
    this.ptyId = ptyId;
    this.deps = deps;
  }

  get cols(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.cols ?? 0;
  }

  get rows(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.rows ?? 0;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  write(_data: string | Uint8Array): void {
    // Writes should go through the PTY service, not emulator.
  }

  resize(_cols: number, _rows: number): void {
    // Resizes should go through the PTY service, not emulator.
  }

  reset(): void {
    // No-op for remote emulator.
  }

  dispose(): void {
    this.disposed = true;
    this.scrollbackCache.clear();
  }

  getScrollbackLength(): number {
    return this.deps.getPtyState(this.ptyId)?.scrollState.scrollbackLength ?? 0;
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.scrollbackCache.get(offset);
  }

  async prefetchScrollbackLines(startOffset: number, count: number): Promise<void> {
    const lines = await this.deps.fetchScrollbackLines(this.ptyId, startOffset, count);
    this.scrollbackCache.setMany(lines);
  }

  getDirtyUpdate(scrollState: TerminalScrollState) {
    const state = this.deps.getPtyState(this.ptyId)?.terminalState;
    const cursor = state?.cursor ?? { x: 0, y: 0, visible: true };
    return {
      dirtyRows: new Map<number, TerminalCell[]>(),
      cursor,
      scrollState,
      cols: state?.cols ?? 0,
      rows: state?.rows ?? 0,
      isFull: false,
      alternateScreen: state?.alternateScreen ?? false,
      mouseTracking: state?.mouseTracking ?? false,
      cursorKeyMode: state?.cursorKeyMode ?? 'normal',
      inBandResize: false,
    };
  }

  getTerminalState(): TerminalState {
    const state = this.deps.getPtyState(this.ptyId)?.terminalState;
    if (state) {
      return { ...state };
    }

    return {
      cols: 0,
      rows: 0,
      cells: [],
      cursor: { x: 0, y: 0, visible: true },
      alternateScreen: false,
      mouseTracking: false,
      cursorKeyMode: 'normal',
      kittyKeyboardFlags: 0,
    };
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    const cursor = this.deps.getPtyState(this.ptyId)?.terminalState?.cursor;
    return cursor ? { x: cursor.x, y: cursor.y, visible: cursor.visible } : { x: 0, y: 0, visible: true };
  }

  getCursorKeyMode(): 'normal' | 'application' {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.cursorKeyMode ?? 'normal';
  }

  getKittyKeyboardFlags(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.kittyKeyboardFlags ?? 0;
  }

  getKittyImagesDirty(): boolean {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.dirty ?? false;
  }

  clearKittyImagesDirty(): void {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    if (state) {
      state.dirty = false;
      state.seedImageIds.clear();
    }
  }

  getKittyImageIds(): number[] {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    if (!state) return [];
    return Array.from(state.images.keys());
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.images.get(imageId)?.info ?? null;
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.images.get(imageId)?.data ?? null;
  }

  shouldSeedKittyImage(imageId: number): boolean {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    return state?.seedImageIds.has(imageId) ?? false;
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    const alternateScreen = this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.placements ?? [];
  }

  isMouseTrackingEnabled(): boolean {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.mouseTracking ?? false;
  }

  isAlternateScreen(): boolean {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
  }

  getMode(_mode: number): boolean {
    return false;
  }

  getColors() {
    return getHostColors() ?? getDefaultColors();
  }

  getTitle(): string {
    return this.deps.getPtyState(this.ptyId)?.title ?? '';
  }

  onTitleChange(_callback: (title: string) => void): () => void {
    return () => {};
  }

  onUpdate(_callback: () => void): () => void {
    return () => {};
  }

  onModeChange(_callback: (modes: { mouseTracking: boolean; cursorKeyMode: 'normal' | 'application'; alternateScreen: boolean; inBandResize: boolean }) => void): () => void {
    return () => {};
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return this.deps.searchPty(this.ptyId, query, options);
  }

  handleScrollbackChange(newLength: number, isAtScrollbackLimit: boolean): void {
    this.scrollbackCache.handleScrollbackChange(newLength, isAtScrollbackLimit);
  }
}
