/**
 * PTY Operations - core operations for managing PTY sessions (errore version)
 */
import type { TerminalState } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import { PtyNotFoundError, PtyOperationError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import * as errore from 'errore';
import type { PtySession } from '../../models';
import type { InternalPtySession } from './types';
import type { PtyState } from './state';
import { notifySubscribers, notifyScrollSubscribers } from './notification';
import { HOT_SCROLLBACK_LIMIT } from '../../../terminal/scrollback-config';
import type { SubscriptionRegistry } from './subscription-manager';
import { tracePtyEvent, tracePtyChunk } from '../../../terminal/pty-trace';

const FOCUS_IN_SEQUENCE = '\x1b[I';
const FOCUS_OUT_SEQUENCE = '\x1b[O';

function normalizeProcessName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const normalized = base.replace(/^-+/, '').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getShellProcessName(session: InternalPtySession): string | null {
  return normalizeProcessName(session.shell);
}

function getForegroundProcessName(session: InternalPtySession): string | null {
  const result = errore.try<string, PtyOperationError>({
    try: () => normalizeProcessName(session.pty.getForegroundProcessName()) ?? '',
    catch: (cause: unknown) =>
      new PtyOperationError({
        operation: 'get-foreground-process',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
  if (result instanceof PtyOperationError) return null;
  return result || null;
}

export interface OperationsDeps {
  sessions: PtyState;
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>;
}

export function createOperations(deps: OperationsDeps) {
  const { sessions, lifecycleRegistry } = deps;

  function getSessionOrFail(id: PtyId): InternalPtySession | PtyNotFoundError {
    const session = sessions.get(id);
    if (!session) {
      return new PtyNotFoundError({ ptyId: id });
    }
    return session;
  }

  async function write(id: PtyId, data: string): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    // Auto-scroll to bottom when user types
    if (session.scrollState.viewportOffset > 0) {
      session.scrollState.viewportOffset = 0;
      notifySubscribers(session);
      notifyScrollSubscribers(session);
    }

    session.pty.write(data);
  }

  async function sendFocusEvent(id: PtyId, focused: boolean): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;
    session.focusState = focused;

    const shellProcess = getShellProcessName(session);
    const foregroundProcess = getForegroundProcessName(session);

    if (
      session.focusTrackingEnabled &&
      shellProcess &&
      foregroundProcess === shellProcess &&
      session.focusTrackingOwnerProcess &&
      session.focusTrackingOwnerProcess !== shellProcess
    ) {
      tracePtyEvent('pty-focus-tracking-stale-reset', {
        ptyId: id,
        ownerProcess: session.focusTrackingOwnerProcess,
        shellProcess,
        foregroundProcess,
      });
      session.focusTrackingEnabled = false;
      session.focusTrackingOwnerProcess = null;
    }

    const sequence = focused ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE;
    tracePtyEvent('pty-focus-send', {
      ptyId: id,
      focused,
      trackingEnabled: session.focusTrackingEnabled,
      ownerProcess: session.focusTrackingOwnerProcess,
      shellProcess,
      foregroundProcess,
    });
    tracePtyChunk('pty-focus-seq', sequence, { ptyId: id });
    if (!session.focusTrackingEnabled) return;
    session.pty.write(sequence);
  }

  async function resize(
    id: PtyId,
    cols: Cols,
    rows: Rows,
    pixelWidth?: number,
    pixelHeight?: number
  ): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const hasPixels =
      typeof pixelWidth === 'number' &&
      pixelWidth > 0 &&
      typeof pixelHeight === 'number' &&
      pixelHeight > 0;

    if (hasPixels && 'resizeWithPixels' in session.pty) {
      session.pty.resizeWithPixels(cols, rows, pixelWidth, pixelHeight);
    } else {
      session.pty.resize(cols, rows);
    }
    session.cols = cols;
    session.rows = rows;
    if (hasPixels) {
      session.pixelWidth = pixelWidth;
      session.pixelHeight = pixelHeight;
      session.cellWidth = Math.max(1, Math.floor(pixelWidth / cols));
      session.cellHeight = Math.max(1, Math.floor(pixelHeight / rows));
    } else {
      session.pixelWidth = cols * session.cellWidth;
      session.pixelHeight = rows * session.cellHeight;
    }
    session.emulator.resize(cols, rows);
    session.emulator.setPixelSize?.(session.pixelWidth, session.pixelHeight);

    // Record resize timestamp for clear-screen suppression
    session.lastResizeTime = Date.now();

    // Check if DECSET 2048 (in-band resize notifications) is enabled
    const modeResult = errore.try<boolean | null, PtyOperationError>({
      try: () => session.emulator.getMode(2048),
      catch: (cause: unknown) =>
        new PtyOperationError({
          operation: 'get-mode-2048',
          reason: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (!(modeResult instanceof PtyOperationError) && modeResult) {
      const resizeNotification = `\x1b[48;${rows};${cols};${session.pixelHeight};${session.pixelWidth}t`;
      session.pty.write(resizeNotification);
    }

    // Note: Emulator.resize() now defers prepareUpdate to ensure native reflow completes
    // before notifying subscribers. No need to call notifySubscribers here.
  }

  async function getCwd(id: PtyId): Promise<PtyNotFoundError | string> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    if (session.cwdReported === true || session.pty.pid === undefined) {
      return session.cwd;
    }

    // Fall back to the native PTY lookup when the shell has not reported cwd updates yet.
    const cwd = session.pty.getCwd();
    if (cwd) {
      session.cwd = cwd;
      return cwd;
    }

    return session.cwd;
  }

  async function destroy(id: PtyId): Promise<void> {
    const session = sessions.get(id);
    if (!session) return;

    if (session.closing) {
      return;
    }
    session.closing = true;

    session.unifiedSubscribers.clear();
    session.titleSubscribers.clear();
    session.exitCallbacks.clear();

    // Kill PTY and dispose emulator
    session.pty.kill();
    session.emulator.dispose();
    session.kittyRelayDispose?.();
    session.queryPassthrough.dispose();

    // Remove from map BEFORE emitting lifecycle event
    sessions.delete(id);

    // Emit lifecycle event AFTER removal
    lifecycleRegistry.notify({ type: 'destroyed', ptyId: id });
  }

  async function getSession(id: PtyId): Promise<PtyNotFoundError | PtySession> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    return {
      id: session.id,
      pid: session.pty.pid ?? 0,
      cols: session.cols as Cols,
      rows: session.rows as Rows,
      cwd: session.cwd,
      shell: session.shell,
      title: session.emulator.getTitle() || undefined,
      lastCommand: session.lastCommand ?? undefined,
    };
  }

  async function getTerminalState(id: PtyId): Promise<PtyNotFoundError | TerminalState> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;
    return session.emulator.getTerminalState();
  }

  async function getScrollState(id: PtyId): Promise<
    | PtyNotFoundError
    | {
        viewportOffset: number;
        scrollbackLength: number;
        isAtBottom: boolean;
        isAtScrollbackLimit?: boolean;
      }
  > {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;
    const scrollbackLength = session.emulator.getScrollbackLength();
    const isAtScrollbackLimit = session.liveEmulator.getScrollbackLength() >= HOT_SCROLLBACK_LIMIT;

    return {
      viewportOffset: session.scrollState.viewportOffset,
      scrollbackLength,
      isAtBottom: session.scrollState.viewportOffset === 0,
      isAtScrollbackLimit,
    };
  }

  async function setScrollOffset(id: PtyId, offset: number): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;
    const maxOffset = session.emulator.getScrollbackLength();
    session.scrollState.viewportOffset = Math.max(0, Math.min(offset, maxOffset));
    notifyScrollSubscribers(session);
  }

  async function setUpdateEnabled(id: PtyId, enabled: boolean): Promise<PtyNotFoundError | void> {
    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return sessionOrError;
    }
    const session = sessionOrError;
    session.emulator.setUpdateEnabled?.(enabled);
  }

  function getEmulator(id: PtyId, options: { sync: true }): ITerminalEmulator | null;
  function getEmulator(
    id: PtyId,
    options?: { sync?: false }
  ): Promise<PtyNotFoundError | ITerminalEmulator>;
  function getEmulator(
    id: PtyId,
    options: { sync?: boolean } = {}
  ): ITerminalEmulator | null | Promise<PtyNotFoundError | ITerminalEmulator> {
    if (options.sync) {
      return sessions.get(id)?.emulator ?? null;
    }

    const sessionOrError = getSessionOrFail(id);
    if (sessionOrError instanceof PtyNotFoundError) {
      return Promise.resolve(sessionOrError);
    }

    return Promise.resolve(sessionOrError.emulator);
  }

  async function destroyAll(): Promise<void> {
    const ids = Array.from(sessions.keys());
    for (const id of ids) {
      await destroy(id);
    }
  }

  async function listAll(): Promise<PtyId[]> {
    return Array.from(sessions.keys());
  }

  return {
    write,
    sendFocusEvent,
    resize,
    getCwd,
    destroy,
    getSession,
    getTerminalState,
    getScrollState,
    setScrollOffset,
    setUpdateEnabled,
    getEmulator,
    destroyAll,
    listAll,
    getSessionOrFail,
  };
}
