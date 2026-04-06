import type { GitDiffStats, GitInfo } from '../effect/services/pty/helpers';

/** Session information for a PTY process */
export type ShimPtySessionInfo = {
  /** Unique session identifier */
  id: string;
  /** Process ID of the shell */
  pid: number;
  /** Terminal column count */
  cols: number;
  /** Terminal row count */
  rows: number;
  /** Current working directory */
  cwd: string;
  /** Shell executable path */
  shell: string;
};

/** Aggregated metadata for a shim-managed PTY */
export type ShimPtyMetadata = {
  /** Session info including PID, CWD, shell */
  session: ShimPtySessionInfo | null;
  /** Current working directory (may differ from session.cwd) */
  cwd: string | null;
  /** Name of the foreground process */
  foregroundProcess?: string;
  /** Git repository information */
  gitInfo?: GitInfo;
  /** Git diff statistics */
  gitDiffStats?: GitDiffStats;
  /** Terminal title */
  title: string;
  /** Last executed command */
  lastCommand?: string;
};
