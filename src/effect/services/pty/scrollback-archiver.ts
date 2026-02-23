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
        // Note: Task-2 will add appendLinesWithPlacements to ScrollbackArchive
        // For now, we use a temporary approach by storing placements separately
        if (placements.length > 0 && "appendLinesWithPlacements" in this.session.scrollbackArchive) {
          const archive = this.session.scrollbackArchive as typeof this.session.scrollbackArchive & {
            appendLinesWithPlacements?: (lines: TerminalCell[][], placements: ArchivePlacement[]) => Promise<void>
          }
          await archive.appendLinesWithPlacements?.(lines, placements)
        } else {
          await this.session.scrollbackArchive.appendLines(lines)
          // TODO(task-2): Store placements separately once ScrollbackArchive supports it
          // For now, placements are captured but not stored (graceful degradation)
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
      // A placement overlaps the archived range if its screenY is within [0, linesArchived)
      // placements are on the visible screen, so screenY is relative to scrollback end
      const placementStartY = placement.screenY
      const placementEndY = placement.screenY + placement.rows - 1

      // Check if placement overlaps with lines being archived (top of scrollback buffer)
      // The lines being archived have negative screenY relative to visible area
      // When scrollback is at index i, screenY = i - scrollbackLength
      // Lines at scrollback indices 0..linesArchived-1 have screenY in range [-scrollbackLength, -(scrollbackLength-linesArchived))
      // We need to check if the placement is on a line that's being archived
      
      // Since getKittyPlacements() returns placements relative to current visible screen,
      // we need to calculate the absolute scrollback line index for each placement
      const scrollbackLength = this.liveEmulator.getScrollbackLength()
      const absoluteLineIndex = placementStartY + scrollbackLength

      // Check if this placement's starting line is within the range being archived
      if (absoluteLineIndex >= 0 && absoluteLineIndex < linesArchived) {
        // Placement overlaps with archived lines - adjust coordinates
        const archivePlacement: ArchivePlacement = {
          ...placement,
          // archiveOffset: where this placement starts in the archive (0 = oldest)
          archiveOffset: archiveStartOffset + absoluteLineIndex,
          // originalScreenY: the original Y coordinate when archived (for coordinate mapping)
          originalScreenY: placement.screenY,
          // Adjust screenY to be relative to archived scrollback
          screenY: absoluteLineIndex,
        }
        archivedPlacements.push(archivePlacement)
      }
    }

    return archivedPlacements
  }
}
