/**
 * Litmus tests for subscription types - fast, single concept tests.
 */

import { describe, it, expect } from 'vitest';
import { 
  createSubscriptionManager, 
  createRefreshState,
  type SubscriptionManager,
  type RefreshState 
} from '../subscriptions/types';

describe('subscription types (litmus)', () => {
  describe('createSubscriptionManager', () => {
    it('creates manager with all null subscriptions', () => {
      const manager = createSubscriptionManager();
      
      expect(manager.lifecycle).toBeNull();
      expect(manager.titleChange).toBeNull();
      expect(manager.polling).toBeNull();
    });
  });

  describe('createRefreshState', () => {
    it('creates state with all flags false', () => {
      const state = createRefreshState();
      
      expect(state.refreshInProgress).toBe(false);
      expect(state.subsetRefreshInProgress).toBe(false);
      expect(state.pendingFullRefresh).toBe(false);
      expect(state.pendingSubsetPtyIds).toBeInstanceOf(Set);
      expect(state.pendingSubsetPtyIds.size).toBe(0);
    });
  });

  describe('SubscriptionManager type', () => {
    it('allows setting subscription functions', () => {
      const manager: SubscriptionManager = createSubscriptionManager();
      
      const mockUnsub = () => {};
      manager.lifecycle = mockUnsub;
      
      expect(manager.lifecycle).toBe(mockUnsub);
    });
  });

  describe('RefreshState type', () => {
    it('allows modifying flags and pending set', () => {
      const state: RefreshState = createRefreshState();
      
      state.refreshInProgress = true;
      state.pendingSubsetPtyIds.add('pty-1');
      
      expect(state.refreshInProgress).toBe(true);
      expect(state.pendingSubsetPtyIds.has('pty-1')).toBe(true);
    });
  });
});
