import type { TerminalCell, TerminalState, TerminalScrollState } from '../../core/types';
import type {
  IKittyGraphicsEmulator,
  SearchResult,
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../../terminal/emulator-interface';
import { getDefaultColors, getHostColors } from '../../terminal/terminal-colors';
import { ScrollbackCache } from '../../terminal/emulator-utils/scrollback-cache';
import type { KittyGraphicsState } from './state';

/** Dependencies for RemoteEmulator */
export type RemoteEmulatorDeps = {
  getPtyState: (ptyId: string) =>
    | {
        terminalState: TerminalState | null;
        scrollState: TerminalScrollState;
        title: string;
      }
    | undefined;
  getKittyState: (ptyId: string, alternateScreen?: boolean) => KittyGraphicsState | undefined;
  fetchScrollbackLines: (
    ptyId: string,
    startOffset: number,
    count: number
  ) => Promise<Map<number, TerminalCell[]>>;
  searchPty: (ptyId: string, query: string, options?: { limit?: number }) => Promise<SearchResult>;
};

/**
 * Remote emulator implementation that proxies to the shim server.
 * Provides ITerminalEmulator interface backed by shim server state.
 */
export class RemoteEmulator implements ITerminalEmulator, IKittyGraphicsEmulator {
  private ptyId: string;
  private deps: RemoteEmulatorDeps;
  private scrollbackCache = new ScrollbackCache(2000);
  private disposed = false;

  /**
   * Creates a remote emulator for the given PTY.
   * @param ptyId - PTY identifier
   * @param deps - Dependencies for accessing PTY state
   */
  constructor(ptyId: string, deps: RemoteEmulatorDeps) {
    this.ptyId = ptyId;
    this.deps = deps;
  }

  /** Number of terminal columns */
  get cols(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.cols ?? 0;
  }

  /** Number of terminal rows */
  get rows(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.rows ?? 0;
  }

  /** Whether the emulator has been disposed */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Writes data to the terminal.
   * No-op for remote emulator - writes go through PTY service.
   */
  write(_data: string | Uint8Array): void {
    // Writes should go through the PTY service, not emulator.
  }

  /**
   * Resizes the terminal.
   * No-op for remote emulator - resizes go through PTY service.
   */
  resize(_cols: number, _rows: number): void {
    // Resizes should go through the PTY service, not emulator.
  }

  /** Resets the terminal state. No-op for remote emulator. */
  reset(): void {
    // No-op for remote emulator.
  }

  /** Disposes the emulator and clears caches. */
  dispose(): void {
    this.disposed = true;
    this.scrollbackCache.clear();
  }

  /** Gets the scrollback buffer length. */
  getScrollbackLength(): number {
    return this.deps.getPtyState(this.ptyId)?.scrollState.scrollbackLength ?? 0;
  }

  /**
   * Gets a scrollback line from the cache.
   * @param offset - Line offset in scrollback buffer
   * @returns Terminal cells for the line, or null if not cached
   */
  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.scrollbackCache.get(offset);
  }

  /**
   * Prefetches scrollback lines into the cache.
   * @param startOffset - Starting line offset
   * @param count - Number of lines to fetch
   */
  async prefetchScrollbackLines(startOffset: number, count: number): Promise<void> {
    const lines = await this.deps.fetchScrollbackLines(this.ptyId, startOffset, count);
    this.scrollbackCache.setMany(lines);
  }

  /**
   * Gets the dirty update for rendering.
   * @param scrollState - Current scroll state
   * @returns Dirty update with cursor, dimensions, and state flags
   */
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

  /**
   * Gets the full terminal state.
   * @returns Terminal state or empty state if not available
   */
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

  /**
   * Gets the current cursor position and visibility.
   * @returns Cursor state
   */
  getCursor(): { x: number; y: number; visible: boolean } {
    const cursor = this.deps.getPtyState(this.ptyId)?.terminalState?.cursor;
    return cursor
      ? { x: cursor.x, y: cursor.y, visible: cursor.visible }
      : { x: 0, y: 0, visible: true };
  }

  /**
   * Gets the cursor key mode.
   * @returns 'normal' or 'application' cursor key mode
   */
  getCursorKeyMode(): 'normal' | 'application' {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.cursorKeyMode ?? 'normal';
  }

  /**
   * Gets Kitty keyboard protocol flags.
   * @returns Keyboard flags bitmask
   */
  getKittyKeyboardFlags(): number {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.kittyKeyboardFlags ?? 0;
  }

  /**
   * Checks if Kitty graphics state is dirty.
   * @returns true if graphics need redraw
   */
  getKittyImagesDirty(): boolean {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.dirty ?? false;
  }

  /** Clears the Kitty graphics dirty flag. */
  clearKittyImagesDirty(): void {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    if (state) {
      state.dirty = false;
      state.seedImageIds.clear();
    }
  }

  /**
   * Gets all active Kitty image IDs.
   * @returns Array of image IDs
   */
  getKittyImageIds(): number[] {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    if (!state) return [];
    return Array.from(state.images.keys());
  }

  /**
   * Gets metadata for a Kitty image.
   * @param imageId - Image ID
   * @returns Image info or null
   */
  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.images.get(imageId)?.info ?? null;
  }

  /**
   * Gets the raw data for a Kitty image.
   * @param imageId - Image ID
   * @returns Image data or null
   */
  getKittyImageData(imageId: number): Uint8Array | null {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.images.get(imageId)?.data ?? null;
  }

  /**
   * Checks if an image was received in the current update batch.
   * @param imageId - Image ID
   * @returns true if image should be seeded to renderer
   */
  shouldSeedKittyImage(imageId: number): boolean {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    const state = this.deps.getKittyState(this.ptyId, alternateScreen);
    return state?.seedImageIds.has(imageId) ?? false;
  }

  /**
   * Gets all active Kitty image placements.
   * @returns Array of placement configurations
   */
  getKittyPlacements(): KittyGraphicsPlacement[] {
    const alternateScreen =
      this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
    return this.deps.getKittyState(this.ptyId, alternateScreen)?.placements ?? [];
  }

  /**
   * Checks if mouse tracking is enabled.
   * @returns true if mouse events are tracked
   */
  isMouseTrackingEnabled(): boolean {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.mouseTracking ?? false;
  }

  /**
   * Checks if the terminal is in alternate screen mode.
   * @returns true if using alternate screen buffer
   */
  isAlternateScreen(): boolean {
    return this.deps.getPtyState(this.ptyId)?.terminalState?.alternateScreen ?? false;
  }

  /**
   * Gets a terminal mode flag.
   * @param _mode - Mode number to check
   * @returns false - not implemented for remote emulator
   */
  getMode(_mode: number): boolean {
    return false;
  }

  /**
   * Gets the terminal color configuration.
   * @returns Current or default color scheme
   */
  getColors() {
    return getHostColors() ?? getDefaultColors();
  }

  /**
   * Gets the terminal title.
   * @returns Current title or empty string
   */
  getTitle(): string {
    return this.deps.getPtyState(this.ptyId)?.title ?? '';
  }

  /**
   * Registers a title change callback.
   * No-op for remote emulator - use subscribeToTitle instead.
   * @returns No-op cleanup function
   */
  onTitleChange(_callback: (title: string) => void): () => void {
    return () => {};
  }

  /**
   * Registers an update callback.
   * No-op for remote emulator - use subscribeUnified instead.
   * @returns No-op cleanup function
   */
  onUpdate(_callback: () => void): () => void {
    return () => {};
  }

  /**
   * Registers a mode change callback.
   * No-op for remote emulator.
   * @returns No-op cleanup function
   */
  onModeChange(
    _callback: (modes: {
      mouseTracking: boolean;
      cursorKeyMode: 'normal' | 'application';
      alternateScreen: boolean;
      inBandResize: boolean;
    }) => void
  ): () => void {
    return () => {};
  }

  /**
   * Searches the terminal buffer.
   * @param query - Search string
   * @param options - Search options including limit
   * @returns Search results with matches
   */
  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return this.deps.searchPty(this.ptyId, query, options);
  }

  /**
   * Notifies the emulator of scrollback buffer changes.
   * Updates the scrollback cache accordingly.
   * @param newLength - New scrollback buffer length
   * @param isAtScrollbackLimit - Whether at scrollback limit
   */
  handleScrollbackChange(newLength: number, isAtScrollbackLimit: boolean): void {
    this.scrollbackCache.handleScrollbackChange(newLength, isAtScrollbackLimit);
  }
}
