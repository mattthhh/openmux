import net from 'net';

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

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      client.removeListener('error', handleError);
      client.removeListener('connect', handleConnect);
    };

    const handleError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(new ControlClient(client));
    };
    client.once('error', handleError);
    client.once('connect', handleConnect);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        client.destroy();
        reject(new Error('Control socket connection timed out'));
      }, timeoutMs);
    }
  });
}
