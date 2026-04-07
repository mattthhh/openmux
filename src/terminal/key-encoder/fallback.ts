import type { KeyboardEvent } from '../../core/keyboard-event';
import type { KeyEncoderOptions } from './types';

/**
 * Conservative fallback encoder used until the native Ghostty key encoder is ready.
 *
 * The fallback only covers the common sequences we rely on during startup and
 * PTY switches. Once the native encoder is available we switch back to the
 * fully mode-aware Ghostty implementation.
 */
export const DEFAULT_FALLBACK_OPTIONS: KeyEncoderOptions = {
  cursorKeyApplication: false,
  keypadKeyApplication: false,
  ignoreKeypadWithNumlock: false,
  altEscPrefix: true,
  modifyOtherKeysState2: false,
  kittyFlags: 0,
};

function getPrintableSequence(sequence?: string): string {
  if (!sequence) return '';

  for (const char of sequence) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      return '';
    }
  }

  return sequence;
}

function encodeCtrlFallback(event: KeyboardEvent): string {
  if (!event.ctrl || event.key.length !== 1) {
    return '';
  }

  const char = event.key.toLowerCase();
  if (char >= 'a' && char <= 'z') {
    return String.fromCharCode(char.charCodeAt(0) - 96);
  }

  if (char === '@' || char === ' ') return '\x00';
  if (char === '[') return '\x1b';
  if (char === '\\') return '\x1c';
  if (char === ']') return '\x1d';
  if (char === '^') return '\x1e';
  if (char === '_') return '\x1f';

  return '';
}

function encodeSpecialFallback(event: KeyboardEvent, options: KeyEncoderOptions): string {
  const cursorPrefix = options.cursorKeyApplication ? '\x1bO' : '\x1b[';

  switch (event.key.toLowerCase()) {
    case 'up':
      return `${cursorPrefix}A`;
    case 'down':
      return `${cursorPrefix}B`;
    case 'right':
      return `${cursorPrefix}C`;
    case 'left':
      return `${cursorPrefix}D`;
    case 'home':
      return options.cursorKeyApplication ? '\x1bOH' : '\x1b[H';
    case 'end':
      return options.cursorKeyApplication ? '\x1bOF' : '\x1b[F';
    case 'insert':
      return '\x1b[2~';
    case 'delete':
      return '\x1b[3~';
    case 'pageup':
    case 'page_up':
      return '\x1b[5~';
    case 'pagedown':
    case 'page_down':
      return '\x1b[6~';
    case 'tab':
      return '\t';
    case 'backspace':
      return '\x7f';
    case 'escape':
    case 'esc':
      return '\x1b';
    default:
      return '';
  }
}

export function encodeKeyFallback(event: KeyboardEvent, options: KeyEncoderOptions): string {
  if (event.eventType === 'release') {
    return '';
  }

  const ctrl = encodeCtrlFallback(event);
  if (ctrl) {
    return event.alt ? `\x1b${ctrl}` : ctrl;
  }

  const printable = getPrintableSequence(event.sequence);
  if (printable) {
    return event.alt ? `\x1b${printable}` : printable;
  }

  const special = encodeSpecialFallback(event, options);
  if (special) {
    return event.alt ? `\x1b${special}` : special;
  }

  return '';
}
