import net from 'net';
import fs from 'fs/promises';

import { FrameReader } from './protocol';
import { createServerHandlers, type ShimServerOptions } from './server-handlers';
import { createShimServerState, resetShimServerState } from './server-state';

const shimState = createShimServerState();

async function ensureSocketDir(socketDir: string): Promise<void> {
  await fs.mkdir(socketDir, { recursive: true });
}

async function removeSocketFile(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch {
    // ignore missing
  }
}

export async function startShimServer(options?: ShimServerOptions): Promise<net.Server> {
  resetShimServerState(shimState);

  const handlers = createServerHandlers(shimState, options);
  await ensureSocketDir(handlers.socketDir);
  await removeSocketFile(handlers.socketPath);

  const server = net.createServer((socket) => {
    const frameReader = new FrameReader();

    socket.on('data', (chunk) => {
      frameReader.feed(chunk as Buffer, (header, payloads) => {
        if (header.type === 'request') {
          handlers.handleRequest(socket, header, payloads).catch(() => {});
        }
      });
    });

    socket.on('close', () => {
      shimState.clientIds.delete(socket);
      handlers.detachClient(socket).catch(() => {});
    });

    socket.on('error', () => {
      shimState.clientIds.delete(socket);
      handlers.detachClient(socket).catch(() => {});
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(handlers.socketPath, () => resolve());
    server.once('error', reject);
  });

  return server;
}
