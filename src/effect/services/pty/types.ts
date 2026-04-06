/**
 * Internal types for PTY service (errore version)
 */

import type { IPty } from '../../../../native/zig-pty/ts/index';
import type { UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalQueryPassthrough } from '../../../terminal/terminal-query-passthrough';
import type { PtyId } from '../../types';
import type { ScrollbackArchive } from '../../../terminal/scrollback-archive';
import type { ScrollbackArchiver } from './scrollback-archiver';

/**
 * Internal PTY session representation
 */
export interface InternalPtySession {
  id: PtyId;
  pty: IPty;
  emulator: ITerminalEmulator;
  /** Live emulator (no archive, direct ghostty-vt access) */
  liveEmulator: ITerminalEmulator;
  /** Disk-backed scrollback archive */
  scrollbackArchive: ScrollbackArchive;
  /** Archiver for spilling scrollback to disk */
  scrollbackArchiver: ScrollbackArchiver;
  queryPassthrough: TerminalQueryPassthrough;
  kittyRelayDispose?: () => void;
  cols: number;
  rows: number;
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  cwd: string;
  shell: string;
  closing: boolean;
  /** Unified subscribers receive both terminal and scroll updates in one callback */
  unifiedSubscribers: Set<(update: UnifiedTerminalUpdate) => void>;
  exitCallbacks: Set<(exitCode: number) => void>;
  /** Title change subscribers for this specific PTY */
  titleSubscribers: Set<(title: string) => void>;
  /** Last command captured from shell hooks (OSC 777) */
  lastCommand: string | null;
  /** Whether focus tracking (DECSET 1004) is enabled for this PTY */
  focusTrackingEnabled: boolean;
  /** Last focus state requested by the UI */
  focusState: boolean;
  /** Foreground process name that most recently enabled focus tracking (normalized lowercase basename). */
  focusTrackingOwnerProcess: string | null;
  pendingNotify: boolean;
  scrollState: {
    viewportOffset: number;
    /** Track last scrollback length to detect when new content is added */
    lastScrollbackLength: number;
    /** Track last at-bottom state to clear caches on return */
    lastIsAtBottom: boolean;
  };
  /** Timestamp of last resize operation (ms since epoch). Used to suppress destructive clear sequences during resize. */
  lastResizeTime: number;
}
