/**
 * Visible PTY Registry
 *
 * Tracks which PTYs have a mounted TerminalView component.
 * Used by the priority system to determine scheduling behavior:
 * - focused + visible = full priority
 * - not focused + visible = background-visible (1fps)
 * - not visible = background-hidden (paused)
 *
 * This is a lightweight singleton (like focused-pty-registry) to bridge
 * between the UI layer (which knows about mounted components) and the
 * service layer (which needs to know visibility for scheduling).
 */

const visiblePtys = new Set<string>();

/** Mark a PTY as having a mounted TerminalView component. */
export function setVisiblePty(ptyId: string, visible: boolean): void {
  if (visible) {
    visiblePtys.add(ptyId);
  } else {
    visiblePtys.delete(ptyId);
  }
}

/** Check if a PTY is currently visible (has a mounted TerminalView). */
export function isPtyVisible(ptyId: string): boolean {
  return visiblePtys.has(ptyId);
}
