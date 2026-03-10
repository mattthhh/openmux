/**
 * Shim Handlers - Shared Types
 */
import type net from 'net';
import type { TerminalColors } from '../../terminal/terminal-colors';
import type { ShimServerState } from '../server-state';
import type { ShimHeader } from '../protocol';

/** PTY accessor function type */
export type WithPty = <A>(fn: (pty: any) => Promise<A> | A) => Promise<A>;

/** Server handler options */
export type ShimServerOptions = {
  socketPath?: string;
  withPty?: WithPty;
  setHostColors?: (colors: TerminalColors) => void;
};

/** Dependencies for handler modules */
export interface HandlerDeps {
  state: ShimServerState;
  withPty: WithPty;
  socketPath: string;
  socketDir: string;
}

/** Event sender function type */
export type SendEvent = (
  header: ShimHeader,
  payloads?: ArrayBuffer[],
  options?: { allowWhileBootstrapping?: boolean }
) => void;

/** Attach context for bootstrap operations */
export interface AttachContext {
  socket: net.Socket;
  clientId: string;
  attachEpoch: number;
}

/** Bootstrap options for subscription operations */
export interface BootstrapOptions {
  bootstrap?: boolean;
  attach?: AttachContext;
}
