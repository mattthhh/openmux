/**
 * Shim Mapping Handler - Litmus Tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { createShimServerState } from '../server-state';
import {
  registerMapping,
  removeMappingForPty,
  getPaneForPty,
  clearAllMappings,
  getPtyIdsForSession,
} from './mapping';

describe('shim handlers/mapping (litmus)', () => {
  let state: ReturnType<typeof createShimServerState>;

  beforeEach(() => {
    state = createShimServerState();
  });

  it('should register session/pane to pty mapping', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    
    expect(state.sessionPanes.has('session-1')).toBe(true);
    expect(state.ptyToPane.has('pty-1')).toBe(true);
    expect(state.sessionPanes.get('session-1')?.get('pane-a')).toBe('pty-1');
  });

  it('should retrieve pane for pty', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    
    const info = getPaneForPty(state, 'pty-1');
    expect(info).toEqual({ sessionId: 'session-1', paneId: 'pane-a' });
  });

  it('should return undefined for unmapped pty', () => {
    const info = getPaneForPty(state, 'pty-unknown');
    expect(info).toBeUndefined();
  });

  it('should remove mapping for pty', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    
    removeMappingForPty(state, 'pty-1');
    
    expect(state.ptyToPane.has('pty-1')).toBe(false);
    const sessionMap = state.sessionPanes.get('session-1');
    expect(sessionMap === undefined || !sessionMap.has('pane-a')).toBe(true);
  });

  it('should clean up empty session maps', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    removeMappingForPty(state, 'pty-1');
    
    expect(state.sessionPanes.has('session-1')).toBe(false);
  });

  it('should keep session map if other panes remain', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    registerMapping(state, 'session-1', 'pane-b', 'pty-2');
    
    removeMappingForPty(state, 'pty-1');
    
    expect(state.sessionPanes.has('session-1')).toBe(true);
    expect(state.sessionPanes.get('session-1')?.has('pane-b')).toBe(true);
  });

  it('should get all pty IDs for a session', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    registerMapping(state, 'session-1', 'pane-b', 'pty-2');
    
    const ptyIds = getPtyIdsForSession(state, 'session-1');
    expect(ptyIds).toHaveLength(2);
    expect(ptyIds).toContain('pty-1');
    expect(ptyIds).toContain('pty-2');
  });

  it('should return empty array for unknown session', () => {
    const ptyIds = getPtyIdsForSession(state, 'unknown');
    expect(ptyIds).toEqual([]);
  });

  it('should clear all mappings', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    registerMapping(state, 'session-2', 'pane-b', 'pty-2');
    
    clearAllMappings(state);
    
    expect(state.sessionPanes.size).toBe(0);
    expect(state.ptyToPane.size).toBe(0);
  });

  it('should handle multiple sessions', () => {
    registerMapping(state, 'session-1', 'pane-a', 'pty-1');
    registerMapping(state, 'session-2', 'pane-b', 'pty-2');
    
    expect(state.sessionPanes.size).toBe(2);
    expect(getPaneForPty(state, 'pty-1')?.sessionId).toBe('session-1');
    expect(getPaneForPty(state, 'pty-2')?.sessionId).toBe('session-2');
  });
});
