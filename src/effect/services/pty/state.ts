/**
 * PTY State Management - centralized session storage
 * Extracted from Pty.ts for cleaner architecture
 */
import type { PtyId } from "../../types"
import type { InternalPtySession } from "./types"

/** State container for PTY sessions */
export class PtyState {
  private sessions = new Map<PtyId, InternalPtySession>()

  get(id: PtyId): InternalPtySession | undefined {
    return this.sessions.get(id)
  }

  set(id: PtyId, session: InternalPtySession): void {
    this.sessions.set(id, session)
  }

  delete(id: PtyId): boolean {
    return this.sessions.delete(id)
  }

  has(id: PtyId): boolean {
    return this.sessions.has(id)
  }

  keys(): IterableIterator<PtyId> {
    return this.sessions.keys()
  }

  get size(): number {
    return this.sessions.size
  }

  /** Get all session IDs as array */
  list(): PtyId[] {
    return Array.from(this.sessions.keys())
  }

  /** Get all sessions as array */
  values(): InternalPtySession[] {
    return Array.from(this.sessions.values())
  }

  /** Check if state is empty */
  isEmpty(): boolean {
    return this.sessions.size === 0
  }

  /** Clear all sessions (use with caution - doesn't cleanup resources) */
  clear(): void {
    this.sessions.clear()
  }

  /** Iterate over entries */
  entries(): IterableIterator<[PtyId, InternalPtySession]> {
    return this.sessions.entries()
  }

  /** Execute callback for each session */
  forEach(callback: (session: InternalPtySession, id: PtyId) => void): void {
    this.sessions.forEach(callback)
  }
}
