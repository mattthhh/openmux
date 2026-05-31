/**
 * Integration test for scroll state using REAL code paths.
 *
 * Uses the actual createScrollHandlers, ScrollAnimator, and pty-bridge
 * registries. The async service layer is bypassed by not calling
 * scrollToBottomBridge (which requires initialized services).
 * This test MUST fail if the real code has the bugs the user reports.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { TerminalScrollState } from '../../src/core/types';
import { createScrollHandlers } from '../../src/contexts/terminal/scroll-handlers';
import {
  registerScrollOffset,
  registerScrollOffsetNoNotify,
  unregisterScrollOffset,
  registerScrollAnimRender,
  unregisterScrollAnimRender,
  setScrollOffsetSync,
} from '../../src/effect/bridge/pty-bridge';

const PTY_ID = 'test-pty-scroll-real';

interface MockSession {
  viewportOffset: number;
  lastScrollbackLength: number;
  lastIsAtBottom: boolean;
  scrollbackLength: number;
}

interface StateLog {
  source: string;
  sessionOffset: number;
  cacheOffset: number;
  viewOffset: number;
  time: number;
}

describe('scroll state: real code integration', () => {
  let session: MockSession;
  let cache: TerminalScrollState;
  let viewOffset: number;
  let log: StateLog[];
  let time: number;
  let notifyCallCount: number;
  let scrollHandlers: ReturnType<typeof createScrollHandlers>;

  beforeEach(() => {
    session = {
      viewportOffset: 0,
      lastScrollbackLength: 500,
      lastIsAtBottom: true,
      scrollbackLength: 500,
    };

    cache = {
      viewportOffset: 0,
      scrollbackLength: 500,
      isAtBottom: true,
      isAtScrollbackLimit: false,
    };

    viewOffset = 0;
    log = [];
    time = 0;
    notifyCallCount = 0;

    registerScrollOffsetNoNotify(PTY_ID, (offset: number) => {
      session.viewportOffset = offset;
    });

    registerScrollOffset(PTY_ID, (offset: number) => {
      session.viewportOffset = Math.max(0, Math.min(offset, session.scrollbackLength));
      notifyCallCount++;
    });

    registerScrollAnimRender(PTY_ID, (offset: number) => {
      time++;
      viewOffset = offset;
      log.push({
        source: 'animRender',
        sessionOffset: session.viewportOffset,
        cacheOffset: cache.viewportOffset,
        viewOffset: offset,
        time,
      });
    });

    scrollHandlers = createScrollHandlers(() => cache);
  });

  afterEach(() => {
    scrollHandlers.cleanup();
    unregisterScrollOffset(PTY_ID);
    unregisterScrollAnimRender(PTY_ID);
  });

  // Simulate the subscriber callback (from unified-subscription.ts + notification.ts)
  function subscriberFires(ptyId: string) {
    const animating = scrollHandlers.isAnimating(ptyId);

    // Simulate getCurrentScrollState adjusting for scrollback growth
    const scrollbackDelta = session.scrollbackLength - session.lastScrollbackLength;
    if (scrollbackDelta !== 0 && session.viewportOffset > 0) {
      session.viewportOffset = Math.max(
        0,
        Math.min(session.viewportOffset + scrollbackDelta, session.scrollbackLength)
      );
    }
    session.lastScrollbackLength = session.scrollbackLength;

    const updateScrollState: TerminalScrollState = {
      viewportOffset: session.viewportOffset,
      scrollbackLength: session.scrollbackLength,
      isAtBottom: session.viewportOffset === 0,
      isAtScrollbackLimit: false,
    };

    if (!animating) {
      time++;
      viewOffset = updateScrollState.viewportOffset;
      log.push({
        source: 'subscriber',
        sessionOffset: session.viewportOffset,
        cacheOffset: cache.viewportOffset,
        viewOffset: viewOffset,
        time,
      });
    }

    if (!animating) {
      cache.viewportOffset = updateScrollState.viewportOffset;
    }
    cache.scrollbackLength = updateScrollState.scrollbackLength;
    cache.isAtBottom = updateScrollState.isAtBottom;
    cache.isAtScrollbackLimit = updateScrollState.isAtScrollbackLimit;
  }

  // Drain pending microtasks
  async function drain() {
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((r) => queueMicrotask(() => r()));
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  // handleScrollToBottom WITHOUT calling scrollToBottomBridge
  // (scrollToBottomBridge requires services that aren't initialized in tests)
  function scrollToBottom(ptyId: string) {
    const handlers = scrollHandlers as any;
    // Replicate the logic, skipping the async bridge call
    handlers.handleScrollToBottom(ptyId);
  }

  test('scenario 1: scroll up during output — offset stays at target', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();

    expect(viewOffset).toBe(5);
    expect(cache.viewportOffset).toBe(5);
    expect(session.viewportOffset).toBe(5);

    // Output arrives + subscriber fires
    session.scrollbackLength += 10;
    subscriberFires(PTY_ID);

    expect(viewOffset).toBe(15);
  });

  test('scenario 2: scroll up while idle — offset stays at target', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 10);
    await drain();

    expect(viewOffset).toBe(10);
    expect(cache.viewportOffset).toBe(10);
    expect(session.viewportOffset).toBe(10);

    subscriberFires(PTY_ID);

    expect(viewOffset).toBe(10);
  });

  test('scenario 3: keypress snap to bottom — all state resets to 0', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 50);
    await drain();
    expect(viewOffset).toBe(50);

    scrollHandlers.handleScrollToBottom(PTY_ID);
    await drain();

    expect(viewOffset).toBe(0);
    expect(cache.viewportOffset).toBe(0);
    expect(session.viewportOffset).toBe(0);
  });

  test('scenario 4: scroll up after snap — starts from 0 not old position', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 300);
    await drain();
    expect(viewOffset).toBe(300);

    scrollHandlers.handleScrollToBottom(PTY_ID);
    await drain();
    expect(viewOffset).toBe(0);

    // Scroll up a little — must start from 0
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();

    expect(viewOffset).toBe(5);
    expect(cache.viewportOffset).toBe(5);
    expect(session.viewportOffset).toBe(5);
  });

  test('cache and view never disagree after animation settles', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 20);
    await drain();

    const mismatches = log.filter((l) => l.cacheOffset !== l.viewOffset);
    if (mismatches.length > 0) {
      console.error('Cache/view mismatches:', mismatches);
    }
    expect(mismatches.length).toBe(0);
  });

  test('BUG: async scrollToBottomBridge clobbers user scroll after snap', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 50);
    await drain();
    expect(viewOffset).toBe(50);

    // handleScrollToBottom sets all state to 0 synchronously
    scrollHandlers.handleScrollToBottom(PTY_ID);
    expect(viewOffset).toBe(0);
    expect(session.viewportOffset).toBe(0);
    expect(cache.viewportOffset).toBe(0);

    // User immediately scrolls up (animator now targeting 5)
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    // Don't drain yet — animator is still running

    // NOW the async scrollToBottomBridge resolves (setScrollOffset(0))
    // This is what happens in the real app: the async call sets session.offset = 0
    // and fires notifyScrollSubscribers
    session.viewportOffset = 0; // async bridge clobbers the session state
    const scrollbackDelta = session.scrollbackLength - session.lastScrollbackLength;
    const adjustedOffset = scrollbackDelta !== 0 && 0 > 0 ? 0 + scrollbackDelta : 0;
    const updateScrollState: TerminalScrollState = {
      viewportOffset: adjustedOffset,
      scrollbackLength: session.scrollbackLength,
      isAtBottom: adjustedOffset === 0,
      isAtScrollbackLimit: false,
    };

    // Subscriber fires from notifyScrollSubscribers
    const animating = scrollHandlers.isAnimating(PTY_ID);
    if (!animating) {
      viewOffset = updateScrollState.viewportOffset;
      cache.viewportOffset = updateScrollState.viewportOffset;
    }

    await drain();

    // The animator should have fixed it... or does the session clobber persist?
    // The onAnimate writes session.offset via setScrollOffsetNoNotify
    // But the async bridge already set session.offset = 0
    // The animator's onAnimate will set it back on the next tick
    // But between ticks, session.offset is 0, which is wrong
    //
    // For viewOffset: if the subscriber wrote 0 (because isAnimating was false
    // between the snapToTarget and the user's scroll), we get a flicker to 0.
    //
    // The key question: was isAnimating true when the subscriber fired?
    // After handleScrollToBottom's snapToTarget, isAnimating = false.
    // Then scrollTerminal sets a new target and isAnimating = true.
    // But there's a window: between snapToTarget and the next ensureLoop microtask,
    // isAnimating is FALSE. If the async bridge resolves in that window,
    // the subscriber writes 0 to viewOffset.
    expect(viewOffset).toBe(5);
  });

  test('TIMING: subscriber fires right after animator deactivates — no stale offset', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    // Wait for animation to COMPLETE
    await drain();

    // Explicitly check: animator should be inactive now
    expect(scrollHandlers.isAnimating(PTY_ID)).toBe(false);

    // All state should be at 5
    expect(viewOffset).toBe(5);
    expect(cache.viewportOffset).toBe(5);
    expect(session.viewportOffset).toBe(5);

    // Now the emulator fires a notification (content update, status bar refresh, etc.)
    // This is the most common scenario: user scrolls, then idle notification fires
    subscriberFires(PTY_ID);

    // Should still be at 5, no snap to bottom
    expect(viewOffset).toBe(5);
    expect(cache.viewportOffset).toBe(5);
  });

  test('TIMING: subscriber fires between onAnimate ticks during scroll', async () => {
    // Scroll and DON'T drain — let animation run one tick at a time
    scrollHandlers.scrollTerminal(PTY_ID, 20);

    // Run just one microtask (one tick of the animator)
    await new Promise<void>((r) => queueMicrotask(() => r()));

    // The animator should have ticked at least once
    // Now immediately fire the subscriber (simulates emulator notification)
    subscriberFires(PTY_ID);

    // Drain the rest
    await drain();

    // Final offset should be 20
    expect(viewOffset).toBe(20);
  });

  test('multiple scroll ups accumulate correctly', async () => {
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();
    expect(viewOffset).toBe(5);

    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();
    expect(viewOffset).toBe(10);

    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();
    expect(viewOffset).toBe(15);
  });

  test('BUG: stale animator state causes jump when scrolling after output adjustment', async () => {
    // 1. Scroll to bottom (handleScrollToBottom sets animator targetOffset=0)
    scrollHandlers.handleScrollToBottom(PTY_ID);
    await drain();
    expect(viewOffset).toBe(0);
    expect(scrollHandlers.isAnimating(PTY_ID)).toBe(false);

    // 2. Heavy output arrives while user is at bottom.
    //    getCurrentScrollState would adjust session.viewportOffset but
    //    user is at bottom (viewportOffset=0 → no adjustment).
    //    But let's say we manually simulate the cache adjusting.

    // 3. User scrolls up 5 — should use cache.viewportOffset (0) as base.
    //    This is correct: starts from 0, goes to 5.
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();
    expect(viewOffset).toBe(5);
    expect(cache.viewportOffset).toBe(5);

    // 4. Heavy output arrives while scrolled up.
    //    Emulate: session.scrollbackLength grows, getCurrentScrollState adjusts.
    session.scrollbackLength += 200;
    subscriberFires(PTY_ID);
    // After adjustment: viewOffset = 5 + 200 = 205
    expect(viewOffset).toBe(205);
    expect(cache.viewportOffset).toBe(205);

    // 5. Now the animator still has stale state: targetOffset=5, currentOffset=5, active=false.
    //    User scrolls up 3 more lines.
    //    scrollTerminal: getTargetOffset returns 5 (stale!), baseOffset = 5.
    //    BUG: baseOffset should be 205 (from cache), not 5.
    //    targetOffset = 5 + 3 = 8. Animation starts from currentOffset=5.
    scrollHandlers.scrollTerminal(PTY_ID, 3);
    await drain();

    // CRITICAL: viewOffset should be 208 (205 + 3), NOT 8 (5 + 3).
    // If the stale animator target was used, we'd see a jump backward.
    expect(viewOffset).toBe(208);
    expect(cache.viewportOffset).toBe(208);
  });

  test('BUG: stale animator after handleScrollToBottom causes jump to near-zero', async () => {
    // 1. User scrolls to bottom, then scrolls up 500 lines
    scrollHandlers.handleScrollToBottom(PTY_ID);
    await drain();
    scrollHandlers.scrollTerminal(PTY_ID, 100);
    await drain();
    expect(viewOffset).toBe(100);

    // 2. Heavy output arrives — adjusts offset upward
    session.scrollbackLength += 500;
    subscriberFires(PTY_ID);
    expect(viewOffset).toBe(600); // 100 + 500

    // 3. handleScrollToBottom is called (e.g., keypress while user is scrolled up
    //    in a different context — this shouldn't normally happen, but the async
    //    scrollToBottomBridge might clobber).
    //    More importantly: if the user presses a key to type, scrollToBottom fires.
    //    This sets animator state targetOffset=0.
    scrollHandlers.handleScrollToBottom(PTY_ID);
    expect(viewOffset).toBe(0);

    // 4. User immediately scrolls up 10
    scrollHandlers.scrollTerminal(PTY_ID, 10);
    await drain();

    // Should be starting from 0, so offset = 10
    expect(viewOffset).toBe(10);

    // 5. Now heavy output arrives while user is at offset 10
    session.scrollbackLength += 300;
    subscriberFires(PTY_ID);
    expect(viewOffset).toBe(310); // 10 + 300

    // 6. User scrolls up more — SHOULD base from 310 (cache)
    //    but stale animator targetOffset is 10 from step 4!
    scrollHandlers.scrollTerminal(PTY_ID, 5);
    await drain();

    // Should be 315 (310 + 5), NOT 15 (10 + 5).
    expect(viewOffset).toBe(315);
    expect(cache.viewportOffset).toBe(315);
  });

  test('BUG: continuous output + scroll interleaving preserves offset', async () => {
    // Simulates: find command running, user scrolling up intermittently
    scrollHandlers.scrollTerminal(PTY_ID, 50);
    await drain();
    expect(viewOffset).toBe(50);

    // Output batch 1
    session.scrollbackLength += 100;
    subscriberFires(PTY_ID);
    expect(viewOffset).toBe(150);

    // User scrolls up more
    scrollHandlers.scrollTerminal(PTY_ID, 20);
    await drain();
    expect(viewOffset).toBe(170);

    // Output batch 2
    session.scrollbackLength += 80;
    subscriberFires(PTY_ID);
    expect(viewOffset).toBe(250);

    // User scrolls up more
    scrollHandlers.scrollTerminal(PTY_ID, 15);
    await drain();
    expect(viewOffset).toBe(265);

    // Output batch 3 (large burst)
    session.scrollbackLength += 500;
    subscriberFires(PTY_ID);
    expect(viewOffset).toBe(765);

    // User scrolls up more
    scrollHandlers.scrollTerminal(PTY_ID, 10);
    await drain();
    expect(viewOffset).toBe(775);
  });
});
