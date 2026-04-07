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

import type { PtyInfo } from '../contexts/aggregate-view-types';

const OUTPUT_ACTIVITY_WINDOW_MS = 2500;
const MIN_OUTPUT_EVENTS_FOR_SHIMMER = 2;

/** Max total shimmer time regardless of queued activity (prevents infinite animation) */
const MAX_TOTAL_SHIMMER_MS = 15000; // 15 seconds max

/** Timestamp of recent stdout activity per PTY */
const ptyStdoutActivity = new Map<string, number[]>();

/** PTY IDs that should not shimmer (e.g., selected in aggregate view) */
const suppressedPtyIds = new Set<string>();

/** Shimmer animation state per PTY - tracks completed sweeps and queued activity */
interface ShimmerState {
  startTime: number;
  duration: number; // Animation duration in ms (typically 2500ms)
  sweepDuration: number; // Duration of one complete sweep
  sweepCount: number; // Number of completed sweeps in current cycle
  hasQueuedActivity: boolean; // New activity arrived during animation - queue ONE more sweep max
  totalStartTime: number; // When shimmer first started (for max duration cap)
}

const shimmerStates = new Map<string, ShimmerState>();
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

  const recent = prunePtyStdoutActivity(ptyId);
  if (recent.length < MIN_OUTPUT_EVENTS_FOR_SHIMMER) {
    return;
  }

  const latestActivity = recent[recent.length - 1] ?? Date.now();
  shimmerStates.set(ptyId, {
    startTime: latestActivity,
    duration: DEFAULT_CONFIG.sweepDuration,
    sweepDuration: DEFAULT_CONFIG.sweepDuration,
    sweepCount: 0,
    hasQueuedActivity: false,
    totalStartTime: recent[0] ?? latestActivity,
  });
  notifyShimmerStateListeners();
}

/**
 * Check if a PTY ID is currently suppressed from shimmering.
 */
export function isPtyShimmerSuppressed(ptyId: string): boolean {
  return suppressedPtyIds.has(ptyId);
}

/** Shimmer configuration */
interface ShimmerConfig {
  /** Sweep duration in milliseconds */
  sweepDuration: number;
  /** Half-width of the shimmer band in characters */
  bandHalfWidth: number;
  /** Padding before/after text for smooth entry/exit */
  padding: number;
  /** Maximum blend strength (0-1) */
  maxBlend: number;
  /** Color the band blends toward */
  targetColor: string;
}

/** Default shimmer configuration */
const DEFAULT_CONFIG: ShimmerConfig = {
  sweepDuration: 2500, // 2.5 seconds for full sweep
  bandHalfWidth: 5,
  padding: 10,
  maxBlend: 0.9,
  targetColor: '#000000',
};

/** RGB color tuple */
type RGB = [r: number, g: number, b: number];

/**
 * Blend two RGB colors by alpha.
 * alpha=0 -> background, alpha=1 -> foreground.
 */
function blendRgb(foreground: RGB, background: RGB, alpha: number): RGB {
  const clamped = Math.max(0, Math.min(1, alpha));
  return [
    Math.round(foreground[0] * clamped + background[0] * (1 - clamped)),
    Math.round(foreground[1] * clamped + background[1] * (1 - clamped)),
    Math.round(foreground[2] * clamped + background[2] * (1 - clamped)),
  ];
}

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Convert RGB to hex color
 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Cosine-smooth falloff for shimmer band
 * Returns 0-1 intensity based on distance from band center
 */
function shimmerIntensity(distance: number, bandHalfWidth: number): number {
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
  } else {
    // No animation running - start fresh
    shimmerStates.set(ptyId, {
      startTime: time,
      duration: DEFAULT_CONFIG.sweepDuration,
      sweepDuration: DEFAULT_CONFIG.sweepDuration,
      sweepCount: 0,
      hasQueuedActivity: false,
      totalStartTime: time, // Track when shimmer first started
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
    if (shimmerStates.delete(targetPtyId)) {
      notifyShimmerStateListeners();
    }
    return;
  }

  const sourceState = shimmerStates.get(sourcePtyId);
  if (sourceState) {
    shimmerStates.set(targetPtyId, { ...sourceState });
    notifyShimmerStateListeners();
    return;
  }

  if (recent.length < MIN_OUTPUT_EVENTS_FOR_SHIMMER) {
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
  });
  notifyShimmerStateListeners();
}

export function clearPtyStdoutActivity(ptyId: string): void {
  ptyStdoutActivity.delete(ptyId);
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
 * Background processes to exclude from shimmer
 */
const BACKGROUND_PROCESS_PATTERNS = [
  /^webpack/,
  /^jest/,
  /^bun test/,
  /^npm run (watch|dev|start)/,
  /^yarn (watch|dev|start)/,
  /^pnpm (watch|dev|start)/,
  /^node.*--watch/,
  /^tsc.*--watch/,
  /^esbuild.*--watch/,
  /^rollup.*--watch/,
  /^parcel/,
  /^vite/,
  /^next dev/,
  /^nuxt dev/,
  /^gatsby develop/,
  /^craco start/,
  /^react-scripts start/,
];

/**
 * Check if a process appears to be a background server/watcher
 */
function isBackgroundProcess(processName: string | undefined): boolean {
  if (!processName) return false;
  const lower = processName.toLowerCase();
  return BACKGROUND_PROCESS_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Determine if a PTY has meaningful shimmer activity.
 * Heuristic: require sustained recent activity, exclude background processes.
 */
export function hasMeaningfulActivity(pty: PtyInfo, now = Date.now()): boolean {
  const { foregroundProcess, ptyId } = pty;

  if (!foregroundProcess) {
    return false;
  }

  if (isBackgroundProcess(foregroundProcess)) {
    return false;
  }

  return hasRecentPtyStdoutActivity(ptyId, now);
}

/**
 * Calculate shimmer color for a character at a specific position.
 * This is LAZY EVALUATION - called at render time, not in a polling loop.
 *
 * QUEUE BEHAVIOR: When a sweep completes, checks for queued activity and
 * starts a new sweep if needed. This ensures animations never cut off mid-word.
 *
 * @param baseColor - The base text color
 * @param charIndex - Position of character in text
 * @param textLength - Total text length
 * @param now - Current timestamp (pass Date.now() from render context)
 * @param ptyId - PTY identifier to look up animation state
 * @returns Shimmered color or undefined if no shimmer should be applied
 */
export function getPtyShimmerColor(
  ptyId: string,
  baseColor: string,
  charIndex: number,
  textLength: number,
  now: number,
  config: Partial<ShimmerConfig> = {}
): string | undefined {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Check if this PTY has an active shimmer animation
  const state = shimmerStates.get(ptyId);
  if (!state) {
    return undefined;
  }

  // Calculate elapsed time in current sweep
  const elapsed = now - state.startTime;
  const totalElapsed = now - state.totalStartTime;
  const sweepElapsed = elapsed % state.sweepDuration;
  const currentSweep = Math.floor(elapsed / state.sweepDuration);

  // Check max total duration cap (prevents infinite animation with continuous activity)
  if (totalElapsed > MAX_TOTAL_SHIMMER_MS) {
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return undefined;
  }

  // Check if current sweep just completed (transition to next sweep)
  if (currentSweep > state.sweepCount) {
    state.sweepCount = currentSweep;

    // Check if we need to start a new sweep from queued activity
    if (state.hasQueuedActivity) {
      // Reset for new sweep
      state.startTime = now - (elapsed % state.sweepDuration); // Preserve position within sweep
      state.sweepCount = 0;
      state.hasQueuedActivity = false; // Consume the queued activity
    } else if (elapsed > state.duration) {
      // No queued activity and main duration expired - clear state
      shimmerStates.delete(ptyId);
      notifyShimmerStateListeners();
      return undefined;
    }
  }

  // Check if animation has fully expired with no queued activity
  if (elapsed > state.duration && !state.hasQueuedActivity) {
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return undefined;
  }

  // Calculate sweep position based on time since sweep started
  const sweepProgress = sweepElapsed / state.sweepDuration;
  const padding = fullConfig.padding;
  const totalLength = textLength + padding * 2;
  const sweepPosition = sweepProgress * totalLength - padding;

  // Calculate shimmer intensity at this character position
  const distance = Math.abs(charIndex - sweepPosition);
  const intensity = shimmerIntensity(distance, fullConfig.bandHalfWidth);

  if (intensity <= 0) {
    return undefined;
  }

  // Blend colors
  const baseRgb = hexToRgb(baseColor);
  const targetRgb = hexToRgb(fullConfig.targetColor);
  const [r, g, b] = blendRgb(targetRgb, baseRgb, intensity * fullConfig.maxBlend);

  return rgbToHex(r, g, b);
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
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return false;
  }

  return true;
}

/**
 * Get the time remaining for a PTY's shimmer animation.
 * Returns 0 if no active animation.
 *
 * QUEUE BEHAVIOR: If there's queued activity, returns the sweep duration
 * since a new sweep will start (max 15 seconds total).
 */
export function getShimmerTimeRemaining(ptyId: string, now = Date.now()): number {
  const state = shimmerStates.get(ptyId);
  if (!state) return 0;

  // Check max total duration cap
  const totalElapsed = now - state.totalStartTime;
  if (totalElapsed > MAX_TOTAL_SHIMMER_MS) {
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return 0;
  }

  // If queued activity, animation will continue with new sweep
  if (state.hasQueuedActivity) {
    return state.sweepDuration;
  }

  const elapsed = now - state.startTime;
  const remaining = state.duration - elapsed;

  if (remaining <= 0) {
    shimmerStates.delete(ptyId);
    notifyShimmerStateListeners();
    return 0;
  }

  return remaining;
}

/**
 * Process names that indicate coding agent activity
 */
const CODING_AGENT_PATTERNS = [
  /codex/i,
  /claude/i,
  /copilot/i,
  /cursor/i,
  /aider/i,
  /devin/i,
  /pi.?coder/i,
  /open.?coder/i,
];

/**
 * Check if PTY appears to be running a coding agent
 */
export function isCodingAgentPty(pty: PtyInfo): boolean {
  const checkString = `${pty.foregroundProcess ?? ''} ${pty.title ?? ''}`.toLowerCase();
  return CODING_AGENT_PATTERNS.some((pattern) => pattern.test(checkString));
}

/**
 * Subscribe to shimmer state changes (start/stop).
 * Fires only when a PTY starts or stops shimmering, not on animation frames.
 */
export function subscribeToShimmerStateChange(callback: () => void): () => void {
  shimmerStateListeners.add(callback);
  return () => {
    shimmerStateListeners.delete(callback);
  };
}
