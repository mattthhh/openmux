/**
 * Integration test for scroll state consistency across the
 * animator → subscriber → viewState pipeline.
 *
 * Verifies that viewportOffset has exactly ONE writer at any time:
 * - During animation: the animator owns viewportOffset
 * - When idle: the subscriber owns viewportOffset
 * - Keypress snap-to-bottom: handleScrollToBottom writes synchronously
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { TerminalScrollState } from '../../../src/core/types';

// Simulated session state (the ground truth that getCurrentScrollState reads)
interface SessionScrollState {
  viewportOffset: number;
  lastScrollbackLength: number;
  lastIsAtBottom: boolean;
}

// Simulated viewState (what the renderer reads)
interface ViewState {
  scrollState: TerminalScrollState | null;
}

// Simulated ptyCaches
interface PtyCaches {
  scrollStates: Map<string, TerminalScrollState>;
}

// Track all viewportOffset writes to viewState for flake detection
const viewStateOffsetWrites: Array<{ source: string; offset: number; tick: number }> = [];
let tick = 0;

function createTestHarness() {
  // Reset
  viewStateOffsetWrites.length = 0;
  tick = 0;

  // Session state (ground truth)
  const sessions = new Map<string, SessionScrollState>();

  // View state
  const viewState: ViewState = { scrollState: null };

  // Pty caches
  const ptyCaches: PtyCaches = { scrollStates: new Map() };

  // Scroll anim render registry (simulates pty-bridge registry)
  const animRenderRegistry = new Map<string, (offset: number) => void>();

  // Initialize a pty session
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

    // Register the anim render callback (simulates unified-subscription.ts)
    animRenderRegistry.set(ptyId, (offset: number) => {
      if (viewState.scrollState) {
        tick++;
        viewStateOffsetWrites.push({ source: 'animRender', offset, tick });
        viewState.scrollState.viewportOffset = offset;
      }
    });
  }

  // Simulate getCurrentScrollState (from notification.ts)
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

  // Simulate setScrollOffsetNoNotify
  function setScrollOffsetNoNotify(ptyId: string, offset: number) {
    const session = sessions.get(ptyId);
    if (session) session.viewportOffset = offset;
  }

  // Simulate requestScrollAnimRender
  function requestScrollAnimRender(ptyId: string, offset: number) {
    const render = animRenderRegistry.get(ptyId);
    if (render) render(offset);
  }

  // The subscriber callback (simulates unified-subscription.ts)
  function subscriberCallback(ptyId: string, isAnimating: boolean) {
    const update = getCurrentScrollState(ptyId);
    const existingScroll = viewState.scrollState;

    if (existingScroll) {
      if (!isAnimating) {
        tick++;
        viewStateOffsetWrites.push({
          source: 'subscriber',
          offset: update.viewportOffset,
          tick,
        });
        existingScroll.viewportOffset = update.viewportOffset;
      }
      existingScroll.scrollbackLength = update.scrollbackLength;
      existingScroll.isAtBottom = update.isAtBottom;
      existingScroll.isAtScrollbackLimit = update.isAtScrollbackLimit;
    } else {
      viewState.scrollState = { ...update };
    }

    // Also update the cache (simulates setScrollStateCache)
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

  // Simulate onAnimate (from scroll-handlers.ts)
  function onAnimate(ptyId: string, offset: number) {
    setScrollOffsetNoNotify(ptyId, offset);

    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.viewportOffset = offset;
    }

    requestScrollAnimRender(ptyId, offset);
  }

  // Simulate handleScrollToBottom
  function handleScrollToBottom(ptyId: string) {
    setScrollOffsetNoNotify(ptyId, 0);

    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.viewportOffset = 0;
      cached.isAtBottom = true;
    }

    requestScrollAnimRender(ptyId, 0);

    // scrollToBottomBridge also calls setScrollOffset(0) + notifySubscribers
    const session = sessions.get(ptyId);
    if (session) {
      session.viewportOffset = 0;
    }
    // The subscriber notification from scrollToBottomBridge
    subscriberCallback(ptyId, false);
  }

  // Simulate scroll up (user scrolls mouse wheel to go up)
  function scrollUp(ptyId: string, lines: number) {
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (!cached) return;

    const newOffset = Math.min(cached.viewportOffset + lines, cached.scrollbackLength);
    cached.viewportOffset = newOffset;
    setScrollOffsetNoNotify(ptyId, newOffset);
    // Animator would chase to this target; we simulate it arriving
    onAnimate(ptyId, newOffset);
  }

  // Simulate new output arriving (scrollback grows)
  function addOutput(ptyId: string, newLines: number) {
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      cached.scrollbackLength += newLines;
      cached.isAtBottom = cached.viewportOffset === 0;
    }
  }

  return {
    sessions,
    viewState,
    ptyCaches,
    initPty,
    subscriberCallback,
    onAnimate,
    handleScrollToBottom,
    scrollUp,
    addOutput,
    getCurrentScrollState,
    setScrollOffsetNoNotify,
  };
}

describe('scroll state: single-writer consistency', () => {
  test('scroll up while idle — viewportOffset stays at target, no snap back', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 50 lines
    h.scrollUp('p1', 50);

    // viewState should reflect the scrolled position
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Subscriber fires (e.g. idle status update) — should NOT overwrite offset
    h.subscriberCallback('p1', false);

    // Still at 50, not snapped to 0
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);
  });

  test('scroll up during output — viewportOffset stays at target, no flicker', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 50 lines
    h.scrollUp('p1', 50);
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Output arrives — subscriber fires. While animator is active, it must not write offset.
    // Simulate: animator is still active (chasing to 50)
    h.addOutput('p1', 10);
    h.subscriberCallback('p1', true); // isAnimating = true

    // Animator offset should not be overwritten by subscriber
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(50);

    // Animator fires (chase continues)
    h.onAnimate('p1', 50);

    // Still 50
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);
  });

  test('keypress snap-to-bottom resets all state to 0', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 300 lines
    h.scrollUp('p1', 300);
    expect(h.viewState.scrollState!.viewportOffset).toBe(300);

    // Keypress → snap to bottom
    h.handleScrollToBottom('p1');

    // ALL state locations must be 0
    expect(h.viewState.scrollState!.viewportOffset).toBe(0);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(0);
    expect(h.sessions.get('p1')!.viewportOffset).toBe(0);
  });

  test('scroll up after snap-to-bottom starts from 0, not old position', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 300 lines
    h.scrollUp('p1', 300);
    expect(h.viewState.scrollState!.viewportOffset).toBe(300);

    // Keypress → snap to bottom
    h.handleScrollToBottom('p1');
    expect(h.viewState.scrollState!.viewportOffset).toBe(0);

    // User scrolls up a little — should start from 0, not 300
    h.scrollUp('p1', 5);

    expect(h.viewState.scrollState!.viewportOffset).toBe(5);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(5);
    expect(h.sessions.get('p1')!.viewportOffset).toBe(5);
  });

  test('scrollback growth adjusts viewportOffset correctly while scrolled up', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    h.scrollUp('p1', 50);

    // New output adds 10 lines of scrollback
    h.addOutput('p1', 10);

    // Subscriber fires (not animating, animation complete)
    h.subscriberCallback('p1', false);

    // viewportOffset should be adjusted by scrollbackDelta when > 0
    // getCurrentScrollState adjusts: offset += (newScrollback - oldScrollback)
    // But we already wrote 50 to cache and session, and scrollback grew by 10
    // So the delta is 10, and offset becomes 50 + 10 = 60
    // Wait — the adjustment happens in getCurrentScrollState, not in the subscriber
    // The subscriber just propagates what getCurrentScrollState returns
    // But scrollUp already set session.offset = 50 and cache.offset = 50
    // addOutput only grew scrollbackLength, not lastScrollbackLength
    // getCurrentScrollState: lastScrollbackLength was 500 (last set by subscriber or init)
    //   new scrollbackLength = 510
    //   delta = 510 - 500 = 10
    //   offset = 50 + 10 = 60
    expect(h.viewState.scrollState!.viewportOffset).toBe(60);
  });

  test('no flicker: subscriber and animator never write different offsets in the same frame', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);
    viewStateOffsetWrites.length = 0;

    // Scroll up, then simulate interleaved animator + subscriber callbacks
    h.scrollUp('p1', 50);

    // While animator is active, subscriber should not write offset
    h.addOutput('p1', 5);
    h.subscriberCallback('p1', true);

    // Only animRender should have written offset
    const subscriberWrites = viewStateOffsetWrites.filter((w) => w.source === 'subscriber');
    expect(subscriberWrites.length).toBe(0);

    // Animator writes are fine
    const animWrites = viewStateOffsetWrites.filter((w) => w.source === 'animRender');
    expect(animWrites.length).toBeGreaterThan(0);
    expect(animWrites.every((w) => w.offset === 50)).toBe(true);
  });
});

describe('scroll state: real interaction sequences', () => {
  test('scroll up → output arrives → scroll up more — no position jump', () => {
    const h = createTestHarness();
    h.initPty('p1', 500);

    // User scrolls up 50 lines (animator chases to 50, then settles)
    h.scrollUp('p1', 50);
    expect(h.viewState.scrollState!.viewportOffset).toBe(50);

    // Output arrives, subscriber propagates (animator now idle)
    h.addOutput('p1', 10);
    h.subscriberCallback('p1', false);
    expect(h.viewState.scrollState!.viewportOffset).toBe(60); // adjusted by delta

    // User scrolls up 10 more lines — should start from 60, not 50 or 0
    h.scrollUp('p1', 10);
    expect(h.viewState.scrollState!.viewportOffset).toBe(70);
  });

  test('rapid scroll up → snap to bottom → scroll up again — starts from 0', () => {
    const h = createTestHarness();
    h.initPty('p1', 1000);

    // Rapid scroll up in big steps
    h.scrollUp('p1', 200);
    expect(h.viewState.scrollState!.viewportOffset).toBe(200);

    // More scroll
    h.scrollUp('p1', 100);
    expect(h.viewState.scrollState!.viewportOffset).toBe(300);

    // Snap to bottom
    h.handleScrollToBottom('p1');
    expect(h.viewState.scrollState!.viewportOffset).toBe(0);

    // Small scroll up — should start from 0
    h.scrollUp('p1', 5);
    expect(h.viewState.scrollState!.viewportOffset).toBe(5);
    expect(h.ptyCaches.scrollStates.get('p1')!.viewportOffset).toBe(5);
    expect(h.sessions.get('p1')!.viewportOffset).toBe(5);
  });
});
