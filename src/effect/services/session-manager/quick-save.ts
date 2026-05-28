/**
 * Quick save operations for SessionManager
 * Handles workspace serialization and quick save functionality
 * Migrated from Effect to errore - uses promises and direct dependency passing
 */

import type { SerializedSession, SessionMetadata } from '../../models';
import type { WorkspaceState } from './types';
import { collectCwdMap, serializeSession } from './serialization';
import type { SessionStorageError } from '../../errors';

export interface QuickSaveDeps {
  saveSession: (session: SerializedSession) => Promise<SessionStorageError | void>;
}

/**
 * Serialize workspaces to session format
 */
export async function serializeWorkspaces(
  metadata: SessionMetadata,
  workspaces: ReadonlyMap<number, WorkspaceState>,
  activeWorkspaceId: number,
  getCwd: (ptyId: string) => Promise<string>
): Promise<SerializedSession> {
  // Collect all CWDs
  const cwdMap = await collectCwdMap(workspaces, getCwd);
  // Serialize
  return serializeSession(metadata, workspaces, activeWorkspaceId, cwdMap);
}

/**
 * Quick save - serialize and save current state
 */
export async function quickSave(
  deps: QuickSaveDeps,
  metadata: SessionMetadata,
  workspaces: ReadonlyMap<number, WorkspaceState>,
  activeWorkspaceId: number,
  getCwd: (ptyId: string) => Promise<string>
): Promise<SessionStorageError | void> {
  const session = await serializeWorkspaces(metadata, workspaces, activeWorkspaceId, getCwd);
  return await deps.saveSession(session);
}
