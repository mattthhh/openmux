/**
 * Branded types for type-safe identifiers and domain primitives.
 * These prevent mixing values that have the same underlying type.
 *
 * Replaces Effect Schema branded types with Zod branding.
 */
import { z } from 'zod';

// Brand type helpers
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

/** Unique identifier for a pane */
export type PaneId = Brand<string, 'PaneId'>;
export const PaneIdSchema = z.string().transform((s) => s as PaneId);

/** Unique identifier for a PTY session */
export type PtyId = Brand<string, 'PtyId'>;
export const PtyIdSchema = z.string().transform((s) => s as PtyId);

/** Workspace identifier (1-9) */
export type WorkspaceId = Brand<number, 'WorkspaceId'>;
export const WorkspaceIdSchema = z
  .number()
  .int()
  .min(1)
  .max(9)
  .transform((n) => n as WorkspaceId);

/** Unique identifier for a session */
export type SessionId = Brand<string, 'SessionId'>;
export const SessionIdSchema = z.string().transform((s) => s as SessionId);

/** Terminal column count (must be positive) */
export type Cols = Brand<number, 'Cols'>;
export const ColsSchema = z
  .number()
  .int()
  .positive()
  .transform((n) => n as Cols);

/** Terminal row count (must be positive) */
export type Rows = Brand<number, 'Rows'>;
export const RowsSchema = z
  .number()
  .int()
  .positive()
  .transform((n) => n as Rows);

/** Layout mode for workspace pane arrangement */
export const LayoutModeSchema = z.enum(['vertical', 'horizontal', 'stacked']);

/** Generate a new PaneId */
const makePaneId = (counter: number): PaneId => `pane-${counter}` as PaneId;

/** Generate a new PtyId */
export const makePtyId = (): PtyId =>
  `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as PtyId;

/** Generate a new SessionId */
export const makeSessionId = (): SessionId =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as SessionId;

/** Make Cols from number */
export const makeCols = (n: number): Cols => n as Cols;

/** Make Rows from number */
export const makeRows = (n: number): Rows => n as Rows;

/** Make WorkspaceId from number */
export const makeWorkspaceId = (n: number): WorkspaceId => n as WorkspaceId;

/** Cast a string to PtyId */
export const asPtyId = (id: string): PtyId => id as PtyId;
