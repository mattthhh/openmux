import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { setUpdateEnabledSync, applyPtyReadThrottle, flushPtyData } from '../../effect/bridge';
import { setVisiblePty } from '../../terminal/visible-pty-registry';
import { getFocusedPtyId } from '../../terminal/focused-pty-registry';
import { type PtyPriority } from '../../terminal/pty-priority';

const visiblePtyCounts = new Map<string, number>();
const activityPtyCounts = new Map<string, number>();

/**
 * Enable/disable emulator updates for a PTY and set read throttle.
 * Only the focused PTY gets full updates. Background-visible PTYs have
 * updates disabled — the 1fps render pulse in unified-subscription.ts
 * temporarily enables them for a single prepareUpdate + render cycle.
 */
const applyUpdateGate = (ptyId: string, enabled: boolean, emulator?: ITerminalEmulator | null) => {
  // Compute the priority for this PTY
  const priority: PtyPriority = enabled
    ? ptyId === getFocusedPtyId()
      ? 'focused'
      : 'background-visible'
    : 'background-hidden';

  // Apply read throttle to the PTY's native read loop
  applyPtyReadThrottle(ptyId, priority);

  // If the PTY is not focused, never enable full incremental updates.
  // The 1fps pulse handler manages update gating for background panes.
  if (enabled && ptyId !== getFocusedPtyId()) {
    // Still tell the service layer the PTY is "visible" (for cleanup tracking)
    // but don't enable the emulator's incremental update notifications.
    setUpdateEnabledSync(ptyId, false);
    if (emulator && !emulator.isDisposed) {
      emulator.setUpdateEnabled?.(false);
    }
    return;
  }
  setUpdateEnabledSync(ptyId, enabled);
  if (emulator && !emulator.isDisposed) {
    emulator.setUpdateEnabled?.(enabled);
  }
};

const getTotalHoldCount = (ptyId: string) =>
  (visiblePtyCounts.get(ptyId) ?? 0) + (activityPtyCounts.get(ptyId) ?? 0);

const setHoldCount = (counts: Map<string, number>, ptyId: string, count: number) => {
  if (count <= 0) {
    counts.delete(ptyId);
    return;
  }
  counts.set(ptyId, count);
};

const retainPtyUpdates = (
  counts: Map<string, number>,
  ptyId: string,
  emulator?: ITerminalEmulator | null
) => {
  const wasHeld = getTotalHoldCount(ptyId) > 0;
  setHoldCount(counts, ptyId, (counts.get(ptyId) ?? 0) + 1);
  if (!wasHeld) {
    applyUpdateGate(ptyId, true, emulator);
  }
};

const releasePtyUpdates = (
  counts: Map<string, number>,
  ptyId: string,
  emulator?: ITerminalEmulator | null
) => {
  setHoldCount(counts, ptyId, (counts.get(ptyId) ?? 0) - 1);
  if (getTotalHoldCount(ptyId) <= 0) {
    applyUpdateGate(ptyId, false, emulator);
  }
};

const clearPtyUpdates = (
  counts: Map<string, number>,
  ptyId: string,
  emulator?: ITerminalEmulator | null
) => {
  counts.delete(ptyId);
  if (getTotalHoldCount(ptyId) <= 0) {
    applyUpdateGate(ptyId, false, emulator);
  }
};

export const registerVisiblePty = (ptyId: string) => {
  retainPtyUpdates(visiblePtyCounts, ptyId);
  setVisiblePty(ptyId, true);
};

export const attachVisibleEmulator = (ptyId: string, emulator: ITerminalEmulator | null) => {
  if (!emulator) return;
  if (getTotalHoldCount(ptyId) > 0) {
    applyUpdateGate(ptyId, true, emulator);
  }
};

/** Re-evaluate update gating for a PTY after focus changes. */
export const reevaluateUpdateGate = (ptyId: string, emulator: ITerminalEmulator | null) => {
  if (getTotalHoldCount(ptyId) > 0) {
    applyUpdateGate(ptyId, true, emulator);
    // When gaining focus, immediately flush any raw-buffered data so
    // the emulator state is current without waiting for the next onData.
    if (ptyId === getFocusedPtyId()) {
      flushPtyData(ptyId);
    }
  }
};

export const unregisterVisiblePty = (ptyId: string, emulator: ITerminalEmulator | null) => {
  releasePtyUpdates(visiblePtyCounts, ptyId, emulator);
  if (getTotalHoldCount(ptyId) <= 0) {
    setVisiblePty(ptyId, false);
  }
};

export const clearVisiblePty = (ptyId: string, emulator?: ITerminalEmulator | null) => {
  clearPtyUpdates(visiblePtyCounts, ptyId, emulator);
  if (getTotalHoldCount(ptyId) <= 0) {
    setVisiblePty(ptyId, false);
  }
};
