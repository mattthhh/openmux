/**
 * Scrollback archiver - spills live scrollback into a disk archive.
 * (errore version - unchanged from original)
 */
import type { InternalPtySession } from "./types"
import type { ITerminalEmulator, KittyGraphicsPlacement } from "../../../terminal/emulator-interface"
import type { TerminalCell } from "../../../core/types"
import type { ArchivePlacement } from "../../../terminal/scrollback-archive"
import { HOT_SCROLLBACK_LIMIT } from "../../../terminal/scrollback-config"
import { deferMacrotask } from "../../../core/scheduling"

const ARCHIVE_BATCH_LINES = 256
const MAX_BATCHES_PER_RUN = 4

export class ScrollbackArchiver {
  private scheduled = false
  private running = false
  private pending = false

  constructor(
    private session: InternalPtySession,
    private liveEmulator: ITerminalEmulator
  ) {}

  schedule(): void {
    if (this.scheduled) {
      this.pending = true
      return
    }
    this.scheduled = true
    deferMacrotask(() => {
      void this.run()
    })
  }

  reset(): void {
    this.pending = false
    this.scheduled = false
  }

  private async run(): Promise<void> {
    this.scheduled = false
    if (this.running) {
      this.pending = true
      return
    }

    this.running = true
    try {
      if (this.liveEmulator.isDisposed) return
      if (this.liveEmulator.isAlternateScreen()) return

      let batches = 0
      while (batches < MAX_BATCHES_PER_RUN) {
        const overflow = this.liveEmulator.getScrollbackLength() - HOT_SCROLLBACK_LIMIT
        if (overflow <= 0) break

        const batchSize = Math.min(overflow, ARCHIVE_BATCH_LINES)

        // Get current archive offset before appending
        const archiveStartOffset = this.session.scrollbackArchive.length

        // Capture lines first (before trimScrollback removes them from live emulator)
        const lines = this.captureLines(batchSize)
        if (lines.length === 0) break

        // Capture placements BEFORE calling trimScrollback() - this is critical
        // because trimScrollback() marks placements on pruned lines as garbage
        const placements = this.capturePlacements(lines.length, archiveStartOffset)

        // Store lines and placements in archive
        await this.session.scrollbackArchive.appendLines(lines)
        
        // Store placements separately (ScrollbackArchive has dedicated method)
        if (placements.length > 0) {
          await this.session.scrollbackArchive.appendPlacements(placements)
        }

        // Now safe to trim - placements have been captured
        if ("trimScrollback" in this.liveEmulator) {
          const trimmer = this.liveEmulator as ITerminalEmulator & {
            trimScrollback?: (lines: number) => void
          }
          trimmer.trimScrollback?.(lines.length)
        } else {
          break
        }

        batches += 1
      }
      if (this.liveEmulator.getScrollbackLength() > HOT_SCROLLBACK_LIMIT) {
        this.pending = true
      }
    } catch {
      // Best-effort: ignore archive errors to avoid blocking PTY flow.
    } finally {
      this.running = false
      if (this.pending) {
        this.pending = false
        this.schedule()
      }
    }
  }

  private captureLines(count: number): TerminalCell[][] {
    const lines: TerminalCell[][] = []
    for (let i = 0; i < count; i++) {
      const line = this.liveEmulator.getScrollbackLine(i)
      if (!line) break
      lines.push(line)
    }
    return lines
  }

  /**
   * Capture Kitty placements that overlap with the lines being archived.
   * This must be called BEFORE trimScrollback() to avoid losing placement data.
   *
   * @param linesArchived - Number of lines being archived (from top of scrollback)
   * @param archiveStartOffset - Current archive line count (where these lines will be stored)
   * @returns Array of ArchivePlacement with adjusted coordinates
   */
  private capturePlacements(
    linesArchived: number,
    archiveStartOffset: number
  ): ArchivePlacement[] {
    // Graceful no-op if emulator doesn't support Kitty graphics
    if (!this.liveEmulator.getKittyPlacements) {
      return []
    }

    const placements = this.liveEmulator.getKittyPlacements()
    if (!placements || placements.length === 0) {
      return []
    }

    const archivedPlacements: ArchivePlacement[] = []

    for (const placement of placements) {
      // Ghostty reports placement.screenY in active-screen coordinates where:
      //   0 = oldest history line in the live emulator
      //   scrollbackLength = first visible row
      // We archive the oldest [0, linesArchived) history range.
      const placementStartY = placement.screenY
      const placementRows = Math.max(1, placement.rows)
      const placementEndYExclusive = placementStartY + placementRows

      // Keep placements whose vertical span intersects the pruned history range.
      if (placementEndYExclusive <= 0 || placementStartY >= linesArchived) {
        continue
      }

      const archiveLine = Math.max(0, placementStartY)
      const archivePlacement: ArchivePlacement = {
        ...placement,
        // archiveOffset: absolute line index in persisted archive
        archiveOffset: archiveStartOffset + archiveLine,
        // Preserve original coordinate from live emulator for debugging/migration.
        originalScreenY: placement.screenY,
        // Stored as archive-relative absolute (0 = oldest archived line)
        screenY: archiveLine,
      }
      archivedPlacements.push(archivePlacement)
    }

    return archivedPlacements
  }
}
