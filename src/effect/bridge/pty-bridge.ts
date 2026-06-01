/**
 * PTY bridge functions (errore version)
 *
 * Directly uses PTY service interface without Effect runtime.
 */

import type { Cols, Rows } from '../types';
import { asPtyId } from '../types';
import { getPriorityConfig, type PtyPriority } from '../../terminal/pty-priority';
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
import { setReadThrottleCallback } from '../../terminal/focused-pty-registry';

// Register the read throttle callback so setFocusedPty can synchronously
// update throttles on focus change, without waiting for SolidJS effects.
setReadThrottleCallback(applyPtyReadThrottle);

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

/**
 * Write data to a PTY.
 *
 * Deliberately swallows errors (logs warning) instead of returning them.
 * This is a fire-and-forget pattern for responsive typing — callers in
 * TerminalContext discard the promise so keystrokes never block on await.
 * Errors here are non-recoverable (destination PTY gone) and logging is sufficient.
 */
/** Write to a PTY synchronously — no async, no microtask hop.
 *  This bypasses the async service layer entirely, going directly
 *  to the native pty.write(). Used by the keyboard input path
 *  where latency is critical: the async service layer adds
 *  microtask hops that can delay writes by 100-500ms when the
 *  event loop is busy with background PTY I/O. */
const ptyWriteRegistry = new Map<string, (data: string) => void>();

export function registerPtyWrite(ptyId: string, writer: (data: string) => void): void {
  ptyWriteRegistry.set(ptyId, writer);
}

export function unregisterPtyWrite(ptyId: string): void {
  ptyWriteRegistry.delete(ptyId);
}

const ptyScrollOffsetRegistry = new Map<string, (offset: number) => void>();
const ptyScrollOffsetNoNotifyRegistry = new Map<string, (offset: number) => void>();

export function registerScrollOffset(ptyId: string, setter: (offset: number) => void): void {
  ptyScrollOffsetRegistry.set(ptyId, setter);
}

export function registerScrollOffsetNoNotify(
  ptyId: string,
  setter: (offset: number) => void
): void {
  ptyScrollOffsetNoNotifyRegistry.set(ptyId, setter);
}

export function unregisterScrollOffset(ptyId: string): void {
  ptyScrollOffsetRegistry.delete(ptyId);
  ptyScrollOffsetNoNotifyRegistry.delete(ptyId);
}

export function setScrollOffsetSync(ptyId: string, offset: number): void {
  const setter = ptyScrollOffsetRegistry.get(ptyId);
  if (setter) {
    setter(offset);
    return;
  }
  // Fallback to async
  void setScrollOffset(ptyId, offset);
}

/**
 * Update scroll offset without notifying subscribers.
 * Used by the scroll animator for chase steps — the viewport offset
 * changes many times per frame but the content hasn't changed,
 * so calling notifySubscribers (with its FFI calls and possible cell
 * conversion) on every step is wasteful and blocks the main thread.
 * The render picks up the latest offset from the session state directly.
 */
// Cache updater for scroll offset (no notification).
// When the animator updates the offset without notifying subscribers,
// we still need to keep the TerminalContext's cache in sync so
// the next onAnimate call doesn't misinterpret stale cache values
// as external adjustments.
const scrollCacheUpdateRegistry = new Map<string, (offset: number) => void>();

export function registerScrollCacheUpdate(ptyId: string, updater: (offset: number) => void): void {
  scrollCacheUpdateRegistry.set(ptyId, updater);
}

export function unregisterScrollCacheUpdate(ptyId: string): void {
  scrollCacheUpdateRegistry.delete(ptyId);
}

export function setScrollOffsetNoNotify(ptyId: string, offset: number): void {
  const setter = ptyScrollOffsetNoNotifyRegistry.get(ptyId);
  if (setter) {
    setter(offset);
  }
  const cacheUpdater = scrollCacheUpdateRegistry.get(ptyId);
  if (cacheUpdater) {
    cacheUpdater(offset);
  }
}

// Scroll animation render callback — called once per frame after all
// animation ticks complete. Bypasses notifySubscribers entirely.
const scrollAnimRenderRegistry = new Map<string, (offset: number) => void>();

export function registerScrollAnimRender(ptyId: string, render: (offset: number) => void): void {
  scrollAnimRenderRegistry.set(ptyId, render);
}

export function unregisterScrollAnimRender(ptyId: string): void {
  scrollAnimRenderRegistry.delete(ptyId);
}

export function requestScrollAnimRender(ptyId: string, offset: number): void {
  const render = scrollAnimRenderRegistry.get(ptyId);
  if (render) {
    render(offset);
  }
}

const ptyUpdateEnabledRegistry = new Map<string, (enabled: boolean) => void>();

export function registerUpdateEnabled(ptyId: string, setter: (enabled: boolean) => void): void {
  ptyUpdateEnabledRegistry.set(ptyId, setter);
}

export function unregisterUpdateEnabled(ptyId: string): void {
  ptyUpdateEnabledRegistry.delete(ptyId);
}

export function setUpdateEnabledSync(ptyId: string, enabled: boolean): void {
  const setter = ptyUpdateEnabledRegistry.get(ptyId);
  if (setter) {
    setter(enabled);
    return;
  }
  // Fallback to async
  void setPtyUpdateEnabled(ptyId, enabled);
}

let _lastSyncWriteTime = 0;
export function writeToPtySync(ptyId: string, data: string): void {
  _lastSyncWriteTime = performance.now();
  const writer = ptyWriteRegistry.get(ptyId);
  if (writer) {
    writer(data);
    // After a keyboard write, flush any already-processed emulator state
    // and schedule a render. This ensures the visual effect of Ctrl+C,
    // typed characters, etc. appears in the same event loop tick as the
    // keystroke, rather than waiting for the next drain cycle.
    // Without this, a microtask or setTimeout(0) delay is added before
    // the emulator's pendingUpdate propagates to the subscriber and renders.
    flushPtyData(ptyId);
    return;
  }
  // Fallback to async if no sync writer registered
  void writeToPty(ptyId, data);
}

export async function writeToPty(ptyId: string, data: string): Promise<void> {
  const pty = getPtyService();
  const result = await pty.write(asPtyId(ptyId), data);
  if (result instanceof Error) {
    console.warn('Failed to write to PTY:', result.message);
  }
}

/**
 * Send focus event to a PTY.
 *
 * Fire-and-forget: errors are logged but not returned. Focus events are
 * best-effort and should not block UI interaction.
 */
export async function sendPtyFocusEvent(ptyId: string, focused: boolean): Promise<void> {
  const pty = getPtyService();
  const result = await pty.sendFocusEvent(asPtyId(ptyId), focused);
  if (result instanceof Error) {
    console.warn('Failed to send focus event:', result.message);
  }
}

/**
 * Resize a PTY.
 *
 * Fire-and-forget: errors are logged but not returned. Resize failures
 * are non-critical — the PTY will simply render at its current size until
 * the next successful resize.
 */
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

/** Flush buffered PTY data (replay raw buffer + drain pending segments). */
const flushDataRegistry = new Map<string, () => void>();

/** Read-throttle setter for PTYs (setReadThrottleMs). */
const throttleRegistry = new Map<string, (ms: number) => void>();

/** Register a flush function for a PTY (called by session-factory). */
export function registerFlushData(ptyId: string, flush: () => void): void {
  flushDataRegistry.set(ptyId, flush);
}

/** Unregister a flush function (called on PTY destroy). */
export function unregisterFlushData(ptyId: string): void {
  flushDataRegistry.delete(ptyId);
  throttleRegistry.delete(ptyId);
}

/** Flush buffered PTY data (replay raw buffer + drain pending segments). */
export function flushPtyData(ptyId: string): void {
  const flush = flushDataRegistry.get(ptyId);
  if (flush) flush();
}

const incrementalFlushRegistry = new Map<string, () => void>();

export function registerIncrementalFlush(ptyId: string, flush: () => void): void {
  incrementalFlushRegistry.set(ptyId, flush);
}

export function unregisterIncrementalFlush(ptyId: string): void {
  incrementalFlushRegistry.delete(ptyId);
}

/** Flush buffered PTY data incrementally (capped, not full pipeline). */
export function flushPtyDataIncremental(ptyId: string): void {
  const flush = incrementalFlushRegistry.get(ptyId);
  if (flush) flush();
}

const rawDrainRegistry = new Map<string, () => void>();

export function registerRawDrain(ptyId: string, drain: () => void): void {
  rawDrainRegistry.set(ptyId, drain);
}

export function unregisterRawDrain(ptyId: string): void {
  rawDrainRegistry.delete(ptyId);
}

/** Drain raw buffer directly to emulator (bypasses processChunk pipeline). */
export function drainRawToEmulator(ptyId: string): void {
  const drain = rawDrainRegistry.get(ptyId);
  if (drain) drain();
}

/** Register a read-throttle setter for a PTY (called by session-factory). */
export function registerReadThrottle(ptyId: string, setter: (ms: number) => void): void {
  throttleRegistry.set(ptyId, setter);
}

/** Set the read throttle for a PTY based on its current priority. */
export function applyPtyReadThrottle(ptyId: string, priority: PtyPriority): void {
  const setter = throttleRegistry.get(ptyId);
  if (setter) {
    setter(getPriorityConfig(priority).readThrottleMs);
  }
}

/** Temporarily wake a paused read loop to drain one batch from the kernel buffer. */
export function wakeReadLoopOnce(ptyId: string, _priority: PtyPriority): void {
  const setter = throttleRegistry.get(ptyId);
  if (setter) {
    // Temporarily set a real throttle so the read loop reads one batch.
    // The pulse will set it back to paused after draining.
    setter(0); // focused speed = read immediately
  }
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
