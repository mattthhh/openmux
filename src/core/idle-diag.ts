/**
 * Idle CPU diagnostic — logs scheduling metrics to a file every second.
 *
 * Enabled by: OPENMUX_IDLE_DIAG=/path/to/diag.log
 *
 * Tracks:
 * - Renderer state (isRunning, controlState, liveRequestCounter)
 * - Active setImmediate/setTimeout counts (approximate)
 * - Emulator notification counts (write, scheduleDeferredNotify, flushDeferredNotify)
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const diagPath = process.env.OPENMUX_IDLE_DIAG ?? '';
let enabled = false;
let diagTimer: ReturnType<typeof setInterval> | null = null;

// Counters for the current diagnostic window
let writeCount = 0;
let scheduleCount = 0;
let flushCount = 0;
let notifySubscriberCount = 0;
let requestRenderCount = 0;
let scheduleNotifyCount = 0;
let drainCount = 0;
let handleDataCount = 0;

export const idleDiag = {
  get enabled(): boolean {
    return enabled;
  },

  init(): void {
    if (!diagPath) return;
    enabled = true;
    try {
      mkdirSync(dirname(diagPath), { recursive: true });
    } catch {
      // ignore
    }
    appendFileSync(diagPath, `[${new Date().toISOString()}] idle-diag started\n`);
    diagTimer = setInterval(() => this.flush(), 1000);
    if (diagTimer && 'unref' in diagTimer) diagTimer.unref?.();
  },

  flush(): void {
    if (!enabled) return;
    const line = [
      `[${new Date().toISOString()}]`,
      `write=${writeCount}`,
      `schedDefer=${scheduleCount}`,
      `flushDefer=${flushCount}`,
      `notifySub=${notifySubscriberCount}`,
      `reqRender=${requestRenderCount}`,
      `schedNotify=${scheduleNotifyCount}`,
      `drain=${drainCount}`,
      `handleData=${handleDataCount}`,
    ].join(' ');
    try {
      appendFileSync(diagPath, `${line}\n`);
    } catch {
      // ignore
    }
    writeCount = 0;
    scheduleCount = 0;
    flushCount = 0;
    notifySubscriberCount = 0;
    requestRenderCount = 0;
    scheduleNotifyCount = 0;
    drainCount = 0;
    handleDataCount = 0;
  },

  recordWrite(): void {
    if (!enabled) return;
    writeCount++;
  },

  recordScheduleDeferredNotify(): void {
    if (!enabled) return;
    scheduleCount++;
  },

  recordFlushDeferredNotify(): void {
    if (!enabled) return;
    flushCount++;
  },

  recordNotifySubscribers(): void {
    if (!enabled) return;
    notifySubscriberCount++;
  },

  recordRequestRender(): void {
    if (!enabled) return;
    requestRenderCount++;
  },

  recordScheduleNotify(): void {
    if (!enabled) return;
    scheduleNotifyCount++;
  },

  recordDrain(): void {
    if (!enabled) return;
    drainCount++;
  },

  recordHandleData(): void {
    if (!enabled) return;
    handleDataCount++;
  },
};
