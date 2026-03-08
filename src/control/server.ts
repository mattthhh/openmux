import net from 'net';
import fs from 'fs/promises';
import { tryAsync } from 'errore';
import { createTaggedError } from 'errore';

import type { TerminalScrollState, TerminalState, Workspace, WorkspaceId } from '../core/types';
import type { LayoutState } from '../core/operations/layout-actions';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import type { SessionMetadata } from '../core/types';
import { SessionStorageError } from '../effect/errors';
import { CONTROL_PROTOCOL_VERSION, CONTROL_SOCKET_DIR, CONTROL_SOCKET_PATH, encodeFrame, FrameReader, type ControlHeader } from './protocol';
import { parsePaneSelector, resolvePaneSelector } from './targets';
import { captureEmulator, type CaptureFormat } from './capture';

export type ControlServerDeps = {
  getLayoutState: () => LayoutState;
  getActiveWorkspace: () => Workspace;
  switchWorkspace: (workspaceId: WorkspaceId) => void;
  focusPane: (paneId: string) => void;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  writeToPty: (ptyId: string, data: string) => void;
  getEmulator: (ptyId: string) => ITerminalEmulator | null;
  fetchTerminalState: (ptyId: string, options?: { force?: boolean }) => Promise<TerminalState | null>;
  fetchScrollState: (ptyId: string, options?: { force?: boolean }) => Promise<TerminalScrollState | null>;
  capturePty?: (ptyId: string, options: { lines: number; format: CaptureFormat; raw?: boolean }) => Promise<string | null>;
  isPtyActive: (ptyId: string) => boolean;
  createSession: (name?: string) => Promise<SessionMetadata | SessionStorageError>;
  getActiveSessionId: () => string | null | undefined;
};

export type ControlServer = {
  close: () => Promise<void>;
  socketPath: string;
};

type ControlErrorCode = 'invalid_request' | 'not_found' | 'ambiguous' | 'internal' | 'session_creation_failed';

/** Error processing control request */
export class ControlRequestError extends createTaggedError({
  name: 'ControlRequestError',
  message: 'Control request failed: $reason',
}) {
  code: ControlErrorCode = 'internal';
}

function parseWorkspaceId(value: unknown): WorkspaceId | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const intValue = Math.floor(value);
  if (intValue < 1 || intValue > 9) return undefined;
  return intValue as WorkspaceId;
}

function parseCaptureFormat(value: unknown): CaptureFormat | null {
  if (value === undefined) return 'text';
  if (value === 'text' || value === 'ansi') return value;
  return null;
}

function getNumberParam(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

async function handleHello(
  requestId: number,
  deps: ControlServerDeps,
  sendResponse: (requestId: number, result?: unknown) => void
): Promise<void> {
  sendResponse(requestId, {
    pid: process.pid,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    activeSessionId: deps.getActiveSessionId() ?? null,
  });
}

async function handleSessionCreate(
  requestId: number,
  params: Record<string, unknown>,
  deps: ControlServerDeps,
  sendResponse: (requestId: number, result?: unknown) => void,
  sendError: (requestId: number, message: string, code: ControlErrorCode) => void
): Promise<void> {
  const name = typeof params.name === 'string' ? params.name : undefined;
  const result = await deps.createSession(name);
  if (result instanceof SessionStorageError) {
    sendError(requestId, result.message, 'session_creation_failed');
    return;
  }
  sendResponse(requestId, { session: result });
}

async function handlePaneSplit(
  requestId: number,
  params: Record<string, unknown>,
  deps: ControlServerDeps,
  sendResponse: (requestId: number, result?: unknown) => void,
  sendError: (requestId: number, message: string, code: ControlErrorCode) => void
): Promise<ControlRequestError | void> {
  const direction = params.direction;
  if (direction !== 'horizontal' && direction !== 'vertical') {
    sendError(requestId, 'Invalid direction; use horizontal or vertical.', 'invalid_request');
    return;
  }

  const selectorParse = parsePaneSelector(
    typeof params.pane === 'string' ? params.pane : undefined
  );
  if (!selectorParse.ok) {
    sendError(requestId, selectorParse.error, 'invalid_request');
    return;
  }
  if (selectorParse.selector.type === 'pty') {
    sendError(requestId, 'PTY selectors cannot be split.', 'invalid_request');
    return;
  }

  const workspaceId = parseWorkspaceId(params.workspaceId);
  const layoutState = deps.getLayoutState();
  const activeWorkspace = deps.getActiveWorkspace();
  const resolved = resolvePaneSelector({
    selector: selectorParse.selector,
    layoutState,
    activeWorkspace,
    workspaceId,
  });

  if (!resolved.ok) {
    sendError(requestId, resolved.message, resolved.errorCode);
    return;
  }

  if (activeWorkspace.id !== resolved.workspaceId) {
    deps.switchWorkspace(resolved.workspaceId);
  }
  deps.focusPane(resolved.pane.id);
  deps.splitPane(direction);
  sendResponse(requestId, { ok: true });
}

async function handlePaneSend(
  requestId: number,
  params: Record<string, unknown>,
  deps: ControlServerDeps,
  sendResponse: (requestId: number, result?: unknown) => void,
  sendError: (requestId: number, message: string, code: ControlErrorCode) => void
): Promise<void> {
  const text = typeof params.text === 'string' ? params.text : null;
  if (!text) {
    sendError(requestId, 'Missing --text payload.', 'invalid_request');
    return;
  }

  const selectorParse = parsePaneSelector(
    typeof params.pane === 'string' ? params.pane : undefined
  );
  if (!selectorParse.ok) {
    sendError(requestId, selectorParse.error, 'invalid_request');
    return;
  }

  const workspaceId = parseWorkspaceId(params.workspaceId);
  const layoutState = deps.getLayoutState();
  const activeWorkspace = deps.getActiveWorkspace();
  const resolved = resolvePaneSelector({
    selector: selectorParse.selector,
    layoutState,
    activeWorkspace,
    workspaceId,
  });

  if (!resolved.ok) {
    sendError(requestId, resolved.message, resolved.errorCode);
    return;
  }

  const ptyId = resolved.pane.ptyId;
  if (!ptyId) {
    sendError(requestId, 'Pane has no PTY.', 'not_found');
    return;
  }

  deps.writeToPty(ptyId, text);
  sendResponse(requestId, { ok: true });
}

async function handlePaneCapture(
  requestId: number,
  params: Record<string, unknown>,
  deps: ControlServerDeps,
  sendResponse: (requestId: number, result?: unknown) => void,
  sendError: (requestId: number, message: string, code: ControlErrorCode) => void
): Promise<void> {
  const selectorParse = parsePaneSelector(
    typeof params.pane === 'string' ? params.pane : undefined
  );
  if (!selectorParse.ok) {
    sendError(requestId, selectorParse.error, 'invalid_request');
    return;
  }

  const format = parseCaptureFormat(params.format);
  if (!format) {
    sendError(requestId, 'Invalid format; use text or ansi.', 'invalid_request');
    return;
  }

  const lines = Math.max(1, Math.floor(getNumberParam(params.lines, 200)));
  const raw = params.raw === true;
  const workspaceId = parseWorkspaceId(params.workspaceId);
  const layoutState = deps.getLayoutState();
  const activeWorkspace = deps.getActiveWorkspace();
  const resolved = resolvePaneSelector({
    selector: selectorParse.selector,
    layoutState,
    activeWorkspace,
    workspaceId,
  });

  if (!resolved.ok) {
    sendError(requestId, resolved.message, resolved.errorCode);
    return;
  }

  const ptyId = resolved.pane.ptyId;
  if (!ptyId) {
    sendError(requestId, 'Pane has no PTY.', 'not_found');
    return;
  }

  if (deps.capturePty) {
    const captureResult = await tryAsync<string, ControlRequestError>({
      try: async () => {
        const result = await deps.capturePty!(ptyId, { lines, format, raw });
        if (result === null) {
          throw new Error('Capture returned null');
        }
        return result;
      },
      catch: (e: unknown) => new ControlRequestError({ reason: String(e) }),
    });
    if (!(captureResult instanceof ControlRequestError)) {
      sendResponse(requestId, { text: captureResult, format, lines });
      return;
    }
  }

  const emulator = deps.getEmulator(ptyId);
  if (!emulator || emulator.isDisposed) {
    sendError(requestId, 'PTY emulator not available.', 'not_found');
    return;
  }

  await deps.fetchTerminalState(ptyId, { force: true }).catch((e) => {
    console.warn(`[control] Failed to fetch terminal state for ${ptyId}:`, e);
  });
  await deps.fetchScrollState(ptyId, { force: true }).catch((e) => {
    console.warn(`[control] Failed to fetch scroll state for ${ptyId}:`, e);
  });

  const state = emulator.getTerminalState();
  const scrollbackLength = emulator.getScrollbackLength();

  if (state.rows === 0 && scrollbackLength === 0) {
    sendResponse(requestId, { text: '', format, lines });
    return;
  }

  const totalLines = scrollbackLength + state.rows;
  const start = Math.max(0, totalLines - lines);
  if (start < scrollbackLength && 'prefetchScrollbackLines' in emulator) {
    const end = Math.min(scrollbackLength, start + lines);
    const count = Math.max(0, end - start);
    if (count > 0) {
      await (emulator as { prefetchScrollbackLines: (offset: number, count: number) => Promise<void> })
        .prefetchScrollbackLines(start, count);
    }
  }

  const text = captureEmulator(emulator, {
    lines,
    format,
    trimTrailing: !raw,
    trimTrailingLines: !raw,
  });
  sendResponse(requestId, { text, format, lines });
}

export async function startControlServer(deps: ControlServerDeps): Promise<ControlServer> {
  await fs.mkdir(CONTROL_SOCKET_DIR, { recursive: true });
  await fs.unlink(CONTROL_SOCKET_PATH).catch((e) => {
    console.warn('[control] Failed to unlink control socket:', e);
  });

  const server = net.createServer((socket) => {
    const reader = new FrameReader();

    const sendResponse = (requestId: number, result?: unknown) => {
      const header: ControlHeader = {
        type: 'response',
        requestId,
        ok: true,
        result,
      };
      socket.write(encodeFrame(header));
    };

    const sendError = (requestId: number, message: string, code: ControlErrorCode = 'internal') => {
      const header: ControlHeader = {
        type: 'response',
        requestId,
        ok: false,
        error: message,
        errorCode: code,
      };
      socket.write(encodeFrame(header));
    };

    const handleRequest = async (header: ControlHeader) => {
      const requestId = header.requestId;
      if (!requestId) return;
      const method = header.method as string | undefined;
      const params = (header.params as Record<string, unknown>) ?? {};

      const result = await tryAsync<void, ControlRequestError>({
        try: async () => {
          switch (method) {
            case 'hello':
              await handleHello(requestId, deps, sendResponse);
              return;
            case 'session.create':
              await handleSessionCreate(requestId, params, deps, sendResponse, sendError);
              return;
            case 'pane.split':
              await handlePaneSplit(requestId, params, deps, sendResponse, sendError);
              return;
            case 'pane.send':
              await handlePaneSend(requestId, params, deps, sendResponse, sendError);
              return;
            case 'pane.capture':
              await handlePaneCapture(requestId, params, deps, sendResponse, sendError);
              return;
            default:
              sendError(requestId, `Unknown method: ${method}`, 'invalid_request');
          }
        },
        catch: (e: unknown) => new ControlRequestError({ reason: e instanceof Error ? e.message : 'Request failed' }),
      });

      if (result instanceof ControlRequestError) {
        sendError(requestId, result.message, 'internal');
      }
    };

    socket.on('data', (chunk) => {
      reader.feed(chunk as Buffer, (header) => {
        if (header.type !== 'request') return;
        void handleRequest(header);
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(CONTROL_SOCKET_PATH, () => resolve());
  });

  return {
    socketPath: CONTROL_SOCKET_PATH,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.unlink(CONTROL_SOCKET_PATH).catch((e) => {
        console.warn('[control] Failed to unlink control socket on close:', e);
      });
    },
  };
}
