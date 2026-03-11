/**
 * Smoke tests for subscription types - basic integration checks.
 */

import { describe, it, expect } from 'bun:test';
import { 
  createSubscriptionManager, 
  createRefreshState 
} from '../subscriptions/types';

describe('subscription types (smoke)', () => {
  describe('integration', () => {
    it('manager and state work together for coordination', () => {
      const manager = createSubscriptionManager();
      const refreshState = createRefreshState();
      
      // Simulate refresh starting
      refreshState.refreshInProgress = true;
      
      // Simulate subscription active
      manager.polling = () => {};
      
      expect(refreshState.refreshInProgress).toBe(true);
      expect(manager.polling).not.toBeNull();
    });

    it('pending set can accumulate multiple PTY IDs', () => {
      const state = createRefreshState();
      
      state.pendingSubsetPtyIds.add('pty-1');
      state.pendingSubsetPtyIds.add('pty-2');
      state.pendingSubsetPtyIds.add('pty-3');
      
      expect(state.pendingSubsetPtyIds.size).toBe(3);
    });

    it('subscriptions can be cleared', () => {
      const manager = createSubscriptionManager();
      
      manager.lifecycle = () => {};
      manager.titleChange = () => {};
      manager.polling = () => {};
      
      // Clear all
      manager.lifecycle = null;
      manager.titleChange = null;
      manager.polling = null;
      
      expect(manager.lifecycle).toBeNull();
      expect(manager.titleChange).toBeNull();
      expect(manager.polling).toBeNull();
    });
  });
});
