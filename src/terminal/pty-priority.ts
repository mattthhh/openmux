/**
 * PTY Priority System (Erlang-inspired scheduler priorities)
 *
 * Inspired by Erlang's BEAM scheduler: each PTY gets a priority level
 * that determines how much main-thread time it consumes. The scheduler
 * always prioritizes the focused PTY, and background PTYs only get
 * enough time to maintain a minimal visual presence.
 *
 * Priority levels:
 * - `focused`:  The active pane the user is interacting with.
 *               Immediate drains, full budget, every subscriber notification.
 * - `background-visible`: Visible in a split but not focused.
 *               1fps drain+render pulse. Zero main-thread time between pulses.
 * - `background-hidden`: Not visible (different workspace, minimized).
 *               No drain, no updates, no renders.
 */

export type PtyPriority = 'focused' | 'background-visible' | 'background-hidden';

export interface PriorityConfig {
  /** Minimum interval between drain cycles (ms). 0 = immediate. */
  drainIntervalMs: number;
  /** Maximum CPU budget per drain cycle (ms). */
  drainBudgetMs: number;
  /** Maximum characters to process per drain tick. */
  maxCharsPerTick: number;
  /** Maximum segments per drain tick. */
  maxSegmentsPerTick: number;
  /** Whether the emulator should fire subscriber notifications on write. */
  emulatorUpdatesEnabled: boolean;
  /** Minimum interval between renders (ms). 0 = every notification. */
  renderIntervalMs: number;
}

const PRIORITY_CONFIGS: Record<PtyPriority, PriorityConfig> = {
  focused: {
    drainIntervalMs: 0,
    drainBudgetMs: 8,
    maxCharsPerTick: 65_536,
    maxSegmentsPerTick: 16,
    emulatorUpdatesEnabled: true,
    renderIntervalMs: 0,
  },
  'background-visible': {
    drainIntervalMs: 1000,
    drainBudgetMs: 32,
    maxCharsPerTick: 262_144,
    maxSegmentsPerTick: 64,
    emulatorUpdatesEnabled: false,
    renderIntervalMs: 1000,
  },
  'background-hidden': {
    drainIntervalMs: Infinity,
    drainBudgetMs: 0,
    maxCharsPerTick: 0,
    maxSegmentsPerTick: 0,
    emulatorUpdatesEnabled: false,
    renderIntervalMs: Infinity,
  },
};

/** Get the scheduling config for a priority level. */
export function getPriorityConfig(priority: PtyPriority): PriorityConfig {
  return PRIORITY_CONFIGS[priority];
}

/** Compute the current priority for a PTY based on focus and visibility. */
export function resolvePtyPriority(
  ptyId: string,
  focusedPtyId: string | null,
  isVisible: boolean
): PtyPriority {
  if (!isVisible) return 'background-hidden';
  if (ptyId === focusedPtyId) return 'focused';
  return 'background-visible';
}
