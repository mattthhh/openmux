import { describe, test, expect } from 'bun:test';
import { ScrollAnimator } from '../../src/terminal/scroll-animation';

describe('ScrollAnimator', () => {
  test('setTarget activates animation when target differs from current', () => {
    const animator = new ScrollAnimator();
    const steps: Array<{ ptyId: string; offset: number }> = [];
    animator.setOnAnimate((ptyId, offset) => steps.push({ ptyId, offset }));

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 10, 100);

    expect(animator.isAnimating('pty1')).toBe(true);
    expect(animator.getTargetOffset('pty1')).toBe(10);
    expect(animator.getCurrentOffset('pty1')).toBe(0);

    animator.cleanup();
  });

  test('setTarget does not activate animation when target equals current', () => {
    const animator = new ScrollAnimator();
    animator.initialize('pty1', 5);
    animator.setTarget('pty1', 5, 100);

    expect(animator.isAnimating('pty1')).toBe(false);

    animator.cleanup();
  });

  test('tick moves currentOffset toward target by speed', () => {
    const animator = new ScrollAnimator({ speed: 2, easing: 0.5 });

    const steps: number[] = [];
    animator.setOnAnimate((_ptyId, offset) => steps.push(offset));

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 10, 100);

    animator.tick();
    // speed=2, distance=10, should step by 2
    expect(animator.getCurrentOffset('pty1')).toBe(2);
    expect(steps).toEqual([2]);

    animator.tick();
    expect(animator.getCurrentOffset('pty1')).toBe(4);

    animator.cleanup();
  });

  test('tick uses easing when distance <= speed', () => {
    const animator = new ScrollAnimator({ speed: 2, easing: 0.5 });

    const steps: number[] = [];
    animator.setOnAnimate((_ptyId, offset) => steps.push(offset));

    animator.initialize('pty1', 8);
    animator.setTarget('pty1', 10, 100);

    // distance=2, speed=2, distance <= speed → easing applies
    // step = round(2 * 0.5) = 1
    animator.tick();
    expect(animator.getCurrentOffset('pty1')).toBe(9);

    // distance=1, <= speed → step = round(1 * 0.5) = 1 (min 1)
    animator.tick();
    expect(animator.getCurrentOffset('pty1')).toBe(10);

    // One more tick to detect convergence and deactivate
    animator.tick();
    expect(animator.isAnimating('pty1')).toBe(false);

    animator.cleanup();
  });

  test('snapToTarget immediately sets currentOffset to target', () => {
    const animator = new ScrollAnimator();

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 50, 100);

    expect(animator.isAnimating('pty1')).toBe(true);

    const result = animator.snapToTarget('pty1');
    expect(result).toBe(50);
    expect(animator.getCurrentOffset('pty1')).toBe(50);
    expect(animator.isAnimating('pty1')).toBe(false);

    animator.cleanup();
  });

  test('adjustOffset shifts both target and current when animating', () => {
    const animator = new ScrollAnimator({ speed: 2, easing: 0.5 });

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 10, 100);

    // Tick once so we're mid-animation
    animator.tick();
    expect(animator.getCurrentOffset('pty1')).toBe(2);

    // External adjustment: new output added 3 lines of scrollback
    animator.adjustOffset('pty1', 3);

    expect(animator.getCurrentOffset('pty1')).toBe(5);
    expect(animator.getTargetOffset('pty1')).toBe(13);

    animator.cleanup();
  });

  test('adjustOffset is no-op when not animating', () => {
    const animator = new ScrollAnimator();

    animator.initialize('pty1', 5);
    // No setTarget → not animating

    animator.adjustOffset('pty1', 3);

    expect(animator.getCurrentOffset('pty1')).toBe(5);
    expect(animator.getTargetOffset('pty1')).toBe(5);

    animator.cleanup();
  });

  test('remove clears state for a pty', () => {
    const animator = new ScrollAnimator();

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 10, 100);

    animator.remove('pty1');

    expect(animator.getTargetOffset('pty1')).toBeUndefined();
    expect(animator.getCurrentOffset('pty1')).toBeUndefined();
    expect(animator.isAnimating('pty1')).toBe(false);

    animator.cleanup();
  });

  test('setTarget clamps to [0, maxOffset]', () => {
    const animator = new ScrollAnimator();

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', -5, 100);
    expect(animator.getTargetOffset('pty1')).toBe(0);

    animator.setTarget('pty1', 200, 100);
    expect(animator.getTargetOffset('pty1')).toBe(100);

    animator.cleanup();
  });

  test('tick with negative direction scrolls down', () => {
    const animator = new ScrollAnimator({ speed: 2, easing: 0.5 });

    const steps: number[] = [];
    animator.setOnAnimate((_ptyId, offset) => steps.push(offset));

    animator.initialize('pty1', 10);
    animator.setTarget('pty1', 0, 100);

    animator.tick();
    // distance = -10, speed = 2, step = -2
    expect(animator.getCurrentOffset('pty1')).toBe(8);
    expect(steps).toEqual([8]);

    animator.cleanup();
  });

  test('multiple ptys animate independently', () => {
    const animator = new ScrollAnimator({ speed: 2, easing: 0.5 });

    animator.initialize('pty1', 0);
    animator.initialize('pty2', 0);
    animator.setTarget('pty1', 10, 100);
    animator.setTarget('pty2', 20, 100);

    animator.tick();
    expect(animator.getCurrentOffset('pty1')).toBe(2);
    expect(animator.getCurrentOffset('pty2')).toBe(2);

    animator.cleanup();
  });

  test('animation converges to exact target', () => {
    const animator = new ScrollAnimator({ speed: 3, easing: 0.5 });

    animator.initialize('pty1', 0);
    animator.setTarget('pty1', 7, 100);

    // Tick until converged
    for (let i = 0; i < 20; i++) {
      animator.tick();
      if (!animator.isAnimating('pty1')) break;
    }

    expect(animator.getCurrentOffset('pty1')).toBe(7);
    expect(animator.isAnimating('pty1')).toBe(false);

    animator.cleanup();
  });
});
