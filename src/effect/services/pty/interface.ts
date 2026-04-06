/**
 * PTY Service interface - defines the public PTY operations surface.
 *
 * The service intentionally exposes a small, cohesive API:
 * - unified terminal subscriptions instead of parallel state/scroll channels
 * - a single emulator accessor with sync/async modes
 * - consolidated git metadata access through getGitInfo()
 * - a single title subscription API for per-PTY and global listeners
 */
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import type { PtyNotFoundError, PtySpawnError, PtyCwdError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import type { PtySession } from '../../models';
import type { GitInfo } from './helpers';

export interface PtyTitleChangeEvent {
  ptyId: PtyId;
  title: string;
}

export interface GetPtyGitInfoOptions {
  includeDiffStats?: boolean;
}

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

  /** Get session info plus lightweight runtime metadata snapshots */
  getSession(id: PtyId): Promise<PtyNotFoundError | PtySession>;

  /** Get terminal state */
  getTerminalState(id: PtyId): Promise<PtyNotFoundError | TerminalState>;

  /** Subscribe to unified terminal + scroll updates */
  subscribe(
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

  /**
   * Get emulator access for advanced operations.
   *
   * - async mode returns PtyNotFoundError when the PTY is unknown
   * - sync mode returns null when the emulator is not available locally
   */
  getEmulator(id: PtyId, options: { sync: true }): ITerminalEmulator | null;
  getEmulator(id: PtyId, options?: { sync?: false }): Promise<PtyNotFoundError | ITerminalEmulator>;

  /** Apply host terminal colors to all active emulators */
  setHostColors(colors: TerminalColors): Promise<void>;

  /** Destroy all sessions */
  destroyAll(): Promise<void>;

  /** List all active PTY IDs */
  listAll(): Promise<PtyId[]>;

  /** Get foreground process name for a PTY */
  getForegroundProcess(id: PtyId): Promise<PtyNotFoundError | string | undefined>;

  /** Get git metadata for a PTY's current directory */
  getGitInfo(
    id: PtyId,
    options?: GetPtyGitInfoOptions
  ): Promise<PtyNotFoundError | GitInfo | undefined>;

  /** Subscribe to PTY lifecycle events (created/destroyed) */
  subscribeToLifecycle(
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ): () => void;

  /** Subscribe to title changes for one PTY or across all PTYs */
  subscribeToTitle(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)>;
  subscribeToTitle(callback: (event: PtyTitleChangeEvent) => void): () => void;

  /** Subscribe to stdout activity events across ALL PTYs */
  subscribeToAllActivity(callback: (event: { ptyId: PtyId }) => void): () => void;

  /** Dispose the PTY service and clean up all resources */
  dispose(): void;
}
