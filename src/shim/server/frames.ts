import type net from 'net';
import { encodeFrame, type ShimHeader } from '../protocol';

/**
 * Sends a frame to a socket.
 * Silently fails if the socket is destroyed.
 * @param socket - Target socket
 * @param header - Frame header
 * @param payloads - Binary payloads to include
 */
export function sendFrame(
  socket: net.Socket,
  header: ShimHeader,
  payloads: ArrayBuffer[] = []
): void {
  if (socket.destroyed) return;
  socket.write(encodeFrame(header, payloads));
}

/**
 * Sends a successful response frame.
 * @param socket - Target socket
 * @param requestId - Request identifier to correlate with
 * @param result - Response result data
 * @param payloads - Binary payloads to include
 */
export function sendResponse(
  socket: net.Socket,
  requestId: number,
  result?: unknown,
  payloads: ArrayBuffer[] = []
): void {
  sendFrame(
    socket,
    {
      type: 'response',
      requestId,
      ok: true,
      result,
      payloadLengths: payloads.map((payload) => payload.byteLength),
    },
    payloads
  );
}

/**
 * Sends an error response frame.
 * @param socket - Target socket
 * @param requestId - Request identifier to correlate with
 * @param error - Error message
 */
export function sendError(socket: net.Socket, requestId: number, error: string): void {
  sendFrame(socket, {
    type: 'response',
    requestId,
    ok: false,
    error,
  });
}
