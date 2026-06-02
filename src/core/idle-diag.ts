/**
 * Idle CPU diagnostic — logs scheduling metrics to a file every second.
 *
 * Enabled by: OPENMUX_IDLE_DIAG=/path/to/diag.log
 *
 * Tracks:
 * - Renderer state (controlState, liveRequestCounter, isRunning)
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
let scheduleDeferredCount = 0;
let flushDeferredCount = 0;
let notifySubscriberCount = 0;
let requestRenderFrameCount = 0;
let scheduleNotifyCount = 0;
let drainCount = 0;
let handleDataCount = 0;
let totalRequestRenderCount = 0;

// Renderer reference for state queries
let rendererRef: {
  requestRender(): void;
  controlState?: string;
  liveRequestCounter?: number;
  isRunning?: boolean;
  _isRunning?: boolean;
  gatherStats?: boolean;
  renderStats?: { frameCount: number; fps: number; renderTime: number };
} | null = null;

// Original requestRender — we monkey-patch it to count calls
let originalRequestRender: (() => void) | null = null;

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

  /** Register the renderer for state monitoring + monkey-patch requestRender */
  registerRenderer(renderer: typeof rendererRef): void {
    if (!enabled || !renderer) return;
    rendererRef = renderer;
    if ('requestRender' in renderer) {
      originalRequestRender = renderer.requestRender.bind(renderer);
      renderer.requestRender = () => {
        totalRequestRenderCount++;
        originalRequestRender!();
      };
    }
  },

  flush(): void {
    if (!enabled) return;
    const parts = [
      `[${new Date().toISOString()}]`,
      `write=${writeCount}`,
      `schedDefer=${scheduleDeferredCount}`,
      `flushDefer=${flushDeferredCount}`,
      `notifySub=${notifySubscriberCount}`,
      `reqRenderFrame=${requestRenderFrameCount}`,
      `totalReqRender=${totalRequestRenderCount}`,
      `schedNotify=${scheduleNotifyCount}`,
      `drain=${drainCount}`,
      `handleData=${handleDataCount}`,
    ];

    // Renderer state
    if (rendererRef) {
      const r = rendererRef as Record<string, unknown>;
      parts.push(`ctrlState=${r._controlState ?? r.controlState ?? '?'}`);
      parts.push(`liveReq=${r.liveRequestCounter ?? '?'}`);
      parts.push(`_isRunning=${r._isRunning ?? r.isRunning ?? '?'}`);
      if (r.renderStats && typeof r.renderStats === 'object') {
        const stats = r.renderStats as Record<string, unknown>;
        parts.push(`frameCount=${stats.frameCount ?? '?'}`);
        parts.push(`fps=${stats.fps ?? '?'}`);
        parts.push(`renderMs=${stats.renderTime ?? '?'}`);
      }
    }

    try {
      appendFileSync(diagPath, `${parts.join(' ')}\n`);
    } catch {
      // ignore
    }
    writeCount = 0;
    scheduleDeferredCount = 0;
    flushDeferredCount = 0;
    notifySubscriberCount = 0;
    requestRenderFrameCount = 0;
    scheduleNotifyCount = 0;
    drainCount = 0;
    handleDataCount = 0;
    totalRequestRenderCount = 0;
  },

  recordWrite(): void {
    if (!enabled) return;
    writeCount++;
  },

  recordScheduleDeferredNotify(): void {
    if (!enabled) return;
    scheduleDeferredCount++;
  },

  recordFlushDeferredNotify(): void {
    if (!enabled) return;
    flushDeferredCount++;
  },

  recordNotifySubscribers(): void {
    if (!enabled) return;
    notifySubscriberCount++;
  },

  recordRequestRender(): void {
    if (!enabled) return;
    requestRenderFrameCount++;
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
