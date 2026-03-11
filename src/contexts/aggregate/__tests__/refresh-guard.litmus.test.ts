/**
 * Litmus tests for RefreshGuard - fast, single concept tests.
 */

import { describe, it, expect } from 'bun:test';
import { RefreshGuard } from '../refresh/guard';
import { createRefreshState, type RefreshState } from '../subscriptions/types';

describe('RefreshGuard (litmus)', () => {
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

  it('works with subset refresh flag', () => {
    const state = createRefreshState();
    
    new RefreshGuard(state, 'subsetRefreshInProgress');
    
    expect(state.subsetRefreshInProgress).toBe(true);
  });

  it('resets subset refresh flag on dispose', async () => {
    const state = createRefreshState();
    const guard = new RefreshGuard(state, 'subsetRefreshInProgress');
    
    await guard[Symbol.asyncDispose]();
    
    expect(state.subsetRefreshInProgress).toBe(false);
  });
});
