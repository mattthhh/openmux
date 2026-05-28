/**
 * Scrollback configuration (hot buffer + archive).
 */

const BYTES_PER_MB = 1024 * 1024;

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const HOT_SCROLLBACK_LIMIT = parseEnvNumber(
  'OPENMUX_SCROLLBACK_HOT_LIMIT',
  parseEnvNumber('SCROLLBACK_LIMIT', 20000)
);

export const SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY =
  parseEnvNumber('OPENMUX_SCROLLBACK_ARCHIVE_MAX_MB', 200) * BYTES_PER_MB;

export const SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL =
  parseEnvNumber('OPENMUX_SCROLLBACK_ARCHIVE_GLOBAL_MAX_MB', 2000) * BYTES_PER_MB;

export const SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES = parseEnvNumber(
  'OPENMUX_SCROLLBACK_ARCHIVE_CHUNK_LINES',
  4000
);
