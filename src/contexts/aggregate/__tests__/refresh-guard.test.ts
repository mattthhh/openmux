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

  it('works with await using pattern', async () => {
    const state = createRefreshState();
    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await using _guard = new RefreshGuard(state, 'refreshInProgress');
      expect(state.refreshInProgress).toBe(true);
    }
    expect(state.refreshInProgress).toBe(false);
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
