/**
 * Kitty graphics offload configuration utilities.
 *
 * Offloading writes large image data to temporary files instead of
 * sending through the PTY. This is controlled by environment variables:
 *
 * - OPENMUX_KITTY_OFFLOAD_THRESHOLD: Size in bytes above which to offload
 *   (default: 512KB, 0 = disable, auto-disabled for SSH sessions)
 * - OPENMUX_KITTY_OFFLOAD_CLEANUP_MS: Delay before deleting temp files
 *   (default: 5000ms, 0 = immediate cleanup)
 *
 * SSH sessions auto-disable offloading since temp files may not be
 * accessible across host/guest boundaries.
 */

const DEFAULT_OFFLOAD_THRESHOLD = 512 * 1024;
const DEFAULT_OFFLOAD_CLEANUP_MS = 5000;

/**
 * Check if running in an SSH session.
 * Detects SSH_CONNECTION, SSH_CLIENT, or SSH_TTY environment variables.
 */
export function isSshSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

/**
 * Resolve the offload threshold from environment.
 *
 * Returns 0 (disabled) for SSH sessions, otherwise uses the configured
 * threshold or the 512KB default.
 *
 * @returns Threshold in bytes, or 0 to disable offloading
 */
export function resolveKittyOffloadThreshold(): number {
  const raw = process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return isSshSession() ? 0 : DEFAULT_OFFLOAD_THRESHOLD;
}

/**
 * Resolve the cleanup delay from environment.
 *
 * @returns Delay in milliseconds before deleting temp files
 */
export function resolveKittyOffloadCleanupDelay(): number {
  const raw = process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_OFFLOAD_CLEANUP_MS;
}
