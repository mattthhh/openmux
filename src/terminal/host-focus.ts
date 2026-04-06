/**
 * Host focus state tracking for terminal focus reporting.
 *
 * Tracks whether the host terminal (the outer terminal running openmux)
 * is focused. This is used to report focus state to applications inside
 * panes when they request focus change notifications (mode 1004).
 *
 * null = unknown/initial state
 * true = host terminal is focused
 * false = host terminal is not focused
 */

export type HostFocusState = boolean | null;

let hostFocusState: HostFocusState = null;

/**
 * Set the host terminal focus state.
 * Called when the outer terminal reports focus changes via OSC 777 focus.
 *
 * @param state - New focus state, or null to reset
 */
export function setHostFocusState(state: HostFocusState): void {
  hostFocusState = state;
}

/**
 * Get the current host terminal focus state.
 *
 * @returns Current focus state, or null if not yet determined
 */
export function getHostFocusState(): HostFocusState {
  return hostFocusState;
}
