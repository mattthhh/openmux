/**
 * Configuration for openmux layout and styling
 */

import type { LayoutMode, Padding, Theme } from './types';

export interface LayoutConfig {
  /** Gap between panes in terminal cells */
  windowGap: number;

  /** Outer padding around all panes */
  outerPadding: Padding;

  /** Border width (typically 1) */
  borderWidth: number;

  /** Default layout mode for new workspaces */
  defaultLayoutMode: LayoutMode;
  defaultSplitRatio: number;

  /** Minimum pane sizes */
  minPaneWidth: number;
  minPaneHeight: number;

  /** Prefix key timeout in milliseconds */
  prefixTimeout: number;

  /** Default shell */
  defaultShell: string;

  /** Session storage directory path */
  sessionStoragePath: string;

  /** Auto-save interval in milliseconds (0 to disable) */
  autoSaveInterval: number;

  /** Auto-create a pane when switching to an empty workspace */
  autoCreatePaneOnEmptyWorkspace: boolean;
}

/** Get the session storage path (platform-aware) */
function getSessionStoragePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.config/openmux/sessions`;
}

export const DEFAULT_CONFIG: LayoutConfig = {
  windowGap: 0,
  outerPadding: { top: 0, right: 0, bottom: 0, left: 0 },
  borderWidth: 1,
  defaultLayoutMode: 'vertical',
  defaultSplitRatio: 0.5,
  minPaneWidth: 10,
  minPaneHeight: 5,
  prefixTimeout: 2000,
  defaultShell: process.env.SHELL ?? '/bin/bash',
  sessionStoragePath: getSessionStoragePath(),
  autoSaveInterval: 30000, // 30 seconds
  autoCreatePaneOnEmptyWorkspace: true, // Enabled by default
};

export const DEFAULT_THEME: Theme = {
  pane: {
    borderColor: '#444444',
    focusedBorderColor: '#00AAFF',
    copyModeBorderColor: '#8b5cf6',
    urgentBorderColor: '#FF5500',
    borderStyle: 'rounded',
    innerGap: 1,
    outerGap: 1,
    titleColor: '#888888',
    focusedTitleColor: '#FFFFFF',
    copyModeTitleColor: '#8b5cf6',
  },
  statusBar: {
    backgroundColor: '#1a1a1a',
    foregroundColor: '#CCCCCC',
    activeTabColor: '#00AAFF',
    inactiveTabColor: '#666666',
    successColor: '#33CC66',
  },
  ui: {
    mutedText: '#666666',
    listSelection: {
      foreground: '#FFFFFF',
      background: '#334455',
    },
    buttonFocus: {
      foreground: '#FFFFFF',
      background: '#334455',
    },
    copyNotification: {
      borderColor: 'auto',
      textColor: 'auto',
      backgroundColor: 'auto',
    },
    copyMode: {
      selection: {
        foreground: '#f5f3ff',
        background: '#7c3aed',
      },
      cursor: {
        foreground: '#1f2937',
        background: '#c4b5fd',
      },
    },
    aggregate: {
      selection: {
        foreground: '#FFFFFF',
        background: '#3b82f6',
        dim: '#93c5fd',
      },
      diff: {
        added: '#22c55e',
        removed: '#ef4444',
        addedSelected: '#86efac',
        removedSelected: '#fca5a5',
        binarySelected: '#cbd5f5',
      },
    },
  },
  searchAccentColor: '#FFAA00',
};
