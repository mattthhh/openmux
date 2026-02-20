import net from 'net';

import { ResourceStack } from '../effect/resources.js';
import { CONTROL_SOCKET_PATH, encodeFrame, FrameReader, type ControlHeader } from './protocol';

type PendingRequest = {
  resolve: (value: { header: ControlHeader; payloads: Buffer[] }) => void;
  reject: (error: Error) => void;
};

export class ControlClientError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export class ControlClient {
  private socket: net.Socket;
  private reader: FrameReader;
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.reader = new FrameReader();

    socket.on('data', (chunk) => {
      this.reader.feed(chunk as Buffer, (header, payloads) => {
        if (header.type !== 'response' || header.requestId === undefined) return;
        const pending = this.pending.get(header.requestId);
        if (pending) {
          this.pending.delete(header.requestId);
          if (header.ok) {
            pending.resolve({ header, payloads });
          } else {
            const message = header.error ?? 'Control request failed';
            pending.reject(new ControlClientError(message, header.errorCode as string | undefined));
          }
        }
      });
    });
  }

  request(method: string, params?: Record<string, unknown>, timeoutMs = 2000): Promise<{ header: ControlHeader; payloads: Buffer[] }> {
    const requestId = this.nextRequestId++;
    const header: ControlHeader = {
      type: 'request',
      requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (this.pending.has(requestId)) {
              this.pending.delete(requestId);
              reject(new Error('Control request timed out'));
            }
          }, timeoutMs)
        : null;

      this.pending.set(requestId, {
        resolve: (result) => {
          if (timer) clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });

      this.socket.write(encodeFrame(header), (err) => {
        if (err) {
          this.pending.delete(requestId);
          if (timer) clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

export async function connectControlClient(options?: {
  socketPath?: string;
  timeoutMs?: number;
}): Promise<ControlClient> {
  const socketPath = options?.socketPath ?? CONTROL_SOCKET_PATH;
  const timeoutMs = options?.timeoutMs ?? 500;

  const client = net.createConnection(socketPath);
  const resources = new ResourceStack();

  return new Promise<ControlClient>((resolve, reject) => {
    let settled = false;

    const cleanupAndResolve = (result: ControlClient) => {
      if (settled) return;
      settled = true;
      // Dispose resources after resolving - they did their job
      void resources[Symbol.asyncDispose]();
      resolve(result);
    };

    const cleanupAndReject = (error: Error) => {
      if (settled) return;
      settled = true;
      // Dispose resources before rejecting
      void resources[Symbol.asyncDispose]().finally(() => reject(error));
    };

    const handleConnect = () => {
      cleanupAndResolve(new ControlClient(client));
    };

    const handleError = (error: Error) => {
      cleanupAndReject(error);
    };

    client.once('connect', handleConnect);
    client.once('error', handleError);

    resources.defer(() => {
      client.removeListener('connect', handleConnect);
    });
    resources.defer(() => {
      client.removeListener('error', handleError);
    });

    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        cleanupAndReject(new Error('Control socket connection timed out'));
      }, timeoutMs);
      resources.registerTimer(timer);
    }
  });
}
