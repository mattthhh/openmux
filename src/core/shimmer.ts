/**
 * Shimmer effect for active PTYs - EVENT BASED architecture
 *
 * Design principles:
 * - Color-only: no character jumping or text shifting
 * - NO global animation loop - lazy render-time calculation
 * - Activity timestamp drives animation position
 * - Each PTY tracks its own animation state
 * - Zero CPU cost when no activity
 */

const OUTPUT_ACTIVITY_WINDOW_MS = 2500;
const MIN_OUTPUT_EVENTS_FOR_SHIMMER = 2;

/** Max total shimmer time regardless of queued activity (prevents infinite animation) */
const MAX_TOTAL_SHIMMER_MS = 15000; // 15 seconds max

/** Timestamp of recent stdout activity per PTY */
const ptyStdoutActivity = new Map<string, number[]>();

/** PTY IDs that should not shimmer (e.g., selected in aggregate view) */
const suppressedPtyIds = new Set<string>();

/** The currently focused PTY (the one the user is watching).
 *  Used at activity-recording time to determine whether the user saw the
 *  output.  Captured in ShimmerState.sawUnfocusedActivity so the glow
 *  decision is based on what happened at recording time, not at the
 *  later animation-completion time. */
let focusedPtyId: string | null = null;

/**
 * Update the focused PTY for glow gating.
 * Called from the app's focus-tracking system whenever focus changes.
 */
export function setShimmerFocusedPty(ptyId: string | null): void {
  focusedPtyId = ptyId;
}

/** PTY IDs whose shimmer completed (not suppressed or cleared).
 *  Maps ptyId → completion timestamp.  Persists until the user
 *  selects the row (clicks to preview) — no auto-expiry timer. */
const recentlyCompletedShimmer = new Map<string, number>();

/** Shimmer animation state per PTY - tracks completed sweeps and queued activity */
export interface ShimmerState {
  startTime: number;
  duration: number; // Animation duration in ms (typically 2500ms)
  sweepDuration: number; // Duration of one complete sweep
  sweepCount: number; // Number of completed sweeps in current cycle
  hasQueuedActivity: boolean; // New activity arrived during animation - queue ONE more sweep max
  totalStartTime: number; // When shimmer first started (for max duration cap)
  /** True if any activity was recorded while the PTY was NOT focused.
   *  If all activity happened while the user was watching, there is nothing
   *  to notify about and the glow should not fire on completion. */
  sawUnfocusedActivity: boolean;
}

export const shimmerStates = new Map<string, ShimmerState>();
const shimmerStateListeners = new Set<() => void>();

function notifyShimmerStateListeners(): void {
  for (const listener of shimmerStateListeners) {
    listener();
  }
}

/**
 * Suppress shimmer for a specific PTY ID (e.g., when selected in aggregate view).
 * This immediately stops calculations and clears animation state for this PTY.
 */
export function suppressPtyShimmer(ptyId: string): void {
  suppressedPtyIds.add(ptyId);
  // Suppression is not a natural completion — clear glow state
  recentlyCompletedShimmer.delete(ptyId);
  // Clear any existing animation state to stop calculations immediately
  if (shimmerStates.delete(ptyId)) {
    notifyShimmerStateListeners();
  }
}

/**
 * Unsuppress shimmer for a specific PTY ID, allowing it to shimmer again.
 */
export function unsuppressPtyShimmer(ptyId: string): void {
  suppressedPtyIds.delete(ptyId);

  if (shimmerStates.has(ptyId)) {
    return;
  }

  // If shimmer already completed naturally (glow is active), don't restart
  // it from stale activity timestamps. The user hasn't viewed the PTY yet.
  if (recentlyCompletedShimmer.has(ptyId)) {
    return;
  }

  // Don't restart shimmer from stale activity data. If the shimmer already
  // played out naturally (no glow = user was watching, glow = user wasn't),
  // resurrecting it from old timestamps would produce a false glow for
  // focused PTYs (the most common case). New activity will start fresh
  // shimmer through recordPtyStdoutActivity.
  return;
}

export interface ShimmerConfig {
  /** Sweep duration in milliseconds */
  sweepDuration: number;
  /** Half-width of the shimmer band in characters */
  bandHalfWidth: number;
  /** Padding before/after text for smooth entry/exit */
  padding: number;
  /** Maximum blend strength (0-1) */
  maxBlend: number;
}

/** Default shimmer configuration */
export const DEFAULT_CONFIG: ShimmerConfig = {
  sweepDuration: 2500, // 2.5 seconds for full sweep
  bandHalfWidth: 5,
  padding: 10,
  maxBlend: 0.9,
};

/**
 * Cosine-smooth falloff for shimmer band
 * Returns 0-1 intensity based on distance from band center
 */
export function shimmerIntensity(distance: number, bandHalfWidth: number): number {
  if (distance > bandHalfWidth) return 0;
  const x = (Math.PI * distance) / bandHalfWidth;
  return 0.5 * (1 + Math.cos(x));
}

/**
 * Prune stale stdout activity entries for a PTY.
 * Returns the recent activity timestamps.
 */
function prunePtyStdoutActivity(ptyId: string, now = Date.now()): number[] {
  const recent = (ptyStdoutActivity.get(ptyId) ?? []).filter(
    (timestamp) => now - timestamp <= OUTPUT_ACTIVITY_WINDOW_MS
  );

  if (recent.length === 0) {
    ptyStdoutActivity.delete(ptyId);
    return [];
  }

  ptyStdoutActivity.set(ptyId, recent);
  return recent;
}

/**
 * Record that a PTY produced stdout-visible terminal output.
 * This is EVENT DRIVEN - called when PTY outputs data.
 * Sets the shimmer animation state for this PTY.
 *
 * QUEUE BEHAVIOR: If animation is already running, queues another sweep
 * to ensure the user sees a complete animation for all activity.
 */
export function recordPtyStdoutActivity(ptyId: string, time = Date.now()): void {
  const recent = prunePtyStdoutActivity(ptyId, time);
  recent.push(time);
  ptyStdoutActivity.set(ptyId, recent);

  if (suppressedPtyIds.has(ptyId)) {
    return;
  }

  const existingState = shimmerStates.get(ptyId);

  if (existingState) {
    // Animation is running - queue ONE more sweep max (ring buffer of 1)
    // Don't accumulate multiple queued sweeps - just mark that we need one more
    existingState.hasQueuedActivity = true;
    // NOTE: Do NOT upgrade sawUnfocusedActivity here.  The flag captures
    // whether the user was watching when the shimmer STARTED.  Subsequent
    // queued activity (e.g. shell prompt arriving after switching away)
    // should not retroactively cause glow — the user already saw the
    // meaningful output.
  } else {
    // New shimmer starting — clear any lingering glow from a previous cycle
    recentlyCompletedShimmer.delete(ptyId);
    // Capture whether the user was watching when this activity occurred.
    // If focusedPtyId is null (app startup / effect not yet run), assume
    // the user is watching — false glow is worse than missed glow.
    const wasUnfocused = focusedPtyId !== null && ptyId !== focusedPtyId;
    // No animation running - start fresh
    shimmerStates.set(ptyId, {
      startTime: time,
      duration: DEFAULT_CONFIG.sweepDuration,
      sweepDuration: DEFAULT_CONFIG.sweepDuration,
      sweepCount: 0,
      hasQueuedActivity: false,
      totalStartTime: time, // Track when shimmer first started
      sawUnfocusedActivity: wasUnfocused,
    });
    notifyShimmerStateListeners();
  }
}

/**
 * Clear cached stdout activity for a PTY.
 */
export function clonePtyStdoutActivity(
  sourcePtyId: string,
  targetPtyId: string,
  now = Date.now()
): void {
  if (sourcePtyId === targetPtyId) {
    return;
  }

  const recent = prunePtyStdoutActivity(sourcePtyId, now);
  if (recent.length === 0) {
    clearPtyStdoutActivity(targetPtyId);
    return;
  }

  ptyStdoutActivity.set(targetPtyId, [...recent]);

  if (suppressedPtyIds.has(targetPtyId)) {
    recentlyCompletedShimmer.delete(targetPtyId);
    if (shimmerStates.delete(targetPtyId)) {
      notifyShimmerStateListeners();
    }
    return;
  }

  const sourceState = shimmerStates.get(sourcePtyId);
  if (sourceState) {
    shimmerStates.set(targetPtyId, {
      ...sourceState,
      // Cloned rows are aggregate-view projections — the user is not
      // watching them directly, so mark unfocused activity for glow.
      sawUnfocusedActivity: true,
    });
    notifyShimmerStateListeners();
    return;
  }

  if (recent.length < MIN_OUTPUT_EVENTS_FOR_SHIMMER) {
    recentlyCompletedShimmer.delete(targetPtyId);
    if (shimmerStates.delete(targetPtyId)) {
      notifyShimmerStateListeners();
    }
    return;
  }

  const latestActivity = recent[recent.length - 1] ?? now;
  shimmerStates.set(targetPtyId, {
    startTime: latestActivity,
    duration: DEFAULT_CONFIG.sweepDuration,
    sweepDuration: DEFAULT_CONFIG.sweepDuration,
    sweepCount: 0,
    hasQueuedActivity: false,
    totalStartTime: recent[0] ?? latestActivity,
    // Cloned rows are aggregate-view projections — the user is not
    // watching them directly, so mark unfocused activity for glow.
    sawUnfocusedActivity: true,
  });
  notifyShimmerStateListeners();
}

export function clearPtyStdoutActivity(ptyId: string): void {
  ptyStdoutActivity.delete(ptyId);
  recentlyCompletedShimmer.delete(ptyId);
  if (shimmerStates.delete(ptyId)) {
    notifyShimmerStateListeners();
  }
}

/**
 * Check whether a PTY has sustained recent stdout activity.
 * Used for determining if PTY should shimmer at all.
 */
export function hasRecentPtyStdoutActivity(ptyId: string, now = Date.now()): boolean {
  return prunePtyStdoutActivity(ptyId, now).length >= MIN_OUTPUT_EVENTS_FOR_SHIMMER;
}

/**
 * Check if a PTY currently has an active shimmer animation.
 * Useful for conditional styling or optimizations.
 *
 * QUEUE BEHAVIOR: If a sweep completes and there's queued activity,
 * continues the animation with a new sweep (max 15 seconds total).
 */
export function hasActiveShimmer(ptyId: string, now = Date.now()): boolean {
  // Suppressed PTYs never have active shimmer
  if (suppressedPtyIds.has(ptyId)) {
    return false;
  }

  const state = shimmerStates.get(ptyId);
  if (!state) return false;

  const elapsed = now - state.startTime;
  const totalElapsed = now - state.totalStartTime;
  const sweepElapsed = elapsed % state.sweepDuration;
  const currentSweep = Math.floor(elapsed / state.sweepDuration);

  // Check max total duration cap
  if (totalElapsed > MAX_TOTAL_SHIMMER_MS) {
    const state = shimmerStates.get(ptyId)!;
    if (state.sawUnfocusedActivity) {
      recentlyCompletedShimmer.set(ptyId, now);
    }
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return false;
  }

  // Check if current sweep just completed
  if (currentSweep > state.sweepCount) {
    state.sweepCount = currentSweep;

    // If queued activity, continue with new sweep
    if (state.hasQueuedActivity) {
      state.startTime = now - sweepElapsed; // Preserve position within sweep
      state.sweepCount = 0;
      state.hasQueuedActivity = false; // Consume the queued activity
      return true;
    }
  }

  // Check if animation has fully expired
  if (elapsed > state.duration && !state.hasQueuedActivity) {
    if (state.sawUnfocusedActivity) {
      recentlyCompletedShimmer.set(ptyId, now);
    }
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return false;
  }

  return true;
}

/**
 * Check if a PTY's shimmer completed (natural expiration, not suppression).
 * Persists until explicitly cleared by clearPostShimmerGlow (e.g. on selection)
 * or clearPtyStdoutActivity (PTY removed).
 */
export function hasPostShimmerGlow(ptyId: string): boolean {
  if (!recentlyCompletedShimmer.has(ptyId)) return false;
  // Active shimmer overrides glow — don't show both
  if (shimmerStates.has(ptyId)) return false;
  return true;
}

/**
 * Clear the post-shimmer glow for a PTY (e.g. when the row is selected).
 */
export function clearPostShimmerGlow(ptyId: string): void {
  recentlyCompletedShimmer.delete(ptyId);
}

export function subscribeToShimmerStateChange(callback: () => void): () => void {
  shimmerStateListeners.add(callback);
  return () => {
    shimmerStateListeners.delete(callback);
  };
}

/**
 * Get the current sweep position for a PTY's shimmer animation.
 * Used by the native post-processor to build the cellMask.
 * Returns null if the PTY has no active shimmer.
 */
export function getShimmerSweepPosition(
  ptyId: string,
  textLength: number,
  now: number = Date.now()
): number | null {
  const state = shimmerStates.get(ptyId);
  if (!state) return null;

  const elapsed = now - state.startTime;
  const totalElapsed = now - state.totalStartTime;
  const sweepElapsed = elapsed % state.sweepDuration;

  // Check max total duration cap
  if (totalElapsed > MAX_TOTAL_SHIMMER_MS) return null;

  // Check if animation has fully expired with no queued activity
  if (elapsed > state.duration && !state.hasQueuedActivity) return null;

  const sweepProgress = sweepElapsed / state.sweepDuration;
  const totalLength = textLength + DEFAULT_CONFIG.padding * 2;
  return sweepProgress * totalLength - DEFAULT_CONFIG.padding;
}
