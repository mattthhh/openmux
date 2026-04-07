import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { setPtyUpdateEnabled } from '../../effect/bridge';

const visiblePtyCounts = new Map<string, number>();
const activityPtyCounts = new Map<string, number>();

const applyUpdateGate = (ptyId: string, enabled: boolean, emulator?: ITerminalEmulator | null) => {
  void setPtyUpdateEnabled(ptyId, enabled);
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
};

export const attachVisibleEmulator = (ptyId: string, emulator: ITerminalEmulator | null) => {
  if (!emulator) return;
  if (getTotalHoldCount(ptyId) > 0) {
    applyUpdateGate(ptyId, true, emulator);
  }
};

export const unregisterVisiblePty = (ptyId: string, emulator: ITerminalEmulator | null) => {
  releasePtyUpdates(visiblePtyCounts, ptyId, emulator);
};

export const clearVisiblePty = (ptyId: string, emulator?: ITerminalEmulator | null) => {
  clearPtyUpdates(visiblePtyCounts, ptyId, emulator);
};
