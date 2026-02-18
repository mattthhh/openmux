/**
 * CopyModeContext - manages vim-style copy mode for terminal panes
 *
 * Provides a virtual cursor for scrollback navigation and selection.
 */

import {
  createContext,
  useContext,
  createSignal,
  type ParentProps,
} from 'solid-js';
import type { TerminalCell } from '../core/types';
import { isCellInRange, extractSelectedText } from '../core/coordinates';
import { copyToClipboard } from '../effect/bridge';
import { useTerminal } from './TerminalContext';
import { useSelection } from './SelectionContext';
import type {
  CopyModeContextValue,
  CopyModeState,
  CopyCursor,
  CopyVisualType,
} from './copy-mode/types';
import {
  buildBlockSelectionRange,
  buildCharSelectionRange,
  buildLineSelectionRange,
} from './copy-mode/selection-utils';
import {
  type LineAccessor,
  findSpanAtOrAfter,
  findSpanAtOrBefore,
  findNextRun,
  findPrevRun,
  getRunAt,
  getLineEndX,
  getLineStartX,
  isWideWordChar,
  isWhitespaceChar,
  isWordChar,
} from './copy-mode/text-utils';

export type { CopyModeContextValue, CopyCursor, CopyVisualType } from './copy-mode/types';

const CopyModeContext = createContext<CopyModeContextValue | null>(null);


interface CopyModeProviderProps extends ParentProps {}

export function CopyModeProvider(props: CopyModeProviderProps) {
  const terminal = useTerminal();
  const selection = useSelection();
  const {
    getScrollState,
    setScrollOffset,
    getEmulatorSync,
    getTerminalStateSync,
  } = terminal;

  const [state, setState] = createSignal<CopyModeState | null>(null);
  const [copyModeVersion, setCopyModeVersion] = createSignal(0);

  const notifyChange = () => setCopyModeVersion((v) => v + 1);

  const isActive = (ptyId?: string): boolean => {
    const current = state();
    if (!current) return false;
    if (!ptyId) return true;
    return current.ptyId === ptyId;
  };

  const getActivePtyId = (): string | null => {
    return state()?.ptyId ?? null;
  };

  const getCursor = (ptyId: string): CopyCursor | null => {
    const current = state();
    if (!current || current.ptyId !== ptyId) return null;
    return current.cursor;
  };

  const getScrollMeta = (ptyId: string) => {
    const terminalState = getTerminalStateSync(ptyId);
    const emulator = getEmulatorSync(ptyId);
    const scrollState = getScrollState(ptyId);
    const scrollbackLength =
      scrollState?.scrollbackLength ?? emulator?.getScrollbackLength() ?? 0;
    const rows = terminalState?.rows ?? 0;
    const cols = terminalState?.cols ?? 0;
    const viewportOffset = scrollState?.viewportOffset ?? 0;
    return { terminalState, emulator, scrollbackLength, rows, cols, viewportOffset };
  };

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(value, max));

  const clampCursor = (ptyId: string, cursor: CopyCursor): CopyCursor | null => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) return null;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    return {
      x: clamp(cursor.x, 0, Math.max(0, meta.cols - 1)),
      absY: clamp(cursor.absY, 0, maxAbsY),
    };
  };

  const ensureCursorVisible = (ptyId: string, cursor: CopyCursor) => {
    const meta = getScrollMeta(ptyId);
    if (meta.rows <= 0) return;
    const topAbsY = meta.scrollbackLength - meta.viewportOffset;
    const bottomAbsY = topAbsY + meta.rows - 1;

    if (cursor.absY < topAbsY) {
      setScrollOffset(ptyId, meta.scrollbackLength - cursor.absY);
    } else if (cursor.absY > bottomAbsY) {
      setScrollOffset(ptyId, meta.scrollbackLength - (cursor.absY - (meta.rows - 1)));
    }
  };

  const recomputeSelection = (next: CopyModeState): CopyModeState => {
    if (!next.visualType || !next.anchor) {
      return { ...next, selectionRange: null, bounds: null };
    }
    const meta = getScrollMeta(next.ptyId);
    const cols = meta.cols || 1;
    const selection =
      next.visualType === 'line'
        ? buildLineSelectionRange(next.anchor, next.cursor, cols)
        : next.visualType === 'block'
          ? buildBlockSelectionRange(next.anchor, next.cursor)
          : buildCharSelectionRange(next.anchor, next.cursor, cols);
    return {
      ...next,
      selectionRange: selection.range,
      bounds: selection.bounds,
    };
  };

  const updateState = (next: CopyModeState | null) => {
    setState(next);
    notifyChange();
  };

  const enterCopyMode = (ptyId: string) => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) return;
    const cursorY = meta.terminalState.cursor.y ?? 0;
    const cursorX = meta.terminalState.cursor.x ?? 0;
    const absY = meta.viewportOffset > 0
      ? meta.scrollbackLength - meta.viewportOffset
      : meta.scrollbackLength + cursorY;
    const clamped = clampCursor(ptyId, { x: cursorX, absY });
    if (!clamped) return;

    updateState({
      ptyId,
      cursor: clamped,
      anchor: null,
      visualType: null,
      selectionRange: null,
      bounds: null,
    });
  };

  const exitCopyMode = () => {
    updateState(null);
  };

  const moveCursorTo = (cursor: CopyCursor) => {
    const current = state();
    if (!current) return;
    const clamped = clampCursor(current.ptyId, cursor);
    if (!clamped) return;
    const next = recomputeSelection({
      ...current,
      cursor: clamped,
    });
    updateState(next);
    ensureCursorVisible(current.ptyId, clamped);
  };

  const moveCursorBy = (dx: number, dy: number) => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: current.cursor.x + dx, absY: current.cursor.absY + dy });
  };

  const moveToTop = () => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: current.cursor.x, absY: 0 });
  };

  const moveToBottom = () => {
    const current = state();
    if (!current) return;
    const meta = getScrollMeta(current.ptyId);
    if (meta.rows <= 0) return;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    moveCursorTo({ x: current.cursor.x, absY: maxAbsY });
  };

  const getLineCells = (ptyId: string, absY: number): TerminalCell[] | null => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState) return null;
    if (absY < meta.scrollbackLength) {
      return meta.emulator?.getScrollbackLine(absY) ?? null;
    }
    const liveY = absY - meta.scrollbackLength;
    return meta.terminalState.cells[liveY] ?? null;
  };

  const getLineAccessor = (ptyId: string): LineAccessor | null => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState) return null;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    const getLine = (absY: number) => {
      if (absY < meta.scrollbackLength) {
        return meta.emulator?.getScrollbackLine(absY) ?? null;
      }
      const liveY = absY - meta.scrollbackLength;
      return meta.terminalState?.cells[liveY] ?? null;
    };
    return { maxAbsY, getLine };
  };

  const moveToLineStart = () => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: 0, absY: current.cursor.absY });
  };

  const moveToLineEnd = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    moveCursorTo({ x: getLineEndX(line), absY: current.cursor.absY });
  };

  const moveToLineFirstNonBlank = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    moveCursorTo({ x: getLineStartX(line), absY: current.cursor.absY });
  };

  const getViewportRows = () => {
    const current = state();
    if (!current) return 0;
    const meta = getScrollMeta(current.ptyId);
    return meta.rows ?? 0;
  };

  const moveWordForward = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const run = getRunAt(access, current.cursor.absY, current.cursor.x);
    const searchAbsY = run ? run.absY : current.cursor.absY;
    const searchX = run ? run.end + 1 : current.cursor.x;
    const next = findNextRun(access, searchAbsY, searchX);
    if (next) {
      moveCursorTo({ x: next.start, absY: next.absY });
    }
  };

  const moveWordBackward = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const run = getRunAt(access, current.cursor.absY, current.cursor.x);
    if (run && current.cursor.x > run.start) {
      moveCursorTo({ x: run.start, absY: run.absY });
      return;
    }
    const searchAbsY = run ? run.absY : current.cursor.absY;
    const searchX = run ? run.start - 1 : current.cursor.x - 1;
    const prev = findPrevRun(access, searchAbsY, searchX);
    if (prev) {
      moveCursorTo({ x: prev.start, absY: prev.absY });
    }
  };

  const moveWordEnd = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const run = getRunAt(access, current.cursor.absY, current.cursor.x);
    if (run && current.cursor.x < run.end) {
      moveCursorTo({ x: run.end, absY: run.absY });
      return;
    }
    const searchAbsY = run ? run.absY : current.cursor.absY;
    const searchX = run ? run.end + 1 : current.cursor.x;
    const next = findNextRun(access, searchAbsY, searchX);
    if (next) {
      moveCursorTo({ x: next.end, absY: next.absY });
    }
  };

  const moveWideWordForward = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const line = access.getLine(current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(access, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) && word.absY === current.cursor.absY && current.cursor.x <= word.end) {
      const next = findSpanAtOrAfter(access, word.absY, word.end + 1, isWideWordChar);
      if (next) {
        moveCursorTo({ x: next.start, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWideWordBackward = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const line = access.getLine(current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrBefore(access, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x === word.start) {
      const prev = findSpanAtOrBefore(access, word.absY, word.start - 1, isWideWordChar);
      if (prev) {
        moveCursorTo({ x: prev.start, absY: prev.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWideWordEnd = () => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const line = access.getLine(current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(access, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x <= word.end) {
      if (current.cursor.x < word.end) {
        moveCursorTo({ x: word.end, absY: word.absY });
        return;
      }
      const next = findSpanAtOrAfter(access, word.absY, word.end + 1, isWideWordChar);
      if (next) {
        moveCursorTo({ x: next.end, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.end, absY: word.absY });
  };

  const toggleVisual = (type: CopyVisualType) => {
    const current = state();
    if (!current) return;
    if (current.visualType === type) {
      updateState({ ...current, anchor: null, visualType: null, selectionRange: null, bounds: null });
      return;
    }
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: type,
    }));
  };

  const startSelection = (type: CopyVisualType) => {
    const current = state();
    if (!current) return;
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: type,
    }));
  };

  const selectWord = (mode: 'inner' | 'around') => {
    const current = state();
    if (!current) return;
    const access = getLineAccessor(current.ptyId);
    if (!access) return;
    const word = findSpanAtOrAfter(access, current.cursor.absY, current.cursor.x, isWordChar);
    if (!word) return;

    let start = word.start;
    let end = word.end;
    if (mode === 'around') {
      let hasTrailingSpace = false;
      for (let x = end + 1; x < word.line.length; x += 1) {
        const char = word.line[x]?.char ?? ' ';
        if (isWhitespaceChar(char)) {
          hasTrailingSpace = true;
          end = x;
        } else {
          break;
        }
      }
      if (!hasTrailingSpace) {
        for (let x = start - 1; x >= 0; x -= 1) {
          const char = word.line[x]?.char ?? ' ';
          if (isWhitespaceChar(char)) {
            start = x;
          } else {
            break;
          }
        }
      }
    }

    const anchor: CopyCursor = { x: start, absY: word.absY };
    const cursor: CopyCursor = { x: end, absY: word.absY };
    const next = recomputeSelection({
      ...current,
      cursor,
      anchor,
      visualType: 'char',
    });
    updateState(next);
    ensureCursorVisible(current.ptyId, cursor);
  };

  const selectLine = () => {
    const current = state();
    if (!current) return;
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: 'line',
    }));
  };

  const clearSelection = () => {
    const current = state();
    if (!current) return;
    updateState({ ...current, anchor: null, visualType: null, selectionRange: null, bounds: null });
  };

  const hasSelection = (ptyId: string): boolean => {
    const current = state();
    return !!current && current.ptyId === ptyId && !!current.selectionRange;
  };

  const isCellSelected = (ptyId: string, x: number, absY: number): boolean => {
    const current = state();
    if (!current || current.ptyId !== ptyId || !current.selectionRange || !current.bounds) {
      return false;
    }
    if (current.visualType === 'block' && current.anchor) {
      const minX = Math.min(current.anchor.x, current.cursor.x);
      const maxX = Math.max(current.anchor.x, current.cursor.x);
      const minY = Math.min(current.anchor.absY, current.cursor.absY);
      const maxY = Math.max(current.anchor.absY, current.cursor.absY);
      if (absY < minY || absY > maxY) return false;
      if (x < minX || x > maxX) return false;
      return true;
    }
    const { bounds } = current;
    if (absY < bounds.minY || absY > bounds.maxY) return false;
    if (absY === bounds.minY && absY === bounds.maxY) {
      if (x < bounds.minX || x > bounds.maxX) return false;
    }
    return isCellInRange(x, absY, current.selectionRange);
  };

  const copySelection = async () => {
    const current = state();
    if (!current) return;
    const meta = getScrollMeta(current.ptyId);
    if (!meta.terminalState) return;
    const scrollbackLength = meta.scrollbackLength ?? 0;

    if (current.visualType === 'block' && current.anchor) {
      const minX = Math.min(current.anchor.x, current.cursor.x);
      const maxX = Math.max(current.anchor.x, current.cursor.x);
      const minY = Math.min(current.anchor.absY, current.cursor.absY);
      const maxY = Math.max(current.anchor.absY, current.cursor.absY);
      const lines: string[] = [];
      for (let absY = minY; absY <= maxY; absY += 1) {
        const row = getLineCells(current.ptyId, absY);
        let rowText = '';
        for (let x = minX; x <= maxX; x += 1) {
          const cell = row?.[x];
          if (!cell) {
            rowText += ' ';
            continue;
          }
          rowText += cell.char;
          if (cell.width === 2) {
            x += 1;
          }
        }
        lines.push(rowText);
      }
      const text = lines.join('\n');
      if (text.length > 0) {
        await copyToClipboard(text);
        selection.notifyCopy(text.length, current.ptyId);
      }
      return;
    }

    let range = current.selectionRange;
    if (!range) {
      const line = getLineCells(current.ptyId, current.cursor.absY);
      const cols = meta.cols || (line?.length ?? 1);
      range = {
        startX: 0,
        startY: current.cursor.absY,
        endX: Math.max(1, cols),
        endY: current.cursor.absY,
        focusAtEnd: true,
      };
    }

    const getLine = (absY: number) => getLineCells(current.ptyId, absY);
    const text = extractSelectedText(range, scrollbackLength, getLine);
    if (text.length > 0) {
      await copyToClipboard(text);
      selection.notifyCopy(text.length, current.ptyId);
    }
  };

  const value: CopyModeContextValue = {
    enterCopyMode,
    exitCopyMode,
    isActive,
    getActivePtyId,
    getCursor,
    moveCursorBy,
    moveCursorTo,
    moveToTop,
    moveToBottom,
    moveToLineStart,
    moveToLineEnd,
    moveToLineFirstNonBlank,
    getViewportRows,
    moveWordForward,
    moveWordBackward,
    moveWordEnd,
    moveWideWordForward,
    moveWideWordBackward,
    moveWideWordEnd,
    toggleVisual,
    startSelection,
    selectWord,
    selectLine,
    copySelection,
    clearSelection,
    isCellSelected,
    hasSelection,
    get copyModeVersion() { return copyModeVersion(); },
  };

  return (
    <CopyModeContext.Provider value={value}>
      {props.children}
    </CopyModeContext.Provider>
  );
}

export function useCopyMode(): CopyModeContextValue {
  const context = useContext(CopyModeContext);
  if (!context) {
    throw new Error('useCopyMode must be used within CopyModeProvider');
  }
  return context;
}
