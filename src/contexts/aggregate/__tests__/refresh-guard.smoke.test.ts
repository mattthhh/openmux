/**
 * Smoke tests for RefreshGuard - basic integration checks.
 */

import { describe, it, expect } from 'vitest';
import { RefreshGuard } from '../refresh/guard';
import { createRefreshState, type RefreshState } from '../subscriptions/types';

describe('RefreshGuard (smoke)', () => {
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
    state.refreshInProgress = true; // Pre-set to true
    
    const guard = new RefreshGuard(state, 'refreshInProgress');
    expect(state.refreshInProgress).toBe(true); // Still true
    
    await guard[Symbol.asyncDispose]();
    expect(state.refreshInProgress).toBe(false); // Now false
  });
});
