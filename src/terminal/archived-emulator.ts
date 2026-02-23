/**
 * ArchivedTerminalEmulator - wraps a live emulator with a scrollback archive.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from "../core/types"
import type {
  ITerminalEmulator,
  SearchResult,
  TerminalModes,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from "./emulator-interface"
import type { TerminalColors } from "./terminal-colors"
import { searchTerminal } from "./ghostty-vt/terminal-search"
import { createEmptyRow } from "./ghostty-emulator/cell-converter"
import type { ScrollbackArchive } from "./scrollback-archive"
import type { ArchivePlacement } from "./kitty-graphics/archive-placement"

/** Cache entry for archived placements */
interface PlacementCache {
  /** Archived placements adjusted for current viewport */
  placements: KittyGraphicsPlacement[]
  /** Archive length when cache was built */
  archiveLength: number
  /** Base emulator placement count when cache was built */
  basePlacementCount: number
}

export class ArchivedTerminalEmulator implements ITerminalEmulator {
  /** Cache for archived placements to avoid recalculation */
  private placementCache: PlacementCache | null = null

  constructor(
    private base: ITerminalEmulator,
    private archive: ScrollbackArchive
  ) {}

  get cols(): number {
    return this.base.cols
  }

  get rows(): number {
    return this.base.rows
  }

  get isDisposed(): boolean {
    return this.base.isDisposed
  }

  write(data: string | Uint8Array): void {
    this.base.write(data)
  }

  resize(cols: number, rows: number): void {
    this.base.resize(cols, rows)
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    this.base.setPixelSize?.(widthPx, heightPx)
  }

  reset(): void {
    this.base.reset()
    this.invalidatePlacementCache()
  }

  dispose(): void {
    this.base.dispose()
    this.archive.dispose()
  }

  getScrollbackLength(): number {
    return this.archive.length + this.base.getScrollbackLength()
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    const archiveLength = this.archive.length
    if (offset < archiveLength) {
      return this.archive.getLine(offset)
    }
    return this.base.getScrollbackLine(offset - archiveLength)
  }

  prefetchScrollbackLines?(startOffset: number, count: number): Promise<void> {
    const archiveLength = this.archive.length
    if (startOffset < archiveLength) {
      const archiveCount = Math.min(count, archiveLength - startOffset)
      this.archive.prefetchLines(startOffset, archiveCount)
    }
    return Promise.resolve()
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    return this.base.getDirtyUpdate(scrollState)
  }

  getTerminalState(): TerminalState {
    return this.base.getTerminalState()
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return this.base.getCursor()
  }

  getCursorKeyMode(): "normal" | "application" {
    return this.base.getCursorKeyMode()
  }

  getKittyKeyboardFlags(): number {
    return this.base.getKittyKeyboardFlags()
  }

  isMouseTrackingEnabled(): boolean {
    return this.base.isMouseTrackingEnabled()
  }

  isAlternateScreen(): boolean {
    return this.base.isAlternateScreen()
  }

  getMode(mode: number): boolean {
    return this.base.getMode(mode)
  }

  getColors(): TerminalColors {
    return this.base.getColors()
  }

  setColors(colors: TerminalColors): void {
    this.base.setColors?.(colors)
  }

  getTitle(): string {
    return this.base.getTitle()
  }

  onTitleChange(callback: (title: string) => void): () => void {
    return this.base.onTitleChange(callback)
  }

  onUpdate(callback: () => void): () => void {
    return this.base.onUpdate(callback)
  }

  setUpdateEnabled(enabled: boolean): void {
    this.base.setUpdateEnabled?.(enabled)
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    return this.base.onModeChange(callback)
  }

  getKittyImagesDirty(): boolean {
    return this.base.getKittyImagesDirty?.() ?? false
  }

  clearKittyImagesDirty(): void {
    this.base.clearKittyImagesDirty?.()
  }

  getKittyImageIds(): number[] {
    return this.base.getKittyImageIds?.() ?? []
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    return this.base.getKittyImageInfo?.(imageId) ?? null
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    return this.base.getKittyImageData?.(imageId) ?? null
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    // Get base emulator placements
    const basePlacements = this.base.getKittyPlacements?.() ?? []

    // Get archived placements
    const archivedPlacements = this.getArchivedPlacements(basePlacements.length)

    if (archivedPlacements.length === 0) {
      return basePlacements
    }

    if (basePlacements.length === 0) {
      return archivedPlacements
    }

    // Merge and deduplicate by (imageId, placementId)
    const seen = new Set<string>()
    const merged: KittyGraphicsPlacement[] = []

    // Add archived placements first (they're "behind" live ones)
    for (const p of archivedPlacements) {
      const key = `${p.imageId}:${p.placementId}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(p)
      }
    }

    // Add base placements
    for (const p of basePlacements) {
      const key = `${p.imageId}:${p.placementId}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(p)
      }
    }

    return merged
  }

  /**
   * Get placements from the scrollback archive.
   * Adjusts screenY coordinates to account for archive offset.
   * Results are cached for performance.
   */
  private getArchivedPlacements(basePlacementCount: number): KittyGraphicsPlacement[] {
    // Check if we can use cached placements
    if (this.placementCache) {
      const archiveLength = this.archive.length
      if (
        this.placementCache.archiveLength === archiveLength &&
        this.placementCache.basePlacementCount === basePlacementCount
      ) {
        return this.placementCache.placements
      }
    }

    // Get placements from archive
    // Note: getPlacementsForLineRange will be added by task-2
    // For now, we handle the case where the method doesn't exist
    const archivePlacements: ArchivePlacement[] =
      (this.archive as unknown as { getPlacementsForLineRange?(start: number, end: number): ArchivePlacement[] })
        .getPlacementsForLineRange?.(0, this.archive.length) ?? []

    if (archivePlacements.length === 0) {
      this.placementCache = {
        placements: [],
        archiveLength: this.archive.length,
        basePlacementCount,
      }
      return []
    }

    // Adjust screenY coordinates: archived lines are now at negative screen positions
    // screenY = -(archiveLength - archiveOffset) when visible at top of scrollback
    // For rendering purposes, we need to map to the visible coordinate space
    const archiveLength = this.archive.length
    const adjustedPlacements: KittyGraphicsPlacement[] = archivePlacements.map((p) => ({
      ...p,
      // Map archive offset to screen coordinate
      // When viewing scrollback, line at archive offset N appears at screenY = -(archiveLength - N)
      screenY: p.archiveOffset - archiveLength,
    }))

    this.placementCache = {
      placements: adjustedPlacements,
      archiveLength,
      basePlacementCount,
    }

    return adjustedPlacements
  }

  /**
   * Invalidate the placement cache.
   * Called when archive is reset or when we need to force recalculation.
   */
  private invalidatePlacementCache(): void {
    this.placementCache = null
  }

  drainResponses(): string[] {
    return this.base.drainResponses?.() ?? []
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return searchTerminal(query, options, {
      getScrollbackLength: () => this.getScrollbackLength(),
      getScrollbackLine: (offset) => this.getScrollbackLine(offset),
      getTerminalState: () => this.getTerminalState(),
      createEmptyRow: (cols) => createEmptyRow(cols, this.getColors()),
    })
  }
}
