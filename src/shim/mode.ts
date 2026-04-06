/**
 * Checks if the current process is running in shim server mode.
 * @returns true if --shim flag is present in argv
 */
export function isShimProcess(): boolean {
  return process.argv.includes('--shim');
}

/**
 * Checks if the current process is a shim client.
 * @returns true if not in shim server mode
 */
export function isShimClient(): boolean {
  return !isShimProcess();
}
