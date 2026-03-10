/**
 * RefreshGuard - AsyncDisposable guard for refresh state flags.
 * 
 * Manages refresh state flags with automatic cleanup when the scope exits.
 * Uses TypeScript's `using` keyword for Go-like defer behavior.
 */

import type { RefreshState, RefreshFlagKey } from '../subscriptions/types';

/**
 * AsyncDisposable guard for refresh state flags.
 * Sets the flag to true on creation, resets to false on disposal.
 * 
 * @example
 * ```typescript
 * async function refreshData() {
 *   if (refreshState.refreshInProgress) return;
 *   await using _guard = new RefreshGuard(refreshState, 'refreshInProgress');
 *   
 *   // Do work while flag is true...
 *   await fetchData();
 *   
 *   // Flag automatically reset here, even if fetchData() throws
 * }
 * ```
 */
export class RefreshGuard implements AsyncDisposable {
  constructor(
    private state: RefreshState,
    private key: RefreshFlagKey
  ) {
    this.state[this.key] = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.state[this.key] = false;
  }
}
