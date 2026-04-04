/**
 * PTY Service interface - defines all PTY operations
 * Extracted from Pty.ts for modularity
 */
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import type { PtyNotFoundError, PtySpawnError, PtyCwdError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import type { PtySession } from '../../models';
import type { GitDiffStats, GitInfo } from './helpers';

export interface PtyService {
  /** Create a new PTY session */
  create(options: {
    cols: Cols;
    rows: Rows;
    cwd?: string;
    env?: Record<string, string>;
    pixelWidth?: number;
    pixelHeight?: number;
  }): Promise<PtySpawnError | PtyId>;

  /** Write data to a PTY */
  write(id: PtyId, data: string): Promise<PtyNotFoundError | void>;

  /** Send focus event if focus tracking is enabled */
  sendFocusEvent(id: PtyId, focused: boolean): Promise<PtyNotFoundError | void>;

  /** Resize a PTY */
  resize(
    id: PtyId,
    cols: Cols,
    rows: Rows,
    pixelWidth?: number,
    pixelHeight?: number
  ): Promise<PtyNotFoundError | void>;

  /** Get current working directory of a PTY's shell process */
  getCwd(id: PtyId): Promise<PtyNotFoundError | PtyCwdError | string>;

  /** Destroy a PTY session */
  destroy(id: PtyId): Promise<void>;

  /** Get session info */
  getSession(id: PtyId): Promise<PtyNotFoundError | PtySession>;

  /** Get terminal state */
  getTerminalState(id: PtyId): Promise<PtyNotFoundError | TerminalState>;

  /** Subscribe to terminal state updates */
  subscribe(
    id: PtyId,
    callback: (state: TerminalState) => void
  ): Promise<PtyNotFoundError | (() => void)>;

  /** Subscribe to scroll state changes (lightweight - no state rebuild) */
  subscribeToScroll(id: PtyId, callback: () => void): Promise<PtyNotFoundError | (() => void)>;

  /**
   * Subscribe to unified updates (terminal + scroll combined).
   * More efficient than separate subscriptions - eliminates race conditions
   * and reduces render cycles.
   */
  subscribeUnified(
    id: PtyId,
    callback: (update: UnifiedTerminalUpdate) => void
  ): Promise<PtyNotFoundError | (() => void)>;

  /** Subscribe to PTY exit events */
  onExit(id: PtyId, callback: (exitCode: number) => void): Promise<PtyNotFoundError | (() => void)>;

  /** Get scroll state */
  getScrollState(id: PtyId): Promise<
    | PtyNotFoundError
    | {
        viewportOffset: number;
        scrollbackLength: number;
        isAtBottom: boolean;
        isAtScrollbackLimit?: boolean;
      }
  >;

  /** Set scroll offset */
  setScrollOffset(id: PtyId, offset: number): Promise<PtyNotFoundError | void>;

  /** Enable or disable terminal update notifications (visibility gating) */
  setUpdateEnabled(id: PtyId, enabled: boolean): Promise<PtyNotFoundError | void>;

  /** Get emulator for direct access (e.g., scrollback lines) */
  getEmulator(id: PtyId): Promise<PtyNotFoundError | ITerminalEmulator>;

  /** Get emulator synchronously (may return null if session not found) */
  getEmulatorSync(id: PtyId): ITerminalEmulator | null;

  /** Apply host terminal colors to all active emulators */
  setHostColors(colors: TerminalColors): Promise<void>;

  /** Destroy all sessions */
  destroyAll(): Promise<void>;

  /** List all active PTY IDs */
  listAll(): Promise<PtyId[]>;

  /** Get foreground process name for a PTY */
  getForegroundProcess(id: PtyId): Promise<PtyNotFoundError | string | undefined>;

  /** Get git branch for a PTY's current directory */
  getGitBranch(id: PtyId): Promise<PtyNotFoundError | string | undefined>;

  /** Get git branch + dirty state for a PTY's current directory */
  getGitInfo(id: PtyId): Promise<PtyNotFoundError | GitInfo | undefined>;

  /** Get git diff stats for a PTY's current directory */
  getGitDiffStats(id: PtyId): Promise<PtyNotFoundError | GitDiffStats | undefined>;

  /** Subscribe to PTY lifecycle events (created/destroyed) */
  subscribeToLifecycle(
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ): () => void;

  /** Get current terminal title for a PTY */
  getTitle(id: PtyId): Promise<PtyNotFoundError | string>;

  /** Get last shell command captured for a PTY */
  getLastCommand(id: PtyId): Promise<PtyNotFoundError | string | undefined>;

  /** Subscribe to terminal title changes for a PTY */
  subscribeToTitleChange(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)>;

  /** Subscribe to title changes across ALL PTYs (for aggregate view) */
  subscribeToAllTitleChanges(
    callback: (event: { ptyId: PtyId; title: string }) => void
  ): () => void;

  /** Subscribe to stdout activity events across ALL PTYs */
  subscribeToAllActivity(callback: (event: { ptyId: PtyId }) => void): () => void;

  /** Dispose the PTY service and clean up all resources */
  dispose(): void;
}
