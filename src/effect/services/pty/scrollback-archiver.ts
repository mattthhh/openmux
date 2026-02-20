/**
 * Scrollback archiver - spills live scrollback into a disk archive.
 * (errore version - unchanged from original)
 */
import type { InternalPtySession } from "./types"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"
import type { TerminalCell } from "../../../core/types"
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
        const lines = this.captureLines(batchSize)
        if (lines.length === 0) break

        await this.session.scrollbackArchive.appendLines(lines)

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
}
