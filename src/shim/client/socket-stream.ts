import type net from 'net';
import type { Buffer } from 'buffer';

import type { ShimHeader } from '../protocol';
import type { FrameReader } from '../protocol';
import { runStream } from '../../effect/stream-utils';

type FrameHandler = (header: ShimHeader, payloads: Buffer[]) => void;

/**
 * Sets up socket data handling using an async iterable approach.
 * This feeds chunks to the frameReader as they arrive.
 * Returns a cleanup function to stop the stream.
 */
export function createSocketDataStream(
  client: net.Socket,
  frameReader: FrameReader,
  handleFrame: FrameHandler
): () => void {
  const stream = {
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      const buffer: Buffer[] = [];
      let resolveNext: ((value: IteratorResult<Buffer>) => void) | null = null;
      let isDone = false;

      const handleData = (chunk: Buffer) => {
        if (isDone) return;
        if (resolveNext) {
          resolveNext({ value: chunk, done: false });
          resolveNext = null;
          return;
        }
        buffer.push(chunk);
      };

      const handleClose = () => {
        isDone = true;
        if (!resolveNext) return;
        resolveNext({ done: true, value: undefined });
        resolveNext = null;
      };

      client.on('data', handleData);
      client.on('close', handleClose);
      client.on('end', handleClose);

      await using _cleanup = {
        [Symbol.asyncDispose]: async () => {
          client.off('data', handleData);
          client.off('close', handleClose);
          client.off('end', handleClose);
        },
      };
      void _cleanup;

      while (!isDone) {
        let value: Buffer;

        if (buffer.length > 0) {
          value = buffer.shift()!;
        } else {
          const result = await new Promise<IteratorResult<Buffer>>((resolve) => {
            resolveNext = resolve;
          });
          if (result.done) break;
          value = result.value;
        }

        frameReader.feed(value, handleFrame);
        yield value;
      }
    },
  };

  return runStream(stream, { label: 'shim-client-data' });
}
