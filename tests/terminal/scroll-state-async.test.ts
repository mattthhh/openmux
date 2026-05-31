/**
 * Integration test for scroll state async consistency.
 * Tests the actual microtask interleaving of animator renders
 * and subscriber callbacks.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { TerminalScrollState } from '../../../src/core/types';

interface SessionScrollState {
  viewportOffset: number;
  lastScrollbackLength: number;
  lastIsAtBottom: boolean;
}

interface ViewState {
  scrollState: TerminalScrollState | null;
}

function createAsyncTestHarness() {
  const sessions = new Map<string, SessionScrollState>();
  const viewState: ViewState = { scrollState: null };
  const ptyCaches = { scrollStates: new Map<string, TerminalScrollState>() };
  const animRenderRegistry = new Map<string, (offset: number) => void>();

  const viewStateHistory: Array<{
    source: string;
    offset: number;
    time: number;
  }> = [];
  let timeCounter = 0;

  function initPty(ptyId: string, scrollbackLength: number = 0) {
    sessions.set(ptyId, {
      viewportOffset: 0,
      lastScrollbackLength: scrollbackLength,
      lastIsAtBottom: true,
    });
    const ss: TerminalScrollState = {
      viewportOffset: 0,
      scrollbackLength,
      isAtBottom: true,
      isAtScrollbackLimit: false,
    };
    ptyCaches.scrollStates.set(ptyId, ss);
    viewState.scrollState = { ...ss };
    animRenderRegistry.set(ptyId, (offset: number) => {
      timeCounter++;
      viewStateHistory.push({ source: 'animRender', offset, time: timeCounter });
      if (viewState.scrollState) {
        viewState.scrollState.viewportOffset = offset;
      }
    });
  }

  function getCurrentScrollState(ptyId: string): TerminalScrollState {
    const session = sessions.get(ptyId)!;
    const scrollbackLength = ptyCaches.scrollStates.get(ptyId)?.scrollbackLength ?? 0;
    const scrollbackDelta = scrollbackLength - session.lastScrollbackLength;
    if (scrollbackDelta !== 0 && session.viewportOffset > 0) {
      session.viewportOffset = Math.max(
        0,
        Math.min(session.viewportOffset + scrollbackDelta, scrollbackLength)
      );
    }
    session.lastScrollbackLength = scrollbackLength;
    if (session.viewportOffset > scrollbackLength) {
      session.viewportOffset = scrollbackLength;
    }
    const isAtBottom = session.viewportOffset === 0;
    session.lastIsAtBottom = isAtBottom;
    return {
      viewportOffset: session.viewportOffset,
      scrollbackLength,
      isAtBottom,
      isAtScrollbackLimit: false,
    };
  }

  function setScrollOffsetNoNotify(ptyId: string, offset: number) {
    const session = sessions.get(ptyId);
    if (session) session.viewportOffset = offset;
  }

  function requestScrollAnimRender(ptyId: string, offset: number) {
    const render = animRenderRegistry.get(ptyId);
    if (render) render(offset);
  }

  // This is the REAL onAnimate from scroll-handlers.ts — with queueMicrotask!
  let renderCoalesced = false;

  function onAnimate(ptyId: string, offset: number) {
    setScrollOffsetNoNotify(ptyId, offset);
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.viewportOffset = offset;
    }

    if (!renderCoalesced) {
      renderCoalesced = true;
      const finalPtyId = ptyId;
      queueMicrotask(() => {
        renderCoalesced = false;
        const finalOffset = cached?.viewportOffset ?? 0;
        requestScrollAnimRender(finalPtyId, finalOffset);
      });
    }
  }

  // Subscriber callback (from unified-subscription.ts)
  let isAnimating = false;

  function subscriberCallback(ptyId: string) {
    const update = getCurrentScrollState(ptyId);
    const existingScroll = viewState.scrollState;

    if (existingScroll) {
      if (!isAnimating) {
        timeCounter++;
        viewStateHistory.push({
          source: 'subscriber',
          offset: update.viewportOffset,
          time: timeCounter,
        });
        existingScroll.viewportOffset = update.viewportOffset;
      }
      existingScroll.scrollbackLength = update.scrollbackLength;
      existingScroll.isAtBottom = update.isAtBottom;
      existingScroll.isAtScrollbackLimit = update.isAtScrollbackLimit;
    } else {
      viewState.scrollState = { ...update };
    }

    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      if (!isAnimating) {
        cached.viewportOffset = update.viewportOffset;
      }
      cached.scrollbackLength = update.scrollbackLength;
      cached.isAtBottom = update.isAtBottom;
      cached.isAtScrollbackLimit = update.isAtScrollbackLimit;
    }
  }

  function scrollUp(ptyId: string, lines: number) {
    isAnimating = true;
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (!cached) return;
    const newOffset = Math.min(cached.viewportOffset + lines, cached.scrollbackLength);
    cached.viewportOffset = newOffset;
    // Animator chases — tick immediately
    onAnimate(ptyId, newOffset);
    isAnimating = false;
  }

  function handleScrollToBottom(ptyId: string) {
    setScrollOffsetNoNotify(ptyId, 0);
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.viewportOffset = 0;
      cached.isAtBottom = true;
    }
    requestScrollAnimRender(ptyId, 0);
    const session = sessions.get(ptyId);
    if (session) {
      session.viewportOffset = 0;
    }
    subscriberCallback(ptyId);
  }

  function addOutput(ptyId: string, newLines: number) {
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.scrollbackLength += newLines;
    }
  }

  return {
    sessions,
    viewState,
    ptyCaches,
    viewStateHistory,
    initPty,
    subscriberCallback,
    onAnimate,
    handleScrollToBottom,
    scrollUp,
    addOutput,
    setAnimating: (v: boolean) => {
      isAnimating = v;
    },
    getCurrentScrollState,
    waitMicrotasks: () => new Promise<void>((r) => queueMicrotask(() => r())),
  };
}

describe('scroll state: async microtask consistency', () => {
  test('scroll up — subscriber fires BEFORE coalesced render — no flicker', async () => {
    const h = createAsyncTestHarness();
    h.initPty('p1', 500);

    // User scrolls up (animator fires, schedules coalesced render via microtask)
    h.setAnimating(true);
    h.onAnimate('p1', 50);
    h.setAnimating(false);

    // BEFORE the coalesced render microtask fires, the subscriber fires
    // (from emulator's scheduleDeferredNotify)
    h.subscriberCallback('p1');

    // viewState should still be 0 (subscriber skipped because isAnimating was true
    // during the subscriberCallback, but wait — we set isAnimating=false before calling
    // subscriberCallback. The real issue: in the real code, the subscriber reads
    // isAnimating from the animator, which checks activePtyIds. The animator tick
    // removes the ptyId. So by the time subscriber fires, isAnimating=false.)
    // The offset in session is 50 (written by onAnimate's setScrollOffsetNoNotify)
    // The subscriber reads 50 from getCurrentScrollState and writes it to viewState
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Now the coalesced render fires
    await h.waitMicrotasks();
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // No flicker: both wrote 50
    const offsets = h.viewStateHistory.map((w) => w.offset);
    expect(offsets.every((o) => o === 50)).toBe(true);
  });

  test('scroll up — output arrives during animation — subscriber must not overwrite offset', async () => {
    const h = createAsyncTestHarness();
    h.initPty('p1', 500);

    // User scrolls up — animator starts, writes 50, schedules render
    h.setAnimating(true);
    h.onAnimate('p1', 50);

    // Output arrives while animator is still active — subscriber fires
    h.addOutput('p1', 10);
    h.subscriberCallback('p1');

    // Subscriber must NOT have overwritten offset (isAnimating=true)
    expect(h.viewState.scrollState!.viewportOffset).toBe(0); // coalesced render hasn't fired yet!

    // Animator continues to tick
    h.onAnimate('p1', 50); // still chasing to same target

    h.setAnimating(false);

    // Coalesced render fires
    await h.waitMicrotasks();
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);
  });

  test('keypress snap — then scroll up starts from 0, not old position', async () => {
    const h = createAsyncTestHarness();
    h.initPty('p1', 500);

    // Scroll up 300
    h.scrollUp('p1', 300);
    await h.waitMicrotasks();
    expect(h.viewState.scrollState!.viewportOffset).toBe(300);

    // Snap to bottom
    h.handleScrollToBottom('p1');
    expect(h.viewState.scrollState!.viewportOffset).toBe(0);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(0);
    expect(h.sessions.get('p1')!.viewportOffset).toBe(0);

    // Scroll up a little — should start from 0
    h.scrollUp('p1', 5);
    await h.waitMicrotasks();
    expect(h.viewState.scrollState!.viewportOffset).toBe(5);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(5);
    expect(h.sessions.get('p1')!.viewportOffset).toBe(5);
  });

  test('the bug: subscriber fires between onAnimate and coalesced render with isAnimating=false', async () => {
    const h = createAsyncTestHarness();
    h.initPty('p1', 500);

    // This is the REAL bug scenario:
    // 1. Animator ticks, writes session.offset=50, cache.offset=50, schedules render via microtask
    // 2. Animator finishes (removes ptyId from activePtyIds)
    // 3. Subscriber fires (isAnimating=false now), reads session.offset=50, writes to viewState
    // 4. Coalesced render fires, writes 50 to viewState
    // Both write 50 — no problem, right? WRONG:
    // What if the subscriber reads a DIFFERENT value?

    // Simulate: scrollback grew between the animator tick and the subscriber
    h.setAnimating(true);
    h.onAnimate('p1', 50);

    // Animator finishes
    h.setAnimating(false);

    // Meanwhile, scrollback grew by 10 lines
    h.addOutput('p1', 10);

    // Subscriber fires. getCurrentScrollState adjusts: session.offset=50, delta=10 → 60
    h.subscriberCallback('p1');
    // Subscriber writes 60 to viewState

    // But the coalesced render was scheduled with the old cache value
    await h.waitMicrotasks();
    // The coalesced render reads cached.viewportOffset which is now... 60?
    // No! onAnimate wrote 50 to cached. Then subscriber wrote 60 to cached.
    // So by the time the microtask fires, cached.viewportOffset = 60.
    // requestScrollAnimRender is called with 60. So it writes 60. Consistent.

    expect(h.viewState.scrollState!.viewportOffset).toBe(60);
  });

  test('the REAL bug: subscriber writes 0 from getCurrentScrollState when at bottom', async () => {
    const h = createAsyncTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 50 lines
    h.scrollUp('p1', 50);
    await h.waitMicrotasks();
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Now: subscriber fires from a normal emulator update (not animation-related)
    // isAnimating is false. getCurrentScrollState returns... what?
    // session.offset was set to 50 by onAnimate. What about lastScrollbackLength?
    // In the harness, subscriberCallback calls getCurrentScrollState which may
    // adjust the offset based on scrollbackDelta.
    // If lastScrollbackLength == scrollbackLength, delta = 0, no adjustment.
    // So it returns 50. Good.

    // But the REAL code: what if getCurrentScrollState RESETS the offset?
    // Let's check: is there any path where it returns 0?
    h.subscriberCallback('p1');
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Now the actual bug: what if the emulator thinks we're at the bottom?
    // This happens when the emulator's scrollState diverges from session.scrollState.
    // The emulator track.scroll_rows could differ from session.scrollState.viewportOffset.
    // But getCurrentScrollState reads from session.scrollState, not from the emulator.
    // So this shouldn't happen... unless the session state gets corrupted.
  });
});
