/**
 * Session management handlers for TerminalContext
 * Handles suspend, resume, and cleanup of PTY sessions across session switches
 */

import { destroyPty } from '../../effect/bridge';
import {
  subscribeToPtyWithCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../../hooks/usePtySubscription';

export interface SessionHandlerDeps {
  /** Map of ptyId -> paneId for current session */
  ptyToPaneMap: Map<string, string>;
  /** Map of sessionId -> Map<paneId, ptyId> for all sessions */
  sessionPtyMap: Map<string, Map<string, string>>;
  /** Unified caches for PTY state */
  ptyCaches: PtyCaches;
  /** Map of ptyId -> unsubscribe function */
  unsubscribeFns: Map<string, () => void>;
  /** Handler for PTY exit events */
  handlePtyExit: (ptyId: string, paneId: string) => void;
  /** Whether to cache scroll state locally */
  shouldCacheScrollState: boolean;
}
