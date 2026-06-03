/**
 * ArchivedTerminalEmulator - wraps a live emulator with a scrollback archive.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from '../core/types';
import {
  isKittyGraphicsEmulator,
  type IKittyGraphicsEmulator,
  type ITerminalEmulator,
  type SearchResult,
  type TerminalModes,
  type KittyGraphicsEmulator,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
} from './emulator-interface';
import type { TerminalColors } from './terminal-colors';
import { searchTerminal } from './ghostty-vt/terminal-search';
import { createEmptyRow } from './ghostty-emulator/cell-converter';
import type { ScrollbackArchive } from './scrollback-archive';
import type { ArchivePlacement } from './kitty-graphics/archive-placement';
import type { ScrollbackSkipMap } from './scrollback-skip-map';

/** Cache entry for archived placements */
interface PlacementCache {
  /** Archived placements adjusted for current viewport */
  placements: KittyGraphicsPlacement[];
  /** Archive length when cache was built */
  archiveLength: number;
  /** Archive content revision when cache was built */
  archiveRevision: number;
  /** Base emulator placement count when cache was built */
  basePlacementCount: number;
}

interface ArchiveSnapshotCache {
  archiveLength: number;
  archiveRevision: number;
  placements: ArchivePlacement[];
  imageIds: number[];
}

export class ArchivedTerminalEmulator implements ITerminalEmulator, IKittyGraphicsEmulator {
  /** Cache for archived placements to avoid recalculation */
  private placementCache: PlacementCache | null = null;
  /** Cache for full archived placement scans used by IDs + placements lookups */
  private archiveSnapshotCache: ArchiveSnapshotCache | null = null;
  /** Skip map for pi full-redraw duplicate scrollback ranges (optional — set after construction) */
  private _skipMap: ScrollbackSkipMap | null = null;

  constructor(
    private base: ITerminalEmulator,
    private archive: ScrollbackArchive
  ) {}

  /** Attach the skip map from the session. Called after session construction. */
  setSkipMap(skipMap: ScrollbackSkipMap): void {
    this._skipMap = skipMap;
  }

  get cols(): number {
    return this.base.cols;
  }

  get rows(): number {
    return this.base.rows;
  }

  get isDisposed(): boolean {
    return this.base.isDisposed;
  }

  write(data: string | Uint8Array): void {
    this.base.write(data);
  }

  resize(cols: number, rows: number): void {
    this.base.resize(cols, rows);
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    this.base.setPixelSize?.(widthPx, heightPx);
  }

  reset(): void {
    this.base.reset();
    this.invalidatePlacementCache();
  }

  dispose(): void {
    this.base.dispose();
    this.archive.dispose();
  }

  getScrollbackLength(): number {
    const rawLength = this.archive.length + this.base.getScrollbackLength();
    if (this._skipMap && !this._skipMap.isEmpty) {
      return this._skipMap.effectiveLength(rawLength);
    }
    return rawLength;
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    const rawOffset =
      this._skipMap && !this._skipMap.isEmpty ? this._skipMap.effectiveToRaw(offset) : offset;
    const archiveLength = this.archive.length;
    if (rawOffset < archiveLength) {
      return this.archive.getLine(rawOffset);
    }
    return this.base.getScrollbackLine(rawOffset - archiveLength);
  }

  prefetchScrollbackLines?(startOffset: number, count: number): Promise<void> {
    const rawStart =
      this._skipMap && !this._skipMap.isEmpty
        ? this._skipMap.effectiveToRaw(startOffset)
        : startOffset;
    const archiveLength = this.archive.length;
    if (rawStart < archiveLength) {
      const archiveCount = Math.min(count, archiveLength - rawStart);
      this.archive.prefetchLines(rawStart, archiveCount);
    }
    return Promise.resolve();
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    return this.base.getDirtyUpdate(scrollState);
  }

  getTerminalState(): TerminalState {
    return this.base.getTerminalState();
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return this.base.getCursor();
  }

  getCursorKeyMode(): 'normal' | 'application' {
    return this.base.getCursorKeyMode();
  }

  getKittyKeyboardFlags(): number {
    return this.base.getKittyKeyboardFlags();
  }

  isMouseTrackingEnabled(): boolean {
    return this.base.isMouseTrackingEnabled();
  }

  isAlternateScreen(): boolean {
    return this.base.isAlternateScreen();
  }

  getMode(mode: number): boolean {
    return this.base.getMode(mode);
  }

  getColors(): TerminalColors {
    return this.base.getColors();
  }

  setColors(colors: TerminalColors): void {
    this.base.setColors?.(colors);
  }

  getTitle(): string {
    return this.base.getTitle();
  }

  onTitleChange(callback: (title: string) => void): () => void {
    return this.base.onTitleChange(callback);
  }

  onUpdate(callback: () => void): () => void {
    return this.base.onUpdate(callback);
  }

  setUpdateEnabled(enabled: boolean): void {
    this.base.setUpdateEnabled?.(enabled);
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    return this.base.onModeChange(callback);
  }

  getKittyImagesDirty(): boolean {
    return this.getKittyBase()?.getKittyImagesDirty() ?? false;
  }

  clearKittyImagesDirty(): void {
    this.getKittyBase()?.clearKittyImagesDirty();
  }

  getKittyImageIds(): number[] {
    const kittyBase = this.getKittyBase();

    // Get live emulator IDs
    const baseIds = kittyBase?.getKittyImageIds() ?? [];

    // Get archived image IDs from placements
    const archivedIds = this.getArchivedImageIds();

    if (archivedIds.length === 0) {
      return baseIds;
    }

    // Merge and deduplicate
    const merged = new Set([...baseIds, ...archivedIds]);
    return Array.from(merged);
  }

  /**
   * Get unique image IDs referenced by archived placements.
   */
  private getArchivedImageIds(): number[] {
    return this.getArchiveSnapshot().imageIds;
  }

  /**
   * Read archived placements once per archive revision and reuse for
   * both image-id and placement queries.
   */
  private getArchiveSnapshot(): ArchiveSnapshotCache {
    const archiveLength = this.archive.length;
    const archiveRevision = this.archive.getRevision();

    if (
      this.archiveSnapshotCache &&
      this.archiveSnapshotCache.archiveLength === archiveLength &&
      this.archiveSnapshotCache.archiveRevision === archiveRevision
    ) {
      return this.archiveSnapshotCache;
    }

    const placements: ArchivePlacement[] =
      this.archive.getPlacementsForLineRange?.(0, archiveLength) ?? [];

    const imageIds =
      placements.length === 0
        ? []
        : Array.from(new Set(placements.map((placement) => placement.imageId)));

    const snapshot: ArchiveSnapshotCache = {
      archiveLength,
      archiveRevision,
      placements,
      imageIds,
    };
    this.archiveSnapshotCache = snapshot;
    return snapshot;
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    return this.getKittyBase()?.getKittyImageInfo(imageId) ?? null;
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    return this.getKittyBase()?.getKittyImageData(imageId) ?? null;
  }

  shouldSeedKittyImage(imageId: number): boolean {
    return this.getKittyBase()?.shouldSeedKittyImage?.(imageId) ?? false;
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    const archiveLength = this.archive.length;
    const kittyBase = this.getKittyBase();
    const skipMap = this._skipMap;
    const hasSkipMap = skipMap != null && !skipMap.isEmpty;

    // Ghostty placement coordinates from the live emulator are relative to the
    // live scrollback buffer (which excludes archived lines after trim).
    // Convert them into the wrapped emulator's absolute coordinate space by
    // shifting them down by current archive length.
    const rawBasePlacements = kittyBase?.getKittyPlacements() ?? [];
    const basePlacements =
      archiveLength > 0
        ? rawBasePlacements.map((placement) => ({
            ...placement,
            screenY: placement.screenY + archiveLength,
          }))
        : rawBasePlacements;

    // Get archived placements (already in wrapped absolute space)
    const archivedPlacements = this.getArchivedPlacements(rawBasePlacements.length);

    // Combine all placements before skip-map translation.
    let allPlacements: KittyGraphicsPlacement[];
    if (archivedPlacements.length === 0) {
      allPlacements = basePlacements;
    } else if (basePlacements.length === 0) {
      allPlacements = archivedPlacements;
    } else {
      // Merge and deduplicate by (imageId, placementId)
      const seen = new Set<string>();
      const merged: KittyGraphicsPlacement[] = [];
      for (const p of archivedPlacements) {
        const key = `${p.imageId}:${p.placementId}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(p);
        }
      }
      for (const p of basePlacements) {
        const key = `${p.imageId}:${p.placementId}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(p);
        }
      }
      allPlacements = merged;
    }

    // Translate screenY from raw space to effective space through the skip map.
    // Placements inside skip ranges (pi redraw duplicates) are filtered out.
    if (!hasSkipMap) return allPlacements;

    return allPlacements
      .map((p) => {
        const effectiveY = skipMap.rawToEffective(p.screenY);
        if (effectiveY === null) return null;
        return { ...p, screenY: effectiveY };
      })
      .filter((p): p is KittyGraphicsPlacement => p !== null);
  }

  /**
   * Get placements from the scrollback archive.
   * Adjusts screenY coordinates to account for archive offset.
   * Results are cached for performance.
   */
  private getArchivedPlacements(basePlacementCount: number): KittyGraphicsPlacement[] {
    const archiveLength = this.archive.length;
    const archiveRevision = this.archive.getRevision();

    // Check if we can use cached placements
    if (this.placementCache) {
      if (
        this.placementCache.archiveLength === archiveLength &&
        this.placementCache.archiveRevision === archiveRevision &&
        this.placementCache.basePlacementCount === basePlacementCount
      ) {
        return this.placementCache.placements;
      }
    }

    // Reuse revision-scoped archived placement snapshot.
    const archivePlacements = this.getArchiveSnapshot().placements;

    if (archivePlacements.length === 0) {
      this.placementCache = {
        placements: [],
        archiveLength,
        archiveRevision,
        basePlacementCount,
      };
      return [];
    }

    // Return archived placements with screenY = archiveOffset (absolute line position)
    // The geometry calculation handles the transformation:
    // viewportRow = screenY - (scrollbackLength - viewportOffset)
    const adjustedPlacements: KittyGraphicsPlacement[] = archivePlacements.map((p) => ({
      ...p,
      screenY: p.archiveOffset,
    }));

    this.placementCache = {
      placements: adjustedPlacements,
      archiveLength,
      archiveRevision,
      basePlacementCount,
    };

    return adjustedPlacements;
  }

  private getKittyBase(): KittyGraphicsEmulator | null {
    return isKittyGraphicsEmulator(this.base) ? this.base : null;
  }

  /**
   * Invalidate the placement cache.
   * Called when archive is reset or when we need to force recalculation.
   */
  private invalidatePlacementCache(): void {
    this.placementCache = null;
    this.archiveSnapshotCache = null;
  }

  drainResponses(): string[] {
    return this.base.drainResponses?.() ?? [];
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    const skipMap = this._skipMap;
    return searchTerminal(query, options, {
      getScrollbackLength: () => this.getScrollbackLength(),
      getScrollbackLine: (offset) => this.getScrollbackLine(offset),
      getTerminalState: () => this.getTerminalState(),
      createEmptyRow: (cols) => createEmptyRow(cols, this.getColors()),
      rawToEffective:
        skipMap && !skipMap.isEmpty
          ? (rawOffset: number) => skipMap.rawToEffective(rawOffset)
          : undefined,
    });
  }
}
