/**
 * Scrollback archiver - spills live scrollback into a disk archive.
 */
/** Minimal session contract for ScrollbackArchiver, avoiding circular dep with types.ts */
interface ArchiverSession {
  id: string;
  scrollbackArchive: ScrollbackArchive;
}
import {
  isKittyGraphicsEmulator,
  type ITerminalEmulator,
} from '../../../terminal/emulator-interface';
import type { TerminalCell } from '../../../core/types';
import type { ArchivePlacement, ScrollbackArchive } from '../../../terminal/scrollback-archive';
import { HOT_SCROLLBACK_LIMIT } from '../../../terminal/scrollback-config';
import { tracePtyEvent } from '../../../terminal/pty-trace';
import { deferMacrotask } from '../../../core/scheduling';
import * as errore from 'errore';
import { ArchiverError } from '../../errors';

const ARCHIVE_BATCH_LINES = 512;
const MAX_BATCHES_PER_RUN = 4;

export interface DrainScrollbackOverflowOptions {
  scrollbackArchive: ScrollbackArchive;
  liveEmulator: ITerminalEmulator;
  hotScrollbackLimit?: number;
  archiveBatchLines?: number;
  maxBatches?: number;
}

export interface DrainScrollbackOverflowResult {
  batches: number;
  linesArchived: number;
  placementsArchived: number;
  remainingOverflow: number;
}

export async function drainScrollbackOverflow(
  options: DrainScrollbackOverflowOptions
): Promise<DrainScrollbackOverflowResult> {
  const {
    scrollbackArchive,
    liveEmulator,
    hotScrollbackLimit = HOT_SCROLLBACK_LIMIT,
    archiveBatchLines = ARCHIVE_BATCH_LINES,
    maxBatches = MAX_BATCHES_PER_RUN,
  } = options;

  if (liveEmulator.isDisposed || liveEmulator.isAlternateScreen()) {
    return {
      batches: 0,
      linesArchived: 0,
      placementsArchived: 0,
      remainingOverflow: 0,
    };
  }

  const overflow = liveEmulator.getScrollbackLength() - hotScrollbackLimit;
  if (overflow <= 0) {
    return {
      batches: 0,
      linesArchived: 0,
      placementsArchived: 0,
      remainingOverflow: 0,
    };
  }

  const maxLinesPerRun = archiveBatchLines * maxBatches;
  const targetLineCount = Math.min(overflow, maxLinesPerRun);
  const archiveStartOffset = scrollbackArchive.length;
  const lines = captureLines({ liveEmulator, count: targetLineCount });
  if (lines.length === 0) {
    return {
      batches: 0,
      linesArchived: 0,
      placementsArchived: 0,
      remainingOverflow: overflow,
    };
  }

  const placements = capturePlacements({
    liveEmulator,
    linesArchived: lines.length,
    archiveStartOffset,
  });

  await scrollbackArchive.appendLines(lines);
  if (placements.length > 0) {
    await scrollbackArchive.appendPlacements(placements);
  }

  if ('trimScrollback' in liveEmulator) {
    const trimmer = liveEmulator as ITerminalEmulator & {
      trimScrollback?: (lines: number) => void;
    };
    trimmer.trimScrollback?.(lines.length);
  }

  return {
    batches: Math.ceil(lines.length / archiveBatchLines),
    linesArchived: lines.length,
    placementsArchived: placements.length,
    remainingOverflow: Math.max(0, liveEmulator.getScrollbackLength() - hotScrollbackLimit),
  };
}

function captureLines(options: {
  liveEmulator: ITerminalEmulator;
  count: number;
}): TerminalCell[][] {
  const { liveEmulator, count } = options;
  const lines: TerminalCell[][] = [];

  for (let i = 0; i < count; i++) {
    const line = liveEmulator.getScrollbackLine(i);
    if (!line) break;
    lines.push(line);
  }

  return lines;
}

/**
 * Capture Kitty placements that overlap with the lines being archived.
 * This must be called BEFORE trimScrollback() to avoid losing placement data.
 */
function capturePlacements(options: {
  liveEmulator: ITerminalEmulator;
  linesArchived: number;
  archiveStartOffset: number;
}): ArchivePlacement[] {
  const { liveEmulator, linesArchived, archiveStartOffset } = options;

  if (!isKittyGraphicsEmulator(liveEmulator)) {
    return [];
  }

  const placements = liveEmulator.getKittyPlacements();
  if (!placements || placements.length === 0) {
    return [];
  }

  const archivedPlacements: ArchivePlacement[] = [];

  for (const placement of placements) {
    const placementStartY = placement.screenY;
    const placementRows = Math.max(1, placement.rows);
    const placementEndYExclusive = placementStartY + placementRows;

    if (placementEndYExclusive <= 0 || placementStartY >= linesArchived) {
      continue;
    }

    const archiveLine = Math.max(0, placementStartY);
    archivedPlacements.push({
      ...placement,
      archiveOffset: archiveStartOffset + archiveLine,
      originalScreenY: placement.screenY,
      screenY: archiveLine,
    });
  }

  return archivedPlacements;
}

export class ScrollbackArchiver {
  private scheduled = false;
  private running = false;
  private pending = false;

  constructor(
    private session: ArchiverSession,
    private liveEmulator: ITerminalEmulator
  ) {}

  schedule(): void {
    if (this.scheduled) {
      this.pending = true;
      return;
    }
    this.scheduled = true;
    deferMacrotask(() => {
      void this.run();
    });
  }

  reset(): void {
    this.pending = false;
    this.scheduled = false;
  }

  private async run(): Promise<void> {
    this.scheduled = false;
    if (this.running) {
      this.pending = true;
      return;
    }

    this.running = true;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = await errore.tryAsync({
      try: () =>
        drainScrollbackOverflow({
          scrollbackArchive: this.session.scrollbackArchive,
          liveEmulator: this.liveEmulator,
        }),
      catch: (cause: unknown) =>
        new ArchiverError({
          operation: 'drain-scrollback',
          reason: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const durationMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    if (!(result instanceof ArchiverError)) {
      if (result.linesArchived > 0 || durationMs >= 8) {
        tracePtyEvent('scrollback-archiver-run', {
          ptyId: this.session.id,
          durationMs,
          linesArchived: result.linesArchived,
          placementsArchived: result.placementsArchived,
          batches: result.batches,
          remainingOverflow: result.remainingOverflow,
          archiveLength: this.session.scrollbackArchive.length,
          liveScrollbackLength: this.liveEmulator.getScrollbackLength(),
        });
      }
      if (result.remainingOverflow > 0) {
        this.pending = true;
      }
    }
    if (result instanceof ArchiverError) {
      // Best-effort: log archive errors but don't block PTY flow (rule #20)
      console.warn('[scrollback-archiver]', result.message, result.cause);
    }
    this.running = false;
    if (this.pending) {
      this.pending = false;
      this.schedule();
    }
  }
}
