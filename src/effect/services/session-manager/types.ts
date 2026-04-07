/**
 * Types for SessionManager service
 * Migrated from Effect to errore
 */

/**
 * Workspace state for serialization
 * Represents the in-memory state of a workspace
 */
export type WorkspaceLayoutNode =
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      ratio: number;
      first: WorkspaceLayoutNode;
      second: WorkspaceLayoutNode;
    }
  | {
      id: string;
      ptyId?: string;
      title?: string;
      cwd?: string;
    };

export interface WorkspaceState {
  mainPane: WorkspaceLayoutNode | null;
  stackPanes: Array<WorkspaceLayoutNode>;
  focusedPaneId?: string;
  layoutMode: 'vertical' | 'horizontal' | 'stacked';
  activeStackIndex: number;
  lastFocusedPaneIds?: Array<string | null>;
  zoomed: boolean;
  label?: string;
}
