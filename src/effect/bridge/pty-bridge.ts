/**
 * PTY bridge functions (errore version)
 *
 * Directly uses PTY service interface without Effect runtime.
 */

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
  const pty = getPtyService();
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

/** Write data to a PTY */
export async function writeToPty(ptyId: string, data: string): Promise<void> {
  const pty = getPtyService();
  const result = await pty.write(asPtyId(ptyId), data);
  if (result instanceof Error) {
    console.warn('Failed to write to PTY:', result.message);
  }
}

/** Send focus event to a PTY */
export async function sendPtyFocusEvent(ptyId: string, focused: boolean): Promise<void> {
  const pty = getPtyService();
  const result = await pty.sendFocusEvent(asPtyId(ptyId), focused);
  if (result instanceof Error) {
    console.warn('Failed to send focus event:', result.message);
  }
}

/** Resize a PTY */
export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number,
  pixelWidth?: number,
  pixelHeight?: number
): Promise<void> {
  const pty = getPtyService();
  const result = await pty.resize(
    asPtyId(ptyId),
    cols as Cols,
    rows as Rows,
    pixelWidth,
    pixelHeight
  );
  if (result instanceof Error) {
    console.warn('Failed to resize PTY:', result.message);
  }
}

/** Get the current working directory of a PTY */
export async function getPtyCwd(ptyId: string): Promise<string> {
  const pty = getPtyService();
  const result = await pty.getCwd(asPtyId(ptyId));
  if (result instanceof Error) return process.cwd();
  return result;
}

/** Get the foreground process name for a PTY */
export async function getPtyForegroundProcess(ptyId: string): Promise<string | undefined> {
  const pty = getPtyService();
  const result = await pty.getForegroundProcess(asPtyId(ptyId));
  if (result instanceof Error) return undefined;
  return result;
}

/** Get the last shell command for a PTY */
export async function getPtyLastCommand(ptyId: string): Promise<string | undefined> {
  const pty = getPtyService();
  const result = await pty.getSession(asPtyId(ptyId));
  if (result instanceof Error) return undefined;
  if (result.lastCommand !== undefined) return result.lastCommand;

  if (!isShimClient()) {
    return undefined;
  }

  return ShimClient.getLastCommand(ptyId).catch((e) => {
    console.warn('Failed to get PTY last command from shim:', e);
    return undefined;
  });
}

/** Destroy a PTY */
export function destroyPty(ptyId: string): void {
  const pty = getPtyService();
  deferMacrotask(() => {
    void pty.destroy(asPtyId(ptyId));
  });
}

/** Destroy all PTYs */
export function destroyAllPtys(): void {
  const pty = getPtyService();
  deferMacrotask(() => {
    void pty.destroyAll();
  });
}

/** Get terminal state for a PTY */
export async function getTerminalState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalState | null> {
  const pty = getPtyService();

  if (options?.force && isShimClient()) {
    return ShimClient.getTerminalState(ptyId, { force: true }).catch((e) => {
      console.warn('Failed to get terminal state from shim:', e);
      return null;
    });
  }

  const result = await pty.getTerminalState(asPtyId(ptyId));
  if (result instanceof Error) return null;
  return result;
}

/** Register exit callback for a PTY */
export async function onPtyExit(
  ptyId: string,
  callback: (exitCode: number) => void
): Promise<() => void> {
  const pty = getPtyService();
  const result = await pty.onExit(asPtyId(ptyId), callback);
  if (result instanceof Error) {
    console.warn('Failed to register PTY exit callback:', result.message);
    return () => {};
  }
  return result;
}

/** Get scroll state for a PTY */
export async function getScrollState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalScrollState | null> {
  const pty = getPtyService();

  if (options?.force && isShimClient()) {
    return ShimClient.getScrollState(ptyId, { force: true }).catch((e) => {
      console.warn('Failed to get scroll state from shim:', e);
      return null;
    });
  }

  const result = await pty.getScrollState(asPtyId(ptyId));
  if (result instanceof Error) return null;
  return result as TerminalScrollState;
}

/** Capture PTY content */
export async function capturePty(
  ptyId: string,
  options?: { lines?: number; format?: 'text' | 'ansi'; raw?: boolean }
): Promise<string | null> {
  if (!isShimClient()) {
    return null;
  }

  return ShimClient.capturePty(ptyId, options).catch((e) => {
    console.warn('Failed to capture PTY:', e);
    return null;
  });
}

/** Get scrollback lines for a PTY */
export async function getScrollbackLines(
  ptyId: string,
  startOffset: number,
  count: number
): Promise<Map<number, TerminalCell[]>> {
  const safeStart = Math.max(0, Math.floor(startOffset));
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return new Map();

  if (isShimClient()) {
    return ShimClient.getScrollbackLines(ptyId, safeStart, safeCount).catch((e) => {
      console.warn('Failed to get scrollback lines from shim:', e);
      return new Map();
    });
  }

  const emulator = await getEmulator(ptyId);
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

/** Set scroll offset for a PTY */
export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  const pty = getPtyService();
  const result = await pty.setScrollOffset(asPtyId(ptyId), offset);
  if (result instanceof Error) {
    console.warn('Failed to set scroll offset:', result.message);
  }
}

/** Scroll to bottom for a PTY */
export async function scrollToBottom(ptyId: string): Promise<void> {
  await setScrollOffset(ptyId, 0);
}

/** Subscribe to unified updates for a PTY */
export async function subscribeUnifiedToPty(
  ptyId: string,
  callback: (update: UnifiedTerminalUpdate) => void
): Promise<() => void> {
  const pty = getPtyService();
  const result = await pty.subscribe(asPtyId(ptyId), callback);
  if (result instanceof Error) {
    console.warn('Failed to subscribe to unified PTY updates:', result.message);
    return () => {};
  }
  return result;
}

/** Get emulator for a PTY */
export async function getEmulator(ptyId: string): Promise<ITerminalEmulator | null> {
  const pty = getPtyService();
  const result = await pty.getEmulator(asPtyId(ptyId));
  if (result instanceof Error) return null;
  return result;
}

/** Get emulator synchronously (may return null if not cached/available) */
export function getEmulatorSync(ptyId: string): ITerminalEmulator | null {
  const pty = getPtyService();
  return pty.getEmulator(asPtyId(ptyId), { sync: true });
}

/** Set update enabled for a PTY */
export async function setPtyUpdateEnabled(ptyId: string, enabled: boolean): Promise<void> {
  const pty = getPtyService();
  const result = await pty.setUpdateEnabled(asPtyId(ptyId), enabled);
  if (result instanceof Error) {
    console.warn('Failed to set PTY update enabled:', result.message);
  }
}

/** Refresh PTY state to force a fresh update for visible terminals */
export async function refreshPty(ptyId: string): Promise<void> {
  const pty = getPtyService();
  const emulator = await pty.getEmulator(asPtyId(ptyId));
  if (emulator instanceof Error) {
    console.warn('Failed to refresh PTY:', emulator.message);
    return;
  }
  emulator.refresh?.();
}

/** Apply host colors to all PTYs */
export async function applyHostColors(colors: TerminalColors): Promise<void> {
  const pty = getPtyService();

  if (isShimClient()) {
    return ShimClient.setHostColors(colors).catch((e) => {
      console.warn('Failed to apply host colors via shim:', e);
    });
  }

  const result = await pty.setHostColors(colors);
  void result;
}

/** PTY lifecycle event */
export interface PtyLifecycleEvent {
  type: 'created' | 'destroyed';
  ptyId: string;
}

/** Subscribe to PTY lifecycle events */
export function subscribeToPtyLifecycle(
  callback: (event: PtyLifecycleEvent) => void
): Promise<() => void> {
  const pty = getPtyService();
  return Promise.resolve(
    pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
      callback({ type: event.type, ptyId: event.ptyId });
    })
  );
}

/** PTY title change event */
export interface PtyTitleChangeEvent {
  ptyId: string;
  title: string;
}

/** PTY stdout activity event */
export interface PtyActivityEvent {
  ptyId: string;
}

/** PTY CWD change event */
export interface PtyCwdChangeEvent {
  ptyId: string;
  cwd: string;
}

/** Subscribe to all PTY title changes */
export function subscribeToAllTitleChanges(
  callback: (event: PtyTitleChangeEvent) => void
): Promise<() => void> {
  const pty = getPtyService();
  return Promise.resolve(
    pty.subscribeToTitle((event: { ptyId: string; title: string }) => {
      callback({ ptyId: event.ptyId, title: event.title });
    })
  );
}

/** Subscribe to stdout activity across all PTYs */
export function subscribeToAllPtyActivity(
  callback: (event: PtyActivityEvent) => void
): Promise<() => void> {
  const pty = getPtyService();
  return Promise.resolve(
    pty.subscribeToAllActivity((event: { ptyId: string }) => {
      callback({ ptyId: event.ptyId });
    })
  );
}

/** Subscribe to CWD changes across all PTYs */
export function subscribeToCwdChanges(
  callback: (event: PtyCwdChangeEvent) => void
): Promise<() => void> {
  const pty = getPtyService();
  return Promise.resolve(
    pty.subscribeToCwdChange((event: { ptyId: string; cwd: string }) => {
      callback({ ptyId: event.ptyId, cwd: event.cwd });
    })
  );
}

/** Unified metadata change event (title / process / cwd) */
export interface PtyMetadataChangeEvent {
  ptyId: string;
  title?: string;
  foregroundProcess?: string;
  cwd?: string;
}

/** Subscribe to all PTY metadata changes via a single stream.
 *  This is a derived composition of the underlying per-field registries.
 *  Keeps the PTY service interface stable while simplifying consumers. */
export function subscribeToMetadataChanges(
  callback: (event: PtyMetadataChangeEvent) => void
): Promise<() => void> {
  const pty = getPtyService();
  const cleanups: (() => void)[] = [];

  cleanups.push(pty.subscribeToTitle((e) => callback({ ptyId: e.ptyId, title: e.title })));
  cleanups.push(
    pty.subscribeToForegroundProcessChange((e) =>
      callback({ ptyId: e.ptyId, foregroundProcess: e.processName })
    )
  );
  cleanups.push(pty.subscribeToCwdChange((e) => callback({ ptyId: e.ptyId, cwd: e.cwd })));

  return Promise.resolve(() => cleanups.forEach((c) => c()));
}

/** Get PTY title */
export async function getPtyTitle(ptyId: string): Promise<string> {
  const pty = getPtyService();
  const result = await pty.getSession(asPtyId(ptyId));
  if (result instanceof Error) {
    console.warn('Failed to get PTY title:', result.message);
    return '';
  }

  if (result.title) {
    return result.title;
  }

  if (isShimClient()) {
    return ShimClient.getTitle(ptyId).catch((e) => {
      console.warn('Failed to get PTY title from shim:', e);
      return '';
    });
  }

  const emulator = await pty.getEmulator(asPtyId(ptyId));
  if (emulator instanceof Error) {
    console.warn('Failed to get PTY emulator for title lookup:', emulator.message);
    return '';
  }
  return emulator.getTitle();
}
