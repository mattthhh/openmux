/**
 * PTY bridge functions (errore version)
 * Wraps PtyService for async/await usage
 *
 * Directly uses PtyService interface without Effect runtime.
 * Backward-compatible versions use the global services singleton.
 */

import type { PtyService } from '../services/Pty';
import type { PtyId, Cols, Rows } from '../types';
import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  UnifiedTerminalUpdate,
} from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { TerminalColors } from '../../terminal/terminal-colors';
import { deferMacrotask } from '../../core/scheduling';
import { isShimClient } from '../../shim/mode';
import * as ShimClient from '../../shim/client';
import { getPtyService } from './services-instance';
import type { PtySpawnError } from '../errors';

/** Helper to convert string to PtyId branded type */
const asPtyId = (id: string): PtyId => id as PtyId;

/** Create a PTY session */
export async function createPtySession(options: {
  cols: number;
  rows: number;
  cwd?: string;
  pixelWidth?: number;
  pixelHeight?: number;
}): Promise<string | PtySpawnError> {
  return createPtySessionWithService(getPtyService(), options);
}

/** Write data to a PTY */
export async function writeToPty(ptyId: string, data: string): Promise<void> {
  return writeToPtyWithService(getPtyService(), ptyId, data);
}

/** Send focus event to a PTY */
export async function sendPtyFocusEvent(ptyId: string, focused: boolean): Promise<void> {
  return sendPtyFocusEventWithService(getPtyService(), ptyId, focused);
}

/** Resize a PTY */
export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number,
  pixelWidth?: number,
  pixelHeight?: number
): Promise<void> {
  return resizePtyWithService(getPtyService(), ptyId, cols, rows, pixelWidth, pixelHeight);
}

/** Get the current working directory of a PTY */
export async function getPtyCwd(ptyId: string): Promise<string> {
  return getPtyCwdWithService(getPtyService(), ptyId);
}

/** Get the foreground process name for a PTY */
export async function getPtyForegroundProcess(ptyId: string): Promise<string | undefined> {
  return getPtyForegroundProcessWithService(getPtyService(), ptyId);
}

/** Get the last shell command for a PTY */
export async function getPtyLastCommand(ptyId: string): Promise<string | undefined> {
  return getPtyLastCommandWithService(getPtyService(), ptyId);
}

/** Destroy a PTY */
export function destroyPty(ptyId: string): void {
  return destroyPtyWithService(getPtyService(), ptyId);
}

/** Destroy all PTYs */
export function destroyAllPtys(): void {
  return destroyAllPtysWithService(getPtyService());
}

/** Get terminal state for a PTY */
export async function getTerminalState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalState | null> {
  return getTerminalStateWithService(getPtyService(), ptyId, options);
}

/** Register exit callback for a PTY */
export async function onPtyExit(
  ptyId: string,
  callback: (exitCode: number) => void
): Promise<() => void> {
  return onPtyExitWithService(getPtyService(), ptyId, callback);
}

/** Get scroll state for a PTY */
export async function getScrollState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalScrollState | null> {
  return getScrollStateWithService(getPtyService(), ptyId, options);
}

/** Capture text from a PTY */
export async function capturePty(
  ptyId: string,
  options?: { lines?: number; format?: 'text' | 'ansi'; raw?: boolean }
): Promise<string | null> {
  return capturePtyWithService(getPtyService(), ptyId, options);
}

/** Get scrollback lines from the PTY source-of-truth */
export async function getScrollbackLines(
  ptyId: string,
  startOffset: number,
  count: number
): Promise<Map<number, TerminalCell[]>> {
  return getScrollbackLinesWithService(getPtyService(), ptyId, startOffset, count);
}

/** Set scroll offset for a PTY */
export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  return setScrollOffsetWithService(getPtyService(), ptyId, offset);
}

/** Scroll terminal to bottom */
export async function scrollToBottom(ptyId: string): Promise<void> {
  return scrollToBottomWithService(getPtyService(), ptyId);
}

/** Subscribe to unified updates for a PTY */
export async function subscribeUnifiedToPty(
  ptyId: string,
  callback: (update: UnifiedTerminalUpdate) => void
): Promise<() => void> {
  return subscribeUnifiedToPtyWithService(getPtyService(), ptyId, callback);
}

/** Get terminal emulator for a PTY */
export async function getEmulator(ptyId: string): Promise<ITerminalEmulator | null> {
  return getEmulatorWithService(getPtyService(), ptyId);
}

/** Set update enabled for a PTY */
export async function setPtyUpdateEnabled(ptyId: string, enabled: boolean): Promise<void> {
  return setPtyUpdateEnabledWithService(getPtyService(), ptyId, enabled);
}

/** Apply host colors */
export async function applyHostColors(colors: TerminalColors): Promise<void> {
  return applyHostColorsWithService(getPtyService(), colors);
}

/** PTY lifecycle event type */
export type PtyLifecycleEvent = {
  type: 'created' | 'destroyed';
  ptyId: string;
};

/** Subscribe to PTY lifecycle events */
export function subscribeToPtyLifecycle(
  callback: (event: PtyLifecycleEvent) => void
): Promise<() => void> {
  return Promise.resolve(subscribeToPtyLifecycleWithService(getPtyService(), callback));
}

/** Title change event */
export interface PtyTitleChangeEvent {
  ptyId: string;
  title: string;
}

/** Subscribe to all title changes */
export function subscribeToAllTitleChanges(
  callback: (event: PtyTitleChangeEvent) => void
): Promise<() => void> {
  return Promise.resolve(subscribeToAllTitleChangesWithService(getPtyService(), callback));
}

/** Get PTY title */
export async function getPtyTitle(ptyId: string): Promise<string> {
  return getPtyTitleWithService(getPtyService(), ptyId);
}

/** Create a PTY with a specific service */
export async function createPtySessionWithService(
  pty: PtyService,
  options: {
    cols: number;
    rows: number;
    cwd?: string;
    pixelWidth?: number;
    pixelHeight?: number;
  }
): Promise<string | PtySpawnError> {
  const result = await pty.create({
    cols: options.cols as Cols,
    rows: options.rows as Rows,
    cwd: options.cwd,
    pixelWidth: options.pixelWidth,
    pixelHeight: options.pixelHeight,
  });
  if (result instanceof Error) return result as PtySpawnError;
  return result;
}

/** Write to PTY with a specific service */
export async function writeToPtyWithService(
  pty: PtyService,
  ptyId: string,
  data: string
): Promise<void> {
  const result = await pty.write(asPtyId(ptyId), data);
  if (result instanceof Error) {
    // Fire-and-forget
  }
}

/** Send focus event with a specific service */
export async function sendPtyFocusEventWithService(
  pty: PtyService,
  ptyId: string,
  focused: boolean
): Promise<void> {
  const result = await pty.sendFocusEvent(asPtyId(ptyId), focused);
  if (result instanceof Error) {
    // Fire-and-forget
  }
}

/** Resize PTY with a specific service */
export async function resizePtyWithService(
  pty: PtyService,
  ptyId: string,
  cols: number,
  rows: number,
  pixelWidth?: number,
  pixelHeight?: number
): Promise<void> {
  const result = await pty.resize(
    asPtyId(ptyId),
    cols as Cols,
    rows as Rows,
    pixelWidth,
    pixelHeight
  );
  if (result instanceof Error) {
    // Fire-and-forget
  }
}

/** Get CWD with a specific service */
export async function getPtyCwdWithService(pty: PtyService, ptyId: string): Promise<string> {
  const result = await pty.getCwd(asPtyId(ptyId));
  if (result instanceof Error) return process.cwd();
  return result;
}

/** Get foreground process with a specific service */
export async function getPtyForegroundProcessWithService(
  pty: PtyService,
  ptyId: string
): Promise<string | undefined> {
  try {
    const result = await pty.getForegroundProcess(asPtyId(ptyId));
    if (result instanceof Error) return undefined;
    return result;
  } catch {
    return undefined;
  }
}

/** Get last command with a specific service */
export async function getPtyLastCommandWithService(
  pty: PtyService,
  ptyId: string
): Promise<string | undefined> {
  try {
    const result = await pty.getLastCommand(asPtyId(ptyId));
    if (result instanceof Error) return undefined;
    return result;
  } catch {
    return undefined;
  }
}

/** Destroy PTY with a specific service */
export function destroyPtyWithService(pty: PtyService, ptyId: string): void {
  deferMacrotask(() => {
    void pty.destroy(asPtyId(ptyId));
  });
}

/** Destroy all PTYs with a specific service */
export function destroyAllPtysWithService(pty: PtyService): void {
  deferMacrotask(() => {
    void pty.destroyAll();
  });
}

/** Get terminal state with a specific service */
export async function getTerminalStateWithService(
  pty: PtyService,
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalState | null> {
  if (options?.force && isShimClient()) {
    try {
      return await ShimClient.getTerminalState(ptyId, { force: true });
    } catch {
      return null;
    }
  }

  try {
    const result = await pty.getTerminalState(asPtyId(ptyId));
    if (result instanceof Error) return null;
    return result;
  } catch {
    return null;
  }
}

/** Register exit callback with a specific service */
export async function onPtyExitWithService(
  pty: PtyService,
  ptyId: string,
  callback: (exitCode: number) => void
): Promise<() => void> {
  try {
    const result = await pty.onExit(asPtyId(ptyId), callback);
    if (result instanceof Error) return () => {};
    return result;
  } catch {
    return () => {};
  }
}

/** Get scroll state with a specific service */
export async function getScrollStateWithService(
  pty: PtyService,
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalScrollState | null> {
  if (options?.force && isShimClient()) {
    try {
      return await ShimClient.getScrollState(ptyId, { force: true });
    } catch {
      return null;
    }
  }

  try {
    const result = await pty.getScrollState(asPtyId(ptyId));
    if (result instanceof Error) return null;
    return result as TerminalScrollState;
  } catch {
    return null;
  }
}

/** Capture PTY with a specific service */
export async function capturePtyWithService(
  _pty: PtyService,
  ptyId: string,
  options?: { lines?: number; format?: 'text' | 'ansi'; raw?: boolean }
): Promise<string | null> {
  if (!isShimClient()) {
    return null;
  }

  try {
    return await ShimClient.capturePty(ptyId, options);
  } catch {
    return null;
  }
}

/** Get scrollback lines with a specific service */
export async function getScrollbackLinesWithService(
  pty: PtyService,
  ptyId: string,
  startOffset: number,
  count: number
): Promise<Map<number, TerminalCell[]>> {
  const safeStart = Math.max(0, Math.floor(startOffset));
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return new Map();

  if (isShimClient()) {
    return ShimClient.getScrollbackLines(ptyId, safeStart, safeCount).catch(() => new Map());
  }

  const emulator = await getEmulatorWithService(pty, ptyId);
  if (!emulator) return new Map();

  const lines = new Map<number, TerminalCell[]>();
  for (let i = 0; i < safeCount; i += 1) {
    const offset = safeStart + i;
    const line = emulator.getScrollbackLine(offset);
    if (!line) continue;
    lines.set(offset, line);
  }

  return lines;
}

/** Set scroll offset with a specific service */
export async function setScrollOffsetWithService(
  pty: PtyService,
  ptyId: string,
  offset: number
): Promise<void> {
  const result = await pty.setScrollOffset(asPtyId(ptyId), offset);
  if (result instanceof Error) {
    // Fire-and-forget
  }
}

/** Scroll to bottom with a specific service */
export async function scrollToBottomWithService(pty: PtyService, ptyId: string): Promise<void> {
  await setScrollOffsetWithService(pty, ptyId, 0);
}

/** Subscribe to unified updates with a specific service */
export async function subscribeUnifiedToPtyWithService(
  pty: PtyService,
  ptyId: string,
  callback: (update: UnifiedTerminalUpdate) => void
): Promise<() => void> {
  try {
    const result = await pty.subscribeUnified(asPtyId(ptyId), callback);
    if (result instanceof Error) return () => {};
    return result;
  } catch {
    return () => {};
  }
}

/** Get emulator with a specific service */
export async function getEmulatorWithService(
  pty: PtyService,
  ptyId: string
): Promise<ITerminalEmulator | null> {
  try {
    const result = await pty.getEmulator(asPtyId(ptyId));
    if (result instanceof Error) return null;
    return result;
  } catch {
    return null;
  }
}

/** Get emulator synchronously (may return null if not cached/available) */
export function getEmulatorSync(ptyId: string): ITerminalEmulator | null {
  return getEmulatorSyncWithService(getPtyService(), ptyId);
}

/** Get emulator synchronously with a specific service */
export function getEmulatorSyncWithService(
  pty: PtyService,
  ptyId: string
): ITerminalEmulator | null {
  try {
    return pty.getEmulatorSync(asPtyId(ptyId));
  } catch {
    return null;
  }
}

/** Set update enabled with a specific service */
export async function setPtyUpdateEnabledWithService(
  pty: PtyService,
  ptyId: string,
  enabled: boolean
): Promise<void> {
  try {
    const result = await pty.setUpdateEnabled(asPtyId(ptyId), enabled);
    if (result instanceof Error) {
      // Ignore
    }
  } catch {
    // Ignore
  }
}

/** Refresh PTY state to force a fresh update for visible terminals */
export async function refreshPty(ptyId: string): Promise<void> {
  return refreshPtyWithService(getPtyService(), ptyId);
}

/** Refresh PTY with a specific service */
export async function refreshPtyWithService(pty: PtyService, ptyId: string): Promise<void> {
  try {
    const emulator = await pty.getEmulator(asPtyId(ptyId));
    if (emulator instanceof Error) return;
    emulator.refresh?.();
  } catch {
    // Ignore
  }
}

/** Apply host colors with a specific service */
export async function applyHostColorsWithService(
  pty: PtyService,
  colors: TerminalColors
): Promise<void> {
  if (isShimClient()) {
    try {
      await ShimClient.setHostColors(colors);
    } catch {
      // Ignore
    }
    return;
  }

  await pty.setHostColors(colors);
}

/** Subscribe to lifecycle with a specific service */
export function subscribeToPtyLifecycleWithService(
  pty: PtyService,
  callback: (event: PtyLifecycleEvent) => void
): () => void {
  return pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
    callback({ type: event.type, ptyId: event.ptyId });
  });
}

/** Subscribe to title changes with a specific service */
export function subscribeToAllTitleChangesWithService(
  pty: PtyService,
  callback: (event: PtyTitleChangeEvent) => void
): () => void {
  return pty.subscribeToAllTitleChanges((event: { ptyId: string; title: string }) => {
    callback({ ptyId: event.ptyId, title: event.title });
  });
}

/** Get PTY title with a specific service */
export async function getPtyTitleWithService(pty: PtyService, ptyId: string): Promise<string> {
  try {
    const result = await pty.getTitle(asPtyId(ptyId));
    if (result instanceof Error) return '';
    return result;
  } catch {
    return '';
  }
}
