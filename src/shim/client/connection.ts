import net from 'net';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import type { Buffer } from 'buffer';
import * as errore from 'errore';

import { getHostColors } from '../../terminal/terminal-colors';
import {
  encodeFrame,
  FrameReader,
  SHIM_SOCKET_DIR,
  SHIM_SOCKET_PATH,
  type ShimHeader,
} from '../protocol';
import { createFrameHandler, type FrameHandlerDeps } from './frame-handler';
import { createSocketDataStream } from './socket-stream';
import { ShimConnectionError } from '../../effect/errors';

const CLIENT_VERSION = 1;
const CLIENT_ID = `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;

type PendingRequest = {
  resolve: (value: { header: ShimHeader; payloads: Buffer[] }) => void;
  reject: (error: Error) => void;
};

const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;
let socket: net.Socket | null = null;
let reader: FrameReader | null = null;
let connecting: Promise<void | ShimConnectionError> | null = null;
let spawnAttempted = false;
let shimPid: number | null = null;
let detached = false;
let socketDataStop: (() => void) | null = null;

const detachedSubscribers = new Set<() => void>();

function handleResponseFrame(header: ShimHeader, payloads: Buffer[]): boolean {
  if (header.type !== 'response' || header.requestId === undefined) {
    return false;
  }

  const pending = pendingRequests.get(header.requestId);
  if (!pending) return false;

  pendingRequests.delete(header.requestId);
  if (header.ok) {
    pending.resolve({ header, payloads });
  } else {
    pending.reject(new Error(header.error ?? 'Shim request failed'));
  }

  return true;
}

const handleFrame = createFrameHandler({
  onResponse: handleResponseFrame,
  onDetached: () => {
    markDetached();
  },
} satisfies FrameHandlerDeps);

async function connectSocket(): Promise<void | ShimConnectionError> {
  const mkdirResult = await errore.tryAsync<string | undefined, ShimConnectionError>({
    try: () => fs.mkdir(SHIM_SOCKET_DIR, { recursive: true }),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to create socket directory: ${e}`, cause: e }),
  });
  if (mkdirResult instanceof ShimConnectionError) return mkdirResult;

  const connectResult = await errore.tryAsync<void, ShimConnectionError>({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const client = net.createConnection(SHIM_SOCKET_PATH);
        const handleError = (error: Error) => {
          client.removeListener('connect', handleConnect);
          reject(error);
        };
        const handleConnect = () => {
          client.removeListener('error', handleError);
          socket = client;
          reader = new FrameReader();
          client.on('error', () => {
            // ignore, reconnect on demand
          });
          client.on('close', () => {
            socketDataStop?.();
            socketDataStop = null;
            socket = null;
            reader = null;
            markDetached();
          });
          socketDataStop?.();
          socketDataStop = createSocketDataStream(client, reader, handleFrame);
          resolve();
        };
        client.once('error', handleError);
        client.once('connect', handleConnect);
      }),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to connect to socket: ${e}`, cause: e }),
  });
  if (connectResult instanceof ShimConnectionError) return connectResult;

  const helloResult = await errore.tryAsync<
    { header: ShimHeader; payloads: Buffer[] },
    ShimConnectionError
  >({
    try: () => sendRequest('hello', { clientId: CLIENT_ID, version: CLIENT_VERSION }),
    catch: (e) => {
      if (e instanceof Error && e.message.toLowerCase().includes('detached')) {
        socket?.destroy();
        socket = null;
        reader = null;
        markDetached();
      }
      return new ShimConnectionError({ reason: `Hello request failed: ${e}` });
    },
  });
  if (helloResult instanceof ShimConnectionError) return helloResult;

  const helloData = helloResult.header.result as { pid?: number } | undefined;
  if (helloData && typeof helloData.pid === 'number') {
    shimPid = helloData.pid;
  }

  const colors = getHostColors();
  if (colors) {
    await sendRequest('setHostColors', { colors });
  }
}

function spawnShimProcess(): void {
  if (spawnAttempted) return;
  spawnAttempted = true;

  const baseArgs = process.argv.slice(1).filter((arg) => arg !== '--shim');
  const executable = process.execPath || process.argv[0] || 'openmux';
  const args = [...baseArgs, '--shim'];

  if (typeof Bun !== 'undefined' && typeof Bun.spawn === 'function') {
    Bun.spawn([executable, ...args], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      detached: true,
    });
    return;
  }

  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function connectWithRetry(attempts = 25, delayMs = 120): Promise<void | ShimConnectionError> {
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    const result = await connectSocket();
    if (!(result instanceof ShimConnectionError)) return;

    lastError = result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastError instanceof ShimConnectionError
    ? lastError
    : new ShimConnectionError({ reason: 'Failed to connect to shim after retries' });
}

async function ensureConnectedWithoutSpawn(): Promise<boolean> {
  if (socket && !socket.destroyed) return true;

  const result = await connectWithRetry(3, 80);
  return !(result instanceof ShimConnectionError);
}

async function ensureConnected(): Promise<void | ShimConnectionError> {
  if (detached) {
    return new ShimConnectionError({ reason: 'Shim client detached' });
  }
  if (socket && !socket.destroyed) return;

  if (connecting) {
    const result = await connecting;
    return result instanceof ShimConnectionError ? result : undefined;
  }

  connecting = (async (): Promise<void | ShimConnectionError> => {
    const result = await connectSocket();
    if (result instanceof ShimConnectionError) {
      if (detached) return result;

      spawnShimProcess();
      const retryResult = await connectWithRetry();
      return retryResult;
    }
    return;
  })();

  try {
    const result = await connecting;
    return result instanceof ShimConnectionError ? result : undefined;
  } finally {
    connecting = null;
  }
}

export async function sendRequestDirect(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = [],
  timeoutMs?: number
): Promise<{ header: ShimHeader; payloads: Buffer[] } | ShimConnectionError> {
  if (!socket || socket.destroyed) {
    return new ShimConnectionError({ reason: 'Shim socket not available' });
  }

  const requestId = nextRequestId++;
  const header: ShimHeader = {
    type: 'request',
    requestId,
    method,
    params,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  };

  return new Promise((resolve) => {
    pendingRequests.set(requestId, {
      resolve,
      reject: (error) => resolve(new ShimConnectionError({ reason: error.message })),
    });

    if (timeoutMs) {
      setTimeout(() => {
        if (!pendingRequests.has(requestId)) return;
        pendingRequests.delete(requestId);
        resolve(new ShimConnectionError({ reason: 'Shim request timed out' }));
      }, timeoutMs);
    }

    socket?.write(encodeFrame(header, payloads), (err) => {
      if (!err) return;
      pendingRequests.delete(requestId);
      resolve(new ShimConnectionError({ reason: err.message }));
    });
  });
}

export async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = []
): Promise<{ header: ShimHeader; payloads: Buffer[] }> {
  const connectResult = await ensureConnected();
  if (connectResult instanceof ShimConnectionError) throw connectResult;
  if (!socket) throw new ShimConnectionError({ reason: 'Shim socket not available' });

  const requestId = nextRequestId++;
  const header: ShimHeader = {
    type: 'request',
    requestId,
    method,
    params,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    socket?.write(encodeFrame(header, payloads));
  });
}

export function onShimDetached(callback: () => void): () => void {
  detachedSubscribers.add(callback);
  return () => {
    detachedSubscribers.delete(callback);
  };
}

export async function shutdownShim(): Promise<void> {
  if (connecting) {
    await connecting.catch((e) => {
      console.warn('[shim-client] Connection cleanup failed during shutdown:', e);
    });
  }

  const connected = await ensureConnectedWithoutSpawn();
  if (connected) {
    const shutdownResult = await sendRequestDirect('shutdown', undefined, [], 500);
    if (!(shutdownResult instanceof ShimConnectionError)) return;
  }

  if (!shimPid) return;

  try {
    process.kill(shimPid);
  } catch {
    // Ignore kill errors
  }
}

export async function waitForShim(): Promise<void | ShimConnectionError> {
  const result = await ensureConnected();
  if (result instanceof ShimConnectionError) {
    return result;
  }
}

function markDetached(): void {
  if (detached) return;
  detached = true;
  for (const callback of detachedSubscribers) {
    callback();
  }
}

export { handlePtyNotification } from './frame-handler';
