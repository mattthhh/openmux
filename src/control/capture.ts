import type { TerminalCell } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { extractLineText } from '../terminal/ghostty-vt/utils';

export type CaptureFormat = 'text' | 'ansi';

export type CaptureOptions = {
  lines: number;
  format: CaptureFormat;
  trimTrailing?: boolean;
  trimTrailingLines?: boolean;
};

type StyleState = {
  fg: string;
  bg: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
};

const RESET = '\u001b[0m';

function rgbToKey(color: { r: number; g: number; b: number }): string {
  return `${color.r};${color.g};${color.b}`;
}

function findLastContentIndex(cells: TerminalCell[]): number {
  let last = -1;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.char && cell.char !== ' ') {
      last = i;
    }
    if (cell.width === 2) {
      i++;
    }
  }
  return last;
}

function hasLineContent(cells: TerminalCell[] | null): boolean {
  if (!cells || cells.length === 0) return false;
  return findLastContentIndex(cells) >= 0;
}

function getLineCells(
  emulator: ITerminalEmulator,
  state: ReturnType<ITerminalEmulator['getTerminalState']>,
  scrollbackLength: number,
  index: number
): TerminalCell[] | null {
  if (index < scrollbackLength) {
    return emulator.getScrollbackLine(index);
  }
  const liveIndex = index - scrollbackLength;
  return state.cells[liveIndex] ?? null;
}

/** Render cells as plain text with trailing whitespace preserved */
function renderTextLine(cells: TerminalCell[]): string {
  return extractLineText(cells);
}

/** Render cells as plain text with trailing whitespace trimmed */
function renderTextLineTrimmed(cells: TerminalCell[]): string {
  const raw = extractLineText(cells);
  return raw.replace(/[\s\u00a0]+$/u, '');
}

/**
 * Render cells as plain text while preserving the old trim flag signature.
 * Prefer renderTextLine() or renderTextLineTrimmed() at new call sites.
 */
function renderTextLineWithTrim(cells: TerminalCell[], trimTrailing: boolean): string {
  return trimTrailing ? renderTextLineTrimmed(cells) : renderTextLine(cells);
}

function buildAnsiCodes(next: StyleState, prev: StyleState | null): string {
  const codes: Array<string> = [];

  if (!prev || next.bold !== prev.bold || next.dim !== prev.dim) {
    if (!next.bold && !next.dim) {
      codes.push('22');
    } else {
      if (next.bold) codes.push('1');
      if (next.dim) codes.push('2');
    }
  }

  if (!prev || next.italic !== prev.italic) {
    codes.push(next.italic ? '3' : '23');
  }

  if (!prev || next.underline !== prev.underline) {
    codes.push(next.underline ? '4' : '24');
  }

  if (!prev || next.strikethrough !== prev.strikethrough) {
    codes.push(next.strikethrough ? '9' : '29');
  }

  if (!prev || next.fg !== prev.fg) {
    codes.push(`38;2;${next.fg}`);
  }

  if (!prev || next.bg !== prev.bg) {
    codes.push(`48;2;${next.bg}`);
  }

  if (codes.length === 0) return '';
  return `\u001b[${codes.join(';')}m`;
}

/** Render cells as ANSI with trailing whitespace preserved */
function renderAnsiLine(cells: TerminalCell[]): string {
  const lastContentIndex = cells.length - 1;
  return renderAnsiLineInternal(cells, lastContentIndex);
}

/** Render cells as ANSI with trailing whitespace trimmed */
function renderAnsiLineTrimmed(cells: TerminalCell[]): string {
  const lastContentIndex = findLastContentIndex(cells);
  if (lastContentIndex < 0) {
    return '';
  }
  return renderAnsiLineInternal(cells, lastContentIndex);
}

/** Internal ANSI renderer with computed last index */
function renderAnsiLineInternal(cells: TerminalCell[], lastContentIndex: number): string {
  let output = '';
  let current: StyleState | null = null;
  let usedAnsi = false;

  for (let i = 0; i <= lastContentIndex; i++) {
    const cell = cells[i];
    const fg = cell.inverse ? cell.bg : cell.fg;
    const bg = cell.inverse ? cell.fg : cell.bg;

    const next: StyleState = {
      fg: rgbToKey(fg),
      bg: rgbToKey(bg),
      bold: cell.bold,
      dim: cell.dim,
      italic: cell.italic,
      underline: cell.underline,
      strikethrough: cell.strikethrough,
    };

    const sgr = buildAnsiCodes(next, current);
    if (sgr) {
      output += sgr;
      usedAnsi = true;
      current = next;
    } else if (!current) {
      current = next;
    }

    output += cell.char;
    if (cell.width === 2) {
      i++;
    }
  }

  if (usedAnsi) {
    output += RESET;
  }

  return output;
}

/**
 * Render cells as ANSI text while preserving the old trim flag signature.
 * Prefer renderAnsiLine() or renderAnsiLineTrimmed() at new call sites.
 */
function renderAnsiLineWithTrim(cells: TerminalCell[], trimTrailing: boolean): string {
  return trimTrailing ? renderAnsiLineTrimmed(cells) : renderAnsiLine(cells);
}

export function captureEmulator(emulator: ITerminalEmulator, options: CaptureOptions): string {
  const format = options.format;
  const trimTrailing = options.trimTrailing ?? true;
  const trimTrailingLines = options.trimTrailingLines ?? true;
  const state = emulator.getTerminalState();
  const scrollbackLength = emulator.getScrollbackLength();
  const totalLines = scrollbackLength + state.rows;
  const desiredLines = Math.max(1, Math.floor(options.lines));
  if (totalLines === 0) {
    return '';
  }

  let end = totalLines - 1;
  if (trimTrailingLines) {
    let lastContent = -1;
    for (let liveIndex = state.rows - 1; liveIndex >= 0; liveIndex--) {
      const cells = state.cells[liveIndex] ?? null;
      if (hasLineContent(cells)) {
        lastContent = scrollbackLength + liveIndex;
        break;
      }
    }
    if (lastContent < 0) {
      for (let scrollIndex = scrollbackLength - 1; scrollIndex >= 0; scrollIndex--) {
        const cells = emulator.getScrollbackLine(scrollIndex);
        if (hasLineContent(cells)) {
          lastContent = scrollIndex;
          break;
        }
      }
    }
    if (lastContent >= 0) {
      end = lastContent;
    }
  }

  if (end < 0) {
    return '';
  }

  const start = Math.max(0, end - desiredLines + 1);

  const rows: string[] = [];

  for (let index = start; index <= end; index++) {
    const cells = getLineCells(emulator, state, scrollbackLength, index);

    if (!cells) {
      rows.push('');
      continue;
    }

    rows.push(
      trimTrailing
        ? format === 'ansi'
          ? renderAnsiLineTrimmed(cells)
          : renderTextLineTrimmed(cells)
        : format === 'ansi'
          ? renderAnsiLine(cells)
          : renderTextLine(cells)
    );
  }

  return rows.join('\n');
}
