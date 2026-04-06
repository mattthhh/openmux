/**
 * PTY service for managing terminal pseudo-terminal sessions (errore version).
 * Wraps zig-pty with native libghostty-vt parsing.
 *
 * This file is now a re-export hub for backward compatibility.
 * The actual implementations have been split into modular files:
 * - pty/interface.ts - PtyService interface
 * - pty/state.ts - PtyState class
 * - pty/prod.ts - Production implementation
 * - pty/shim.ts - Shim client implementation
 * - pty/test.ts - Test/mock implementation
 */

// Re-export configuration and service interface
export type { PtyServiceConfig } from './pty/prod';
export type { PtyService, PtyTitleChangeEvent, GetPtyGitInfoOptions } from './pty/interface';

// Re-export state management
export { PtyState } from './pty/state';

// Re-export implementations
export { createPtyService } from './pty/prod';
export { createShimPtyService } from './pty/shim';
export { createTestPtyService } from './pty/test';
