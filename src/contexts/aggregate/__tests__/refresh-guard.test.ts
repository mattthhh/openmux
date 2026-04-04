/**
 * Tests for RefreshGuard - async disposable state guard.
 */

import { describe, it, expect } from 'bun:test';
import { RefreshGuard, createRefreshState } from '../subscriptions';

describe('RefreshGuard', () => {
  it('sets flag to true on creation', () => {
    const state = createRefreshState();
    new RefreshGuard(state, 'refreshInProgress');
    expect(state.refreshInProgress).toBe(true);
  });

  it('sets flag to false on dispose', async () => {
    const state = createRefreshState();
    const guard = new RefreshGuard(state, 'refreshInProgress');
    await guard[Symbol.asyncDispose]();
    expect(state.refreshInProgress).toBe(false);
  });

  it('works with subset refresh flag', async () => {
    const state = createRefreshState();
    const guard = new RefreshGuard(state, 'subsetRefreshInProgress');
    expect(state.subsetRefreshInProgress).toBe(true);
    await guard[Symbol.asyncDispose]();
    expect(state.subsetRefreshInProgress).toBe(false);
  });

  it('works with await using pattern', async () => {
    const state = createRefreshState();
    {
      await using _guard = new RefreshGuard(state, 'refreshInProgress');
      expect(state.refreshInProgress).toBe(true);
    }
    expect(state.refreshInProgress).toBe(false);
  });

  it('handles multiple guards on same state', async () => {
    const state = createRefreshState();
    const guard1 = new RefreshGuard(state, 'refreshInProgress');
    const guard2 = new RefreshGuard(state, 'subsetRefreshInProgress');

    expect(state.refreshInProgress).toBe(true);
    expect(state.subsetRefreshInProgress).toBe(true);

    await guard1[Symbol.asyncDispose]();
    expect(state.refreshInProgress).toBe(false);
    expect(state.subsetRefreshInProgress).toBe(true);

    await guard2[Symbol.asyncDispose]();
    expect(state.subsetRefreshInProgress).toBe(false);
  });

  it('resets flag even if created when already true', async () => {
    const state = createRefreshState();
    state.refreshInProgress = true;

    const guard = new RefreshGuard(state, 'refreshInProgress');
    expect(state.refreshInProgress).toBe(true);

    await guard[Symbol.asyncDispose]();
    expect(state.refreshInProgress).toBe(false);
  });
});
