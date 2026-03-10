/**
 * PTY Service Production Implementation - Smoke Tests
 * Basic integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPtyService } from './index';
import { PtyNotFoundError } from '../../errors';
import type { PtyService } from './interface';

describe('createPtyService (smoke)', () => {
  let service: PtyService;

  beforeEach(() => {
    service = createPtyService({ defaultShell: '/bin/bash' });
  });

  afterEach(async () => {
    await service.destroyAll();
    service.dispose();
  });

  it('should create and destroy PTY', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    
    expect(ptyId).not.toBeInstanceOf(Error);
    if (ptyId instanceof Error) return;
    
    // Should be in list
    const ids = await service.listAll();
    expect(ids).toContain(ptyId);
    
    // Destroy
    await service.destroy(ptyId);
    
    // Should be removed from list
    const idsAfter = await service.listAll();
    expect(idsAfter).not.toContain(ptyId);
  });

  it('should return PtyNotFoundError for invalid PTY', async () => {
    const result = await service.getSession('invalid-pty' as any);
    expect(result).toBeInstanceOf(PtyNotFoundError);
  });

  it('should return PtyNotFoundError for destroyed PTY', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    
    if (ptyId instanceof Error) {
      throw ptyId;
    }
    
    await service.destroy(ptyId);
    
    const result = await service.getSession(ptyId);
    expect(result).toBeInstanceOf(PtyNotFoundError);
  });

  it('should subscribe and receive updates', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    
    if (ptyId instanceof Error) {
      throw ptyId;
    }
    
    const updates: any[] = [];
    const unsubscribe = await service.subscribe(ptyId, (state) => {
      updates.push(state);
    });
    
    expect(unsubscribe).toBeTypeOf('function');
    expect(updates.length).toBeGreaterThan(0); // Initial state
    
    // Cleanup
    unsubscribe();
  });

  it('should support unified subscriptions', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    
    if (ptyId instanceof Error) {
      throw ptyId;
    }
    
    const updates: any[] = [];
    const unsubscribe = await service.subscribeUnified(ptyId, (update) => {
      updates.push(update);
    });
    
    expect(unsubscribe).toBeTypeOf('function');
    expect(updates.length).toBeGreaterThan(0); // Initial update
    
    // Cleanup
    unsubscribe();
  });

  it('should handle multiple PTYs', async () => {
    const ptyIds: any[] = [];
    
    for (let i = 0; i < 3; i++) {
      const id = await service.create({ cols: 80, rows: 24 });
      if (id instanceof Error) throw id;
      ptyIds.push(id);
    }
    
    const list = await service.listAll();
    expect(list).toHaveLength(3);
    
    for (const id of ptyIds) {
      expect(list).toContain(id);
    }
  });

  it('should destroy all PTYs', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await service.create({ cols: 80, rows: 24 });
      if (id instanceof Error) throw id;
    }
    
    expect(await service.listAll()).toHaveLength(3);
    
    await service.destroyAll();
    
    expect(await service.listAll()).toHaveLength(0);
  });
});
