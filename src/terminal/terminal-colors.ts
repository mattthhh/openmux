/**
 * Terminal Color Detection Module
 *
 * Detects terminal colors from environment variables.
 * This enables openmux to inherit the user's terminal theme.
 *
 * Note: OSC-based color queries are best-effort with a short timeout and
 * fall back to environment detection to avoid interfering with stdin.
 */

import * as errore from 'errore';
import { writeHostSequence } from './host-output';
import { TerminalColorError } from '../effect/errors';

/**
 * Terminal color information
 */
export interface TerminalColors {
  /** Foreground color in 0xRRGGBB format */
  foreground: number;
  /** Background color in 0xRRGGBB format */
  background: number;
  /** 256-color palette, each in 0xRRGGBB format */
  palette: number[];
  /** True if using fallback defaults */
  isDefault: boolean;
}

let cachedColors: TerminalColors | null = null;
let lastNonDefaultColors: TerminalColors | null = null;

/**
 * Parse OSC color payloads such as:
 * - rgb:xxxx/yyyy/zzzz
 * - #rrggbb
 */
function parseOscColor(payload: string): number | null {
  // rgb:xxxx/yyyy/zzzz
  const rgbMatch = payload.match(
    /^rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})$/
  );
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map((p) => parseInt(p.slice(0, 2), 16));
    return (r << 16) | (g << 8) | b;
  }

  // #rrggbb
  const hexMatch = payload.match(/^#?([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  return null;
}

type OscColorsResult = {
  foreground?: number;
  background?: number;
  paletteOverrides?: Map<number, number>;
};

/**
 * Try to query colors from the host terminal using OSC 10/11.
 * This should be called before the TUI takes over stdin.
 */
async function queryOscColors(
  timeoutMs: number,
  options?: { requirePalette?: boolean; requireFgBg?: boolean }
): Promise<TerminalColorError | OscColorsResult | null> {
  // Only attempt when we have a controllable TTY with raw mode.
  const stdin = process.stdin as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void;
    isRaw?: boolean;
  };
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return null;
  }

  return await new Promise<TerminalColorError | OscColorsResult | null>((resolve) => {
    let buffer = '';
    let resolved = false;
    let fg: number | undefined;
    let bg: number | undefined;
    const OSC_PREFIX = '(?:\\x1b\\]|\\x9d)';
    const OSC_TERM = '(?:\\x07|\\x1b\\\\|\\x9c)';
    const OSC_PAYLOAD = '([^\\x07\\x1b\\x9c]+)';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const originalRaw = stdin.isRaw ?? false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      stdin.off('data', onData);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void errore.tryAsync<void, TerminalColorError>({
        try: () => {
          stdin.setRawMode?.(originalRaw);
          return Promise.resolve();
        },
        catch: (e) =>
          new TerminalColorError({ operation: 'cleanup', reason: 'setRawMode failed', cause: e }),
      });
    };

    const finish = (result: OscColorsResult | null) => {
      cleanup();
      resolve(result);
    };

    const paletteOverrides = new Map<number, number>();
    const requirePalette = options?.requirePalette ?? true;
    const requireFgBg = options?.requireFgBg ?? true;

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('latin1');

      // Parse OSC 10/11 responses - allow BEL (\x07) or ST (\x1b\\) terminators
      // Ghostty and other modern terminals may use either
      const fgRegex = new RegExp(`${OSC_PREFIX}10;${OSC_PAYLOAD}${OSC_TERM}`);
      const bgRegex = new RegExp(`${OSC_PREFIX}11;${OSC_PAYLOAD}${OSC_TERM}`);
      const fgMatch = fg === undefined ? buffer.match(fgRegex) : null;
      const bgMatch = bg === undefined ? buffer.match(bgRegex) : null;

      if (fgMatch) {
        fg = parseOscColor(fgMatch[1]) ?? undefined;
      }
      if (bgMatch) {
        bg = parseOscColor(bgMatch[1]) ?? undefined;
      }

      // Parse OSC 4 responses; allow BEL or ST terminators
      const paletteRegex = new RegExp(`${OSC_PREFIX}4;(\\d+);${OSC_PAYLOAD}${OSC_TERM}`, 'g');
      let match: RegExpExecArray | null;
      while ((match = paletteRegex.exec(buffer)) !== null) {
        const idx = parseInt(match[1], 10);
        const color = parseOscColor(match[2]);
        if (!Number.isNaN(idx) && idx >= 0 && idx < 256 && color !== null) {
          paletteOverrides.set(idx, color);
        }
      }

      const haveAllPalette = paletteOverrides.size >= 16; // we only ask 0-15
      const haveFgBg = fg !== undefined && bg !== undefined;
      const ready = (!requireFgBg || haveFgBg) && (!requirePalette || haveAllPalette);

      if (ready) {
        finish({
          foreground: fg,
          background: bg,
          paletteOverrides: paletteOverrides.size ? paletteOverrides : undefined,
        });
      }
    };

    timer = setTimeout(() => {
      if (!resolved) {
        finish(
          fg !== undefined || bg !== undefined || paletteOverrides.size
            ? {
                foreground: fg,
                background: bg,
                paletteOverrides: paletteOverrides.size ? paletteOverrides : undefined,
              }
            : null
        );
      }
    }, timeoutMs);

    void errore
      .tryAsync<void, TerminalColorError>({
        try: () => {
          stdin.setRawMode?.(true);
          return Promise.resolve();
        },
        catch: (e) => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          return new TerminalColorError({
            operation: 'setRawMode',
            reason: 'Failed to set raw mode',
            cause: e,
          });
        },
      })
      .then((result) => {
        if (result instanceof TerminalColorError) {
          resolve(result);
          return;
        }

        stdin.on('data', onData);

        void errore
          .tryAsync<boolean, TerminalColorError>({
            try: () => {
              // Query default foreground/background (OSC 10/11) and base 0-15 (OSC 4)
              let osc = '\x1b]10;?\x07\x1b]11;?\x07';
              for (let i = 0; i < 16; i++) {
                osc += `\x1b]4;${i};?\x07`;
              }
              const success = writeHostSequence(osc);
              if (!success) {
                process.stdout.write(osc);
              }
              return Promise.resolve(true);
            },
            catch: (e) => {
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              finish(null);
              return new TerminalColorError({
                operation: 'query',
                reason: 'Failed to write OSC query',
                cause: e,
              });
            },
          })
          .then((writeResult) => {
            if (writeResult instanceof TerminalColorError) {
              resolve(null);
            }
          });
      });
  });
}

/**
 * Generate the standard 256-color palette
 * Colors 0-15: ANSI colors (from base16 or defaults)
 * Colors 16-231: 6x6x6 color cube
 * Colors 232-255: Grayscale ramp
 */
function generate256Palette(base16?: number[]): number[] {
  const palette: number[] = [];

  // Colors 0-15: ANSI colors
  const defaultBase16 = [
    0x000000, // 0: black
    0xcd0000, // 1: red
    0x00cd00, // 2: green
    0xcdcd00, // 3: yellow
    0x0000ee, // 4: blue
    0xcd00cd, // 5: magenta
    0x00cdcd, // 6: cyan
    0xe5e5e5, // 7: white
    0x7f7f7f, // 8: bright black
    0xff0000, // 9: bright red
    0x00ff00, // 10: bright green
    0xffff00, // 11: bright yellow
    0x5c5cff, // 12: bright blue
    0xff00ff, // 13: bright magenta
    0x00ffff, // 14: bright cyan
    0xffffff, // 15: bright white
  ];

  for (let i = 0; i < 16; i++) {
    palette.push(base16?.[i] ?? defaultBase16[i]);
  }

  // Colors 16-231: 6x6x6 color cube
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = r ? 55 + r * 40 : 0;
        const gv = g ? 55 + g * 40 : 0;
        const bv = b ? 55 + b * 40 : 0;
        palette.push((rv << 16) | (gv << 8) | bv);
      }
    }
  }

  // Colors 232-255: Grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push((v << 16) | (v << 8) | v);
  }

  return palette;
}

/**
 * Get default colors (used as fallback)
 */
export function getDefaultColors(): TerminalColors {
  return {
    foreground: 0xffffff,
    // Use a real opaque background; transparency is handled by layout rather than color markers
    background: 0x000000,
    palette: generate256Palette(),
    isDefault: true,
  };
}

/**
 * Query host terminal for its color scheme
 *
 * Currently uses environment-based detection since OSC queries would
 * interfere with the TUI's stdin handling. In the future, we could
 * do OSC queries before the TUI starts.
 *
 * @param _timeoutMs Timeout in milliseconds (unused, for API compatibility)
 * @returns Terminal colors (currently always returns defaults or env-based)
 */
export async function queryHostColors(
  _timeoutMs: number = 500,
  options?: { force?: boolean; updateCache?: boolean; oscMode?: 'fast' | 'full' }
): Promise<TerminalColors> {
  // Return cached if available (unless forced)
  if (!options?.force && cachedColors) {
    return cachedColors;
  }

  let result: TerminalColors | null = null;
  const fallbackColors = getHostColors() ?? null;

  // First, try OSC queries (best-effort, only if TTY + raw mode available)
  const oscResult = await errore.tryAsync<OscColorsResult | null, TerminalColorError>({
    try: () =>
      queryOscColors(
        _timeoutMs,
        options?.oscMode === 'fast'
          ? { requirePalette: false, requireFgBg: true }
          : { requirePalette: true, requireFgBg: true }
      ).then((r) => (r instanceof TerminalColorError ? null : r)),
    catch: (e) => new TerminalColorError({ operation: 'query', reason: String(e), cause: e }),
  });

  if (
    !(oscResult instanceof TerminalColorError) &&
    oscResult &&
    (oscResult.foreground !== undefined ||
      oscResult.background !== undefined ||
      oscResult.paletteOverrides)
  ) {
    const base = fallbackColors ?? detectColorsFromEnvironment();
    const palette = base.palette.slice();
    if (oscResult.paletteOverrides) {
      for (const [idx, color] of oscResult.paletteOverrides.entries()) {
        if (idx >= 0 && idx < palette.length) {
          palette[idx] = color;
        }
      }
    }
    const hasFg = oscResult.foreground !== undefined;
    const hasBg = oscResult.background !== undefined;
    const hasComplete = hasFg && hasBg;
    result = {
      foreground: hasFg ? oscResult.foreground! : base.foreground,
      background: hasBg ? oscResult.background! : base.background,
      palette,
      // Only treat as non-default if we have both fg+bg or a non-default fallback.
      isDefault: base.isDefault && !hasComplete,
    };
  }

  if (!result) {
    result = detectColorsFromEnvironment();
  }

  if (options?.updateCache !== false) {
    if (result.isDefault && lastNonDefaultColors) {
      cachedColors = lastNonDefaultColors;
    } else {
      cachedColors = result;
      if (!result.isDefault) {
        lastNonDefaultColors = result;
      }
    }
  }
  return result;
}

/**
 * Detect terminal colors from environment variables
 * Uses COLORFGBG if available, otherwise returns defaults
 */
function detectColorsFromEnvironment(): TerminalColors {
  // Check COLORFGBG (format: "fg;bg" e.g., "15;0" for white on black)
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const fgIndex = parseInt(parts[0], 10);
      const bgIndex = parseInt(parts[parts.length - 1], 10);

      // Map ANSI color index to RGB
      const palette = generate256Palette();
      const fg = fgIndex >= 0 && fgIndex < 256 ? palette[fgIndex] : 0xffffff;
      const bg = bgIndex >= 0 && bgIndex < 256 ? palette[bgIndex] : 0x000000;

      return {
        foreground: fg,
        background: bg,
        palette,
        isDefault: false,
      };
    }
  }

  // Check for common dark/light theme indicators
  const colorScheme = process.env.TERM_BACKGROUND || process.env.COLORTHEME;
  if (colorScheme === 'light') {
    return {
      foreground: 0x000000,
      background: 0xffffff,
      palette: generate256Palette(),
      isDefault: false,
    };
  }

  // Default to dark theme
  return getDefaultColors();
}

/**
 * Get cached colors (must call queryHostColors first)
 */
export function getHostColors(): TerminalColors | null {
  if (cachedColors && !cachedColors.isDefault) {
    return cachedColors;
  }
  if (lastNonDefaultColors) {
    return lastNonDefaultColors;
  }
  return cachedColors;
}

/**
 * Set colors directly (for testing or manual override)
 */
export function setHostColors(colors: TerminalColors): void {
  cachedColors = colors;
  if (!colors.isDefault) {
    lastNonDefaultColors = colors;
  }
}

/**
 * Clear cached colors (mainly for testing)
 */
export function clearColorCache(): void {
  cachedColors = null;
}

/**
 * Refresh cached host colors by re-querying the terminal.
 */
export async function refreshHostColors(options?: {
  timeoutMs?: number;
  oscMode?: 'fast' | 'full';
}): Promise<TerminalColors> {
  const previous = getHostColors();
  const next = await queryHostColors(options?.timeoutMs ?? 500, {
    force: true,
    updateCache: false,
    oscMode: options?.oscMode,
  });
  if (next.isDefault) {
    if (previous && !previous.isDefault) {
      return previous;
    }
    if (lastNonDefaultColors) {
      return lastNonDefaultColors;
    }
  }
  cachedColors = next;
  if (!next.isDefault) {
    lastNonDefaultColors = next;
  }
  return next;
}

/**
 * Compare two terminal color sets for equality.
 */
export function areTerminalColorsEqual(
  a: TerminalColors | null | undefined,
  b: TerminalColors | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.foreground !== b.foreground ||
    a.background !== b.background ||
    a.isDefault !== b.isDefault
  ) {
    return false;
  }
  if (a.palette.length !== b.palette.length) return false;
  for (let i = 0; i < a.palette.length; i++) {
    if (a.palette[i] !== b.palette[i]) return false;
  }
  return true;
}

/**
 * Extract RGB components from 0xRRGGBB color
 */
export function extractRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}
