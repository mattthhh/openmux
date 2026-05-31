/**
 * GhosttyVTEmulatorCore - base implementation backed by native libghostty-vt.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from '../../core/types';
import type { SearchResult, TerminalModes } from '../emulator-interface';
import { areTerminalColorsEqual, type TerminalColors } from '../terminal-colors';
import { createTitleParser } from '../title-parser';
import { stripProblematicOscSequences } from './osc-stripping';
import { GhosttyVtTerminal } from './terminal';
import { createEmptyRow } from '../ghostty-emulator/cell-converter';
import {
  ScrollbackCache,
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from '../emulator-utils';
import { getModes } from './utils';
import { searchTerminal } from './terminal-search';
import { fetchScrollbackLine } from './scrollback';
import { getCursorSnapshot } from './cursor';
import { prepareEmulatorUpdate } from './emulator-updates';
import { deferNextTick } from '../../core/scheduling';
import { HOT_SCROLLBACK_LIMIT } from '../scrollback-config';
import {
  applyColorRemapToRow,
  buildColorRemap,
  buildOscColorSequence,
  cloneColors,
} from './color-utils';

const SCROLLBACK_LIMIT = HOT_SCROLLBACK_LIMIT;

export class GhosttyVTEmulatorCore {
  protected terminal: GhosttyVtTerminal;
  private _cols: number;
  private _rows: number;
  protected _disposed = false;
  private colors: TerminalColors;
  private baseColors: TerminalColors;
  private colorRemap: Map<number, number> | null = null;
  private modes: TerminalModes = createDefaultModes();
  private scrollState: TerminalScrollState = createDefaultScrollState();

  private cachedState: TerminalState | null = null;
  private pendingUpdate: DirtyTerminalUpdate | null = null;

  private titleParser: ReturnType<typeof createTitleParser>;
  private currentTitle = '';
  private titleCallbacks = new Set<(title: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private modeChangeCallbacks = new Set<
    (modes: TerminalModes, prevModes?: TerminalModes) => void
  >();
  private updatesEnabled = true;
  private needsFullRefresh = false;

  // Deferred notification: write() parses VT data immediately but defers
  // prepareUpdate + subscriber notification to a coalesced macrotask.
  // Multiple writes within the same event loop tick are merged into
  // a single prepareUpdate + notification, eliminating redundant cell
  // conversion work under heavy output (e.g. bun test --parallel).
  private _writeDirty = false;
  private _notifyScheduled = false;
  private _notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastNotifyTime = 0;
  private static readonly _MIN_NOTIFY_INTERVAL_MS = 16;

  private scrollbackCache = new ScrollbackCache(1000);
  private scrollbackSnapshotDirty = true;
  private decoder = new TextDecoder();

  constructor(cols: number, rows: number, colors: TerminalColors) {
    this._cols = cols;
    this._rows = rows;
    this.colors = cloneColors(colors);
    this.baseColors = cloneColors(colors);

    const palette = this.colors.palette.slice(0, 16);
    this.terminal = new GhosttyVtTerminal(cols, rows, {
      scrollbackLimit: 0,
      fgColor: this.colors.foreground,
      bgColor: this.colors.background,
      palette,
    });

    this.titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        this.currentTitle = title;
        for (const callback of this.titleCallbacks) {
          callback(title);
        }
      },
    });

    // Clear terminal state to avoid stale memory artifacts.
    this.terminal.write('\x1b[2J\x1b[H');
    this.terminal.update();
    this.terminal.markClean();

    this.modes = getModes(this.terminal);
    this.prepareUpdate(true);
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  write(data: string | Uint8Array): void {
    if (this._disposed) return;

    const text = typeof data === 'string' ? data : this.decoder.decode(data);
    if (text.length === 0) return;

    this.titleParser.processData(text);
    const stripped = stripProblematicOscSequences(text);
    if (stripped.length === 0) return;

    this.scrollbackSnapshotDirty = true;
    // Parse VT data into the native terminal state immediately.
    this.terminal.write(stripped);

    if (!this.updatesEnabled) {
      // When updates are disabled, skip the expensive prepareUpdate (cell
      // conversion). needsFullRefresh=true forces a full update when the
      // PTY becomes visible again. cancelDeferredNotify was already called
      // by setUpdateEnabled(false), so _writeDirty is guaranteed false.
      this.needsFullRefresh = true;
      return;
    }

    // Mark as dirty so the deferred notification knows to prepareUpdate.
    this._writeDirty = true;

    // Defer prepareUpdate + subscriber notification to a coalesced macrotask.
    // Multiple writes within the same event loop tick are merged into a
    // single prepareUpdate call, eliminating redundant cell conversion work.
    this.scheduleDeferredNotify();
  }

  resize(cols: number, rows: number): void {
    if (this._disposed) return;
    if (cols === this._cols && rows === this._rows) return;

    this._cols = cols;
    this._rows = rows;
    this.scrollbackSnapshotDirty = true;
    this.terminal.resize(cols, rows);
    // Cancel any pending write notification — resize handles its own.
    this.cancelDeferredNotify();
    if (!this.updatesEnabled) {
      this.needsFullRefresh = true;
      return;
    }
    // Defer prepareUpdate to next tick to ensure native reflow completes
    deferNextTick(() => {
      if (this._disposed) return;
      this.prepareUpdate(true);
      for (const callback of this.updateCallbacks) {
        callback();
      }
    });
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    if (this._disposed) return;
    this.terminal.setPixelSize(widthPx, heightPx);
  }

  reset(): void {
    if (this._disposed) return;
    this.terminal.write('\x1bc');
    this.currentTitle = '';
    this.scrollbackCache.clear();
    this.scrollbackSnapshotDirty = true;
    this.cancelDeferredNotify();
    if (!this.updatesEnabled) {
      this.needsFullRefresh = true;
      return;
    }
    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.cancelDeferredNotify();
    this.terminal.free();

    this.cachedState = null;
    this.pendingUpdate = null;
    this.titleCallbacks.clear();
    this.updateCallbacks.clear();
    this.modeChangeCallbacks.clear();
    this.scrollbackCache.clear();
  }

  getScrollbackLength(): number {
    return this.terminal.getScrollbackLength();
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.fetchScrollbackLine(offset);
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    this.scrollState = scrollState;

    // If writes are pending, flush them now so the update reflects
    // the latest VT state. This can happen when getDirtyUpdate is called
    // from notifySubscribers before the deferred notification fires.
    if (this._writeDirty) {
      this._writeDirty = false;
      this.prepareUpdate(false);
    }

    if (this.pendingUpdate) {
      const mergedScrollState: TerminalScrollState = {
        ...scrollState,
        isAtScrollbackLimit: this.pendingUpdate.scrollState.isAtScrollbackLimit,
      };
      const update = {
        ...this.pendingUpdate,
        scrollState: mergedScrollState,
      };
      this.pendingUpdate = null;
      return update;
    }

    return createEmptyDirtyUpdate(
      this._cols,
      this._rows,
      scrollState,
      this.modes,
      this.cachedState?.cursor
    );
  }

  trimScrollback(lines: number): void {
    if (this._disposed) return;
    if (lines <= 0) return;
    this.terminal.trimScrollback(lines);
    this.scrollbackCache.clear();
    this.scrollbackSnapshotDirty = true;
    this.scrollState = {
      ...this.scrollState,
      scrollbackLength: this.terminal.getScrollbackLength(),
    };
  }

  eraseScrollbackTail(lines: number): void {
    if (this._disposed) return;
    if (lines <= 0) return;
    this.terminal.eraseScrollbackTail(lines);
    this.scrollbackCache.clear();
    this.scrollbackSnapshotDirty = true;
    this.scrollState = {
      ...this.scrollState,
      scrollbackLength: this.terminal.getScrollbackLength(),
    };
  }

  getTerminalState(): TerminalState {
    if (this._disposed) {
      if (this.cachedState) {
        return { ...(this.cachedState as TerminalState) };
      }
      return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
    }

    // Flush any pending writes so the returned state is current.
    // This is called for search, selection, and other operations that
    // need to read the terminal state outside the normal render cycle.
    if (this._writeDirty) {
      this._writeDirty = false;
      this.prepareUpdate(false);
    }

    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    this.prepareUpdate(true);
    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return getCursorSnapshot({
      disposed: this._disposed,
      cachedState: this.cachedState,
      terminal: this.terminal,
    });
  }

  getCursorKeyMode(): 'normal' | 'application' {
    return this.modes.cursorKeyMode;
  }

  isMouseTrackingEnabled(): boolean {
    return this.modes.mouseTracking;
  }

  isAlternateScreen(): boolean {
    return this.modes.alternateScreen;
  }

  getMode(mode: number): boolean {
    if (this._disposed) return false;
    return this.terminal.getMode(mode, false);
  }

  getColors(): TerminalColors {
    return this.colors;
  }

  setColors(colors: TerminalColors): void {
    if (this._disposed) return;
    if (areTerminalColorsEqual(this.colors, colors)) return;

    this.colors = cloneColors(colors);
    this.scrollbackSnapshotDirty = true;
    this.scrollbackCache.clear();
    this.cancelDeferredNotify();

    const oscSequence = buildOscColorSequence(colors);
    if (oscSequence) {
      this.terminal.write(oscSequence);
    }

    this.terminal.update();
    this.refreshColorRemap(colors);

    if (!this.updatesEnabled) {
      this.needsFullRefresh = true;
      return;
    }

    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  getTitle(): string {
    return this.currentTitle;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleCallbacks.add(callback);
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    // If there's already a prepared update, fire immediately.
    // If there are pending writes (not yet prepareUpdated), flush
    // them so the callback sees the current state.
    if (this._writeDirty) {
      this.flushDeferredNotify();
    } else if (this.pendingUpdate) {
      callback();
    }
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  setUpdateEnabled(enabled: boolean): void {
    if (this.updatesEnabled === enabled) return;
    this.updatesEnabled = enabled;

    if (!enabled) {
      this.needsFullRefresh = true;
      this.pendingUpdate = null;
      this.cancelDeferredNotify();
      return;
    }

    if (this.needsFullRefresh || !this.cachedState) {
      this.prepareUpdate(true);
    }
    this.needsFullRefresh = false;

    if (this.pendingUpdate) {
      for (const callback of this.updateCallbacks) {
        callback();
      }
    }
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => {
      this.modeChangeCallbacks.delete(callback);
    };
  }

  refresh(): void {
    if (this._disposed) return;
    // Invalidate cached state and force a fresh update
    this.cachedState = null;
    this.pendingUpdate = null;
    this.scrollbackCache.clear();
    this.scrollbackSnapshotDirty = true;
    this.cancelDeferredNotify();
    if (this.updatesEnabled) {
      this.prepareUpdate(true);
      for (const callback of this.updateCallbacks) {
        callback();
      }
    } else {
      this.needsFullRefresh = true;
    }
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return searchTerminal(query, options, {
      getScrollbackLength: () => this.terminal.getScrollbackLength(),
      getScrollbackLine: (offset) => this.fetchScrollbackLine(offset),
      getTerminalState: () => this.getTerminalState(),
      createEmptyRow: (cols) => createEmptyRow(cols, this.colors),
    });
  }

  private fetchScrollbackLine(offset: number): TerminalCell[] | null {
    if (this._disposed) return null;
    const line = fetchScrollbackLine({
      terminal: this.terminal,
      offset,
      cols: this._cols,
      colors: this.colors,
      cache: this.scrollbackCache,
      snapshotDirty: this.scrollbackSnapshotDirty,
      setSnapshotDirty: (value) => {
        this.scrollbackSnapshotDirty = value;
      },
    });
    if (line && this.colorRemap) {
      applyColorRemapToRow(line, this.colorRemap);
    }
    return line;
  }

  /**
   * Schedule a deferred prepareUpdate + subscriber notification.
   * Uses rate-limited setTimeout to cap notification frequency at ~60fps.
   * After a quiet period, the delay is 0ms (immediate); for consecutive
   * notifications, a minimum 16ms gap is enforced so the main thread is
   * not saturated by prepareUpdate + render under heavy output.
   * Multiple writes within the same interval are coalesced since
   * _notifyScheduled prevents duplicate scheduling.
   */
  private scheduleDeferredNotify(): void {
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const sinceLast = now - this._lastNotifyTime;
    const delay =
      sinceLast < GhosttyVTEmulatorCore._MIN_NOTIFY_INTERVAL_MS
        ? GhosttyVTEmulatorCore._MIN_NOTIFY_INTERVAL_MS - sinceLast
        : 0;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      this._lastNotifyTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (this._disposed) return;
      this._notifyScheduled = false;
      // Only flush if writes are still dirty (they may have been flushed
      // by getDirtyUpdate/getTerminalState called before this timer fires).
      // If writes were flushed but subscribers haven't been notified, deliver
      // the pendingUpdate now.
      if (this._writeDirty) {
        this.flushDeferredNotify();
      } else if (this.pendingUpdate) {
        // Writes were flushed by an eager reader (getDirtyUpdate), but
        // subscribers haven't been notified. Deliver the update now.
        for (const callback of this.updateCallbacks) {
          callback();
        }
      }
    }, delay);
  }

  /**
   * Cancel any pending deferred notification and clear dirty flags.
   * Used by operations that handle their own notification (resize, reset,
   * setColors, refresh, setUpdateEnabled, dispose).
   */
  private cancelDeferredNotify(): void {
    this._writeDirty = false;
    this._notifyScheduled = false;
    if (this._notifyTimer !== null) {
      clearTimeout(this._notifyTimer);
      this._notifyTimer = null;
    }
  }

  /**
   * Flush all pending writes: prepareUpdate + notify subscribers.
   * Called from the deferred queueMicrotask, or eagerly when a caller
   * needs the update to be available immediately (e.g. getTerminalState,
   * getDirtyUpdate with stale state, force-kitty-drain).
   */
  private flushDeferredNotify(): void {
    if (!this._writeDirty) return;
    this._writeDirty = false;
    this.prepareUpdate(false);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  private prepareUpdate(forceFull: boolean): void {
    if (this._disposed) return;
    const result = prepareEmulatorUpdate({
      terminal: this.terminal,
      layout: {
        cols: this._cols,
        rows: this._rows,
        scrollbackLimit: SCROLLBACK_LIMIT,
      },
      colors: this.colors,
      state: {
        cachedState: this.cachedState,
        modes: this.modes,
        scrollState: this.scrollState,
        forceFull,
      },
      scrollbackCache: this.scrollbackCache,
    });

    this.cachedState = result.cachedState;
    this.pendingUpdate = result.pendingUpdate;
    this.scrollState = result.scrollState;
    this.scrollbackSnapshotDirty = false;
    this.applyColorRemapToPendingUpdate();

    if (
      result.prevModes.mouseTracking !== result.modes.mouseTracking ||
      result.prevModes.cursorKeyMode !== result.modes.cursorKeyMode ||
      result.prevModes.alternateScreen !== result.modes.alternateScreen ||
      result.prevModes.inBandResize !== result.modes.inBandResize
    ) {
      this.modes = result.modes;
      for (const callback of this.modeChangeCallbacks) {
        callback(result.modes, result.prevModes);
      }
    } else {
      this.modes = result.modes;
    }
  }

  private refreshColorRemap(colors: TerminalColors): void {
    const native = this.terminal.getColors();
    const nativeMatches =
      native.foreground === colors.foreground && native.background === colors.background;

    if (nativeMatches) {
      this.baseColors = cloneColors(colors);
      this.colorRemap = null;
      return;
    }
    this.colorRemap = buildColorRemap(this.baseColors, colors);
  }

  private applyColorRemapToPendingUpdate(): void {
    const remap = this.colorRemap;
    const pending = this.pendingUpdate;
    if (!remap || !pending) return;

    if (pending.fullState) {
      for (const row of pending.fullState.cells) {
        applyColorRemapToRow(row, remap);
      }
      return;
    }

    if (pending.dirtyRows.size > 0) {
      for (const row of pending.dirtyRows.values()) {
        applyColorRemapToRow(row, remap);
      }
    }
  }
}
