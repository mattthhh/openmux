/**
 * PTY Service Shim Implementation - Litmus Tests
 */
import { describe, it, expect } from 'bun:test';
import { createShimPtyService } from './index';

describe('createShimPtyService (litmus)', () => {
  it('should create a service with all required methods', () => {
    const service = createShimPtyService();

    expect(service.create).toBeTypeOf('function');
    expect(service.write).toBeTypeOf('function');
    expect(service.resize).toBeTypeOf('function');
    expect(service.destroy).toBeTypeOf('function');
    expect(service.getCwd).toBeTypeOf('function');
    expect(service.subscribe).toBeTypeOf('function');
    expect(service.subscribeUnified).toBeTypeOf('function');
    expect(service.listAll).toBeTypeOf('function');
    expect(service.dispose).toBeTypeOf('function');
    expect(service.subscribeToLifecycle).toBeTypeOf('function');
    expect(service.subscribeToAllTitleChanges).toBeTypeOf('function');
  });
});
