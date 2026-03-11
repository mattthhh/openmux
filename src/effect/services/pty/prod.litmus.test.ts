/**
 * PTY Service Production Implementation - Litmus Tests
 * Fast, focused tests for core functionality
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PtyState } from './state';
import { createTestPtyService } from './test';
import type { PtyService } from './interface';

describe('PtyState (litmus)', () => {
  let state: PtyState;

  beforeEach(() => {
    state = new PtyState();
  });

  it('should start empty', () => {
    expect(state.size).toBe(0);
    expect(state.isEmpty()).toBe(true);
    expect(state.list()).toEqual([]);
  });

  it('should store and retrieve sessions', () => {
    const mockSession = { id: 'pty-1' } as any;
    state.set('pty-1' as any, mockSession);
    
    expect(state.size).toBe(1);
    expect(state.isEmpty()).toBe(false);
    expect(state.get('pty-1' as any)).toBe(mockSession);
    expect(state.has('pty-1' as any)).toBe(true);
  });

  it('should delete sessions', () => {
    const mockSession = { id: 'pty-1' } as any;
    state.set('pty-1' as any, mockSession);
    
    expect(state.delete('pty-1' as any)).toBe(true);
    expect(state.delete('pty-1' as any)).toBe(false);
    expect(state.size).toBe(0);
  });

  it('should list all IDs', () => {
    state.set('pty-1' as any, { id: 'pty-1' } as any);
    state.set('pty-2' as any, { id: 'pty-2' } as any);
    
    const list = state.list();
    expect(list).toHaveLength(2);
    expect(list).toContain('pty-1');
    expect(list).toContain('pty-2');
  });

  it('should iterate over entries', () => {
    state.set('pty-1' as any, { id: 'pty-1' } as any);
    
    let count = 0;
    for (const [id, session] of state.entries()) {
      expect(id).toBe('pty-1');
      expect(session.id).toBe('pty-1');
      count++;
    }
    expect(count).toBe(1);
  });

  it('should support forEach', () => {
    state.set('pty-1' as any, { id: 'pty-1' } as any);
    
    let called = false;
    state.forEach((session, id) => {
      expect(id).toBe('pty-1');
      expect(session.id).toBe('pty-1');
      called = true;
    });
    expect(called).toBe(true);
  });

  it('should clear all sessions', () => {
    state.set('pty-1' as any, { id: 'pty-1' } as any);
    state.set('pty-2' as any, { id: 'pty-2' } as any);
    
    state.clear();
    expect(state.size).toBe(0);
    expect(state.isEmpty()).toBe(true);
  });
});

describe('createPtyService (litmus)', () => {
  let service: PtyService;

  beforeEach(() => {
    service = createTestPtyService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('should create a service with all required methods', () => {
    expect(service.create).toBeTypeOf('function');
    expect(service.write).toBeTypeOf('function');
    expect(service.resize).toBeTypeOf('function');
    expect(service.destroy).toBeTypeOf('function');
    expect(service.getCwd).toBeTypeOf('function');
    expect(service.subscribe).toBeTypeOf('function');
    expect(service.subscribeUnified).toBeTypeOf('function');
    expect(service.listAll).toBeTypeOf('function');
    expect(service.dispose).toBeTypeOf('function');
  });

  it('should return empty list initially', async () => {
    const ids = await service.listAll();
    expect(ids).toEqual([]);
  });

  it('should list created PTYs', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    
    if (ptyId instanceof Error) {
      throw ptyId;
    }
    
    const ids = await service.listAll();
    expect(ids).toContain(ptyId);
  });
});
