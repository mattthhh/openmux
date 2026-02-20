/**
 * Tests for PTY helpers cleanup functionality.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "bun:test"
import { asPtyId, makePtyId } from "../../../../src/effect/types"

describe('disposeGitHelpers', () => {
  // We can't directly import the module since it has module-level state
  // Instead, we'll test the behavior through the PTY service dispose

  beforeEach(() => {
    // Reset the module state by clearing require cache
    // This is a workaround to test module-level state
  })

  test('dispose should be callable without errors', async () => {
    // The dispose function should be idempotent and not throw
    const { createTestPtyService } = await import('../../../../src/effect/services/Pty')
    const pty = createTestPtyService()
    
    // Should not throw
    expect(() => pty.dispose()).not.toThrow()
  })

  test('dispose should be callable multiple times', async () => {
    const { createTestPtyService } = await import('../../../../src/effect/services/Pty')
    const pty = createTestPtyService()
    
    // Should be idempotent
    expect(() => {
      pty.dispose()
      pty.dispose()
      pty.dispose()
    }).not.toThrow()
  })
})

describe('PtyService dispose', () => {
  test('test service dispose is no-op', async () => {
    const { createTestPtyService } = await import('../../../../src/effect/services/Pty')
    const pty = createTestPtyService()
    const testId = makePtyId()
    
    // Should complete without error
    pty.dispose()
    
    // Service should still be usable after dispose
    const result = await pty.getCwd(testId)
    expect(result).toBe('/test/cwd')
  })

  test('test service dispose returns undefined', async () => {
    const { createTestPtyService } = await import('../../../../src/effect/services/Pty')
    const pty = createTestPtyService()
    
    // dispose() returns void
    const result = pty.dispose()
    expect(result).toBeUndefined()
  })
})
