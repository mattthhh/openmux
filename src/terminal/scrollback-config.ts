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

/**
 * Native hard cap on scrollback lines enforced by ghostty itself on every write().
 * This is a safety net — the JS archiver normally keeps scrollback at
 * HOT_SCROLLBACK_LIMIT, but if the archiver falls behind under sustained output,
 * the native trim prevents unbounded RAM growth.
 *
 * Defaults to 4× HOT_SCROLLBACK_LIMIT (80K lines) to give the archiver ample
 * headroom. At 120 cols × 16 bytes/cell, this caps per-PTY scrollback RAM at
 * ~154 MB. Set via OPENMUX_SCROLLBACK_HARD_LIMIT env var.
 */
export const SCROLLBACK_HARD_LIMIT = parseEnvNumber(
  'OPENMUX_SCROLLBACK_HARD_LIMIT',
  HOT_SCROLLBACK_LIMIT * 4
);

export const SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY =
  parseEnvNumber('OPENMUX_SCROLLBACK_ARCHIVE_MAX_MB', 200) * BYTES_PER_MB;

export const SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL =
  parseEnvNumber('OPENMUX_SCROLLBACK_ARCHIVE_GLOBAL_MAX_MB', 2000) * BYTES_PER_MB;

export const SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES = parseEnvNumber(
  'OPENMUX_SCROLLBACK_ARCHIVE_CHUNK_LINES',
  4000
);
