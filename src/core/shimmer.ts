/**
 * Shimmer effect for active PTYs - color-only time-based highlight band
 *
 * Design principles:
 * - Color-only: no character jumping or text shifting
 * - Single global animation tick for all shimmer effects
 * - RAF-scheduled with ~100ms throttle for minimal CPU
 * - Pauses when aggregate view is closed
 * - Time synchronized to process start for coherent wave effect
 */

import type { PtyInfo } from '../contexts/aggregate-view-types';

const OUTPUT_ACTIVITY_WINDOW_MS = 2500;
const MIN_OUTPUT_EVENTS_FOR_SHIMMER = 2;
const ptyStdoutActivity = new Map<string, number[]>();

/**
 * Polyfill for requestAnimationFrame in Bun/Node environment
 * Falls back to setTimeout with 16ms delay (60fps)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raf: (callback: (time: number) => void) => number =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).requestAnimationFrame === 'function'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestAnimationFrame.bind(globalThis)
    : (callback) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return setTimeout(() => callback(Date.now()), 16) as any;
      };

/**
 * Polyfill for cancelAnimationFrame in Bun/Node environment
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caf: (id: number) => void =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).cancelAnimationFrame === 'function'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).cancelAnimationFrame.bind(globalThis)
    : (id) => {
        clearTimeout(id);
      };

/** RGB color tuple */
type RGB = [r: number, g: number, b: number];

/** Shimmer configuration */
interface ShimmerConfig {
  /** Sweep duration in seconds */
  sweepDuration: number;
  /** Half-width of the shimmer band in characters */
  bandHalfWidth: number;
  /** Padding before/after text for smooth entry/exit */
  padding: number;
  /** Maximum blend strength (0-1) */
  maxBlend: number;
  /** Color the band blends toward (codex-style: terminal background) */
  targetColor: string;
  /** Update throttle in ms */
  throttleMs: number;
}

/** Default shimmer configuration */
const DEFAULT_CONFIG: ShimmerConfig = {
  sweepDuration: 2.5,
  bandHalfWidth: 5,
  padding: 10,
  maxBlend: 0.9,
  targetColor: '#000000',
  throttleMs: 100,
};

/** Process start time for synchronized animation */
let processStartTime: number | null = null;

/** Get process start time (lazy init) */
function getProcessStartTime(): number {
  if (processStartTime === null) {
    processStartTime = Date.now();
  }
  return processStartTime;
}

/** Global animation state */
interface AnimationState {
  rafId: number | null;
  lastUpdateTime: number;
  isRunning: boolean;
  subscribers: Set<(time: number) => void>;
}

const globalAnimation: AnimationState = {
  rafId: null,
  lastUpdateTime: 0,
  isRunning: false,
  subscribers: new Set(),
};

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
  return [
    (num >> 16) & 255,
    (num >> 8) & 255,
    num & 255,
  ];
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
 * Calculate shimmer color at a specific position
 */
function calculateShimmerColor(
  baseColor: string,
  position: number,
  sweepPosition: number,
  textLength: number,
  config: ShimmerConfig
): string {
  const baseRgb = hexToRgb(baseColor);
  const targetRgb = hexToRgb(config.targetColor);

  const bandHalfWidth = Math.max(1, config.bandHalfWidth);
  const distance = Math.abs(position - sweepPosition);
  const intensity = shimmerIntensity(distance, bandHalfWidth);

  if (intensity <= 0) {
    return baseColor;
  }

  const [r, g, b] = blendRgb(targetRgb, baseRgb, intensity * config.maxBlend);
  return rgbToHex(r, g, b);
}

/**
 * Prune stale stdout activity entries for a PTY.
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
 */
export function recordPtyStdoutActivity(ptyId: string, time = Date.now()): void {
  const recent = prunePtyStdoutActivity(ptyId, time);
  recent.push(time);
  ptyStdoutActivity.set(ptyId, recent);
}

/**
 * Clear cached stdout activity for a PTY.
 */
export function clearPtyStdoutActivity(ptyId: string): void {
  ptyStdoutActivity.delete(ptyId);
}

/**
 * Check whether a PTY has sustained recent stdout activity.
 */
export function hasRecentPtyStdoutActivity(ptyId: string, now = Date.now()): boolean {
  return prunePtyStdoutActivity(ptyId, now).length >= MIN_OUTPUT_EVENTS_FOR_SHIMMER;
}

/**
 * Background processes to exclude from shimmer
 * These are typically long-running watchers/servers
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
 *
 * Heuristic:
 * - require sustained recent stdout-visible terminal updates
 * - exclude known background watchers/servers
 * - do not shimmer merely because a process is still running
 */
export function hasMeaningfulActivity(pty: PtyInfo): boolean {
  const { foregroundProcess, ptyId } = pty;

  if (!foregroundProcess) {
    return false;
  }

  if (isBackgroundProcess(foregroundProcess)) {
    return false;
  }

  return hasRecentPtyStdoutActivity(ptyId);
}

/**
 * Get shimmer color for a character at a specific position
 * Returns undefined if no shimmer should be applied
 */
export function getShimmerColor(
  baseColor: string,
  charIndex: number,
  textLength: number,
  config: Partial<ShimmerConfig> = {}
): string | undefined {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  const elapsed = (Date.now() - getProcessStartTime()) / 1000;
  const sweepProgress = (elapsed % fullConfig.sweepDuration) / fullConfig.sweepDuration;
  
  const padding = fullConfig.padding;
  const totalLength = textLength + padding * 2;
  const sweepPosition = sweepProgress * totalLength - padding;

  const shimmeredColor = calculateShimmerColor(
    baseColor,
    charIndex,
    sweepPosition,
    textLength,
    fullConfig
  );

  // Return undefined if color hasn't changed (optimization)
  if (shimmeredColor === baseColor) {
    return undefined;
  }

  return shimmeredColor;
}

/**
 * Apply shimmer to text, returning array of (char, color) tuples
 * Only returns entries where color differs from base
 */
export function applyShimmerToText(
  text: string,
  baseColor: string,
  config: Partial<ShimmerConfig> = {}
): Array<{ char: string; color: string; index: number }> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const result: Array<{ char: string; color: string; index: number }> = [];
  
  const elapsed = (Date.now() - getProcessStartTime()) / 1000;
  const sweepProgress = (elapsed % fullConfig.sweepDuration) / fullConfig.sweepDuration;
  
  const padding = fullConfig.padding;
  const totalLength = text.length + padding * 2;
  const sweepPosition = sweepProgress * totalLength - padding;

  for (let i = 0; i < text.length; i++) {
    const shimmeredColor = calculateShimmerColor(
      baseColor,
      i,
      sweepPosition,
      text.length,
      fullConfig
    );

    if (shimmeredColor !== baseColor) {
      result.push({ char: text[i], color: shimmeredColor, index: i });
    }
  }

  return result;
}

/** Global shimmer enable/disable state */
let shimmerGloballyEnabled = true;

/**
 * Enable or disable shimmer globally
 * Call when aggregate view opens/closes
 */
export function setShimmerEnabled(enabled: boolean): void {
  shimmerGloballyEnabled = enabled;
  
  if (enabled) {
    startAnimationLoop();
  } else {
    stopAnimationLoop();
  }
}

/**
 * Check if shimmer is globally enabled
 */
export function isShimmerEnabled(): boolean {
  return shimmerGloballyEnabled;
}

/**
 * Start the global animation loop
 */
function startAnimationLoop(): void {
  if (globalAnimation.isRunning || !shimmerGloballyEnabled) return;
  
  globalAnimation.isRunning = true;
  
  const tick = (time: number): void => {
    if (!globalAnimation.isRunning || !shimmerGloballyEnabled) {
      globalAnimation.rafId = null;
      return;
    }

    // Throttle updates
    const elapsed = time - globalAnimation.lastUpdateTime;
    if (elapsed >= DEFAULT_CONFIG.throttleMs) {
      globalAnimation.lastUpdateTime = time;
      globalAnimation.subscribers.forEach((cb) => cb(time));
    }

    globalAnimation.rafId = raf(tick);
  };

  globalAnimation.rafId = raf(tick);
}

/**
 * Stop the global animation loop
 */
function stopAnimationLoop(): void {
  globalAnimation.isRunning = false;
  if (globalAnimation.rafId !== null) {
    caf(globalAnimation.rafId);
    globalAnimation.rafId = null;
  }
}

/**
 * Subscribe to animation ticks
 * Returns unsubscribe function
 */
export function subscribeToShimmer(callback: (time: number) => void): () => void {
  globalAnimation.subscribers.add(callback);
  
  // Start loop if first subscriber
  if (globalAnimation.subscribers.size === 1) {
    startAnimationLoop();
  }
  
  return () => {
    globalAnimation.subscribers.delete(callback);
    
    // Stop loop if no subscribers
    if (globalAnimation.subscribers.size === 0) {
      stopAnimationLoop();
    }
  };
}

/**
 * Hook-compatible shimmer state for SolidJS
 * Returns a version signal that increments on each shimmer update
 */
export function createShimmerSignal(): { version: () => number; subscribe: () => () => void } {
  let version = 0;
  const subscribers = new Set<() => void>();
  
  const notify = (): void => {
    version++;
    subscribers.forEach((cb) => cb());
  };
  
  const subscribeToUpdates = (): (() => void) => {
    return subscribeToShimmer(() => {
      notify();
    });
  };
  
  return {
    version: () => version,
    subscribe: subscribeToUpdates,
  };
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
 * Get shimmer intensity multiplier based on PTY activity type
 * Coding agents get stronger shimmer, regular shells get subtle
 */
export function getShimmerIntensity(pty: PtyInfo): number {
  if (isCodingAgentPty(pty)) {
    return 1.5; // Stronger shimmer for coding agents
  }
  return 1.0; // Normal shimmer
}
