/**
 * Application configuration using plain TypeScript (no Effect).
 * Replaces Config.ts with simple async/sync factory functions.
 */
import { ConfigError } from './errors';

/** Application configuration */
export interface AppConfig {
  windowGap: number;
  minPaneWidth: number;
  minPaneHeight: number;
  stackRatio: number;
  defaultShell: string;
  sessionStoragePath: string;
  templateStoragePath: string;
}

/**
 * Parse an integer from a string value.
 * Returns null if parsing fails.
 */
function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parse a float from a string value.
 * Returns null if parsing fails.
 */
function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Load application configuration from environment variables.
 * Falls back to sensible defaults for missing values.
 *
 * Environment variables:
 * - HOME / USERPROFILE: Base directory for config paths
 * - SHELL: Default shell to use
 * - OPENMUX_WINDOW_GAP: Gap between panes (integer)
 * - OPENMUX_MIN_PANE_WIDTH: Minimum pane width (integer)
 * - OPENMUX_MIN_PANE_HEIGHT: Minimum pane height (integer)
 * - OPENMUX_STACK_RATIO: Stack pane ratio (number 0-1)
 *
 * Returns ConfigError if a critical value cannot be determined.
 */
export async function loadAppConfig(): Promise<ConfigError | AppConfig> {
  // Get home directory (critical)
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    return new ConfigError({
      reason: 'Unable to determine home directory (HOME or USERPROFILE not set)',
    });
  }

  // Get shell (has default)
  const defaultShell = process.env.SHELL ?? '/bin/bash';

  // Parse integer values with defaults
  const windowGap = parseIntOrNull(process.env.OPENMUX_WINDOW_GAP) ?? 0;
  const minPaneWidth = parseIntOrNull(process.env.OPENMUX_MIN_PANE_WIDTH) ?? 20;
  const minPaneHeight = parseIntOrNull(process.env.OPENMUX_MIN_PANE_HEIGHT) ?? 5;

  // Parse float value with default
  const stackRatio = parseFloatOrNull(process.env.OPENMUX_STACK_RATIO) ?? 0.5;

  return {
    windowGap,
    minPaneWidth,
    minPaneHeight,
    stackRatio,
    defaultShell,
    sessionStoragePath: `${home}/.config/openmux/sessions`,
    templateStoragePath: `${home}/.config/openmux/templates`,
  };
}
