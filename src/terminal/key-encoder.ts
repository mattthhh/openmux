/**
 * Ghostty key encoder adapter for PTY input.
 * Encodes key events using libghostty-vt to preserve modifier semantics.
 */

import type { ITerminalEmulator } from './emulator-interface';
import type { KeyboardEvent } from '../core/keyboard-event';
import { ValidationError } from '../effect/errors';
import * as errore from 'errore';

import { DEFAULT_FALLBACK_OPTIONS, encodeKeyFallback } from './key-encoder/fallback';
import { encodeNativeKey } from './key-encoder/native';
import type { KeyEncoderOptions } from './key-encoder/types';

function isLineBreakSequence(sequence?: string): sequence is '\n' | '\r' {
  return sequence === '\n' || sequence === '\r';
}

function isEscPrefixedLinefeed(event: KeyboardEvent): boolean {
  // Some terminal setups emit Shift+Enter as ESC+LF (meta+linefeed).
  // Treat that as a plain line break so apps can interpret it as newline
  // instead of Alt+Enter.
  return event.sequence === '\x1b\n' && event.key === 'linefeed' && !event.ctrl && !event.meta;
}

function getModeSafe(emulator: ITerminalEmulator, mode: number): boolean | ValidationError {
  const result = errore.try({
    try: () => emulator.getMode(mode),
    catch: (cause: unknown) =>
      new ValidationError({ reason: cause instanceof Error ? cause.message : String(cause) }),
  });
  return result instanceof Error ? result : result;
}

function getEncoderOptions(emulator: ITerminalEmulator): KeyEncoderOptions {
  const keypadResult = getModeSafe(emulator, 66);
  const ignoreNumlockResult = getModeSafe(emulator, 1035);

  return {
    cursorKeyApplication: emulator.getCursorKeyMode() === 'application',
    keypadKeyApplication: keypadResult instanceof ValidationError ? false : keypadResult,
    ignoreKeypadWithNumlock:
      ignoreNumlockResult instanceof ValidationError ? false : ignoreNumlockResult,
    altEscPrefix: true,
    modifyOtherKeysState2: false,
    kittyFlags: emulator.getKittyKeyboardFlags(),
  };
}

function getActionType(event: KeyboardEvent): 'release' | 'other' {
  return event.eventType === 'release' ? 'release' : 'other';
}

export function encodeKeyForEmulator(
  event: KeyboardEvent,
  emulator: ITerminalEmulator | null
): string {
  const activeEmulator = emulator && !emulator.isDisposed ? emulator : null;
  const options = activeEmulator ? getEncoderOptions(activeEmulator) : DEFAULT_FALLBACK_OPTIONS;
  const actionType = getActionType(event);

  if (actionType !== 'release' && isEscPrefixedLinefeed(event)) {
    return '\n';
  }

  if (
    actionType !== 'release' &&
    isLineBreakSequence(event.sequence) &&
    !event.ctrl &&
    !event.alt &&
    !event.meta
  ) {
    // Keep Enter semantics stable across terminals:
    // - Plain Enter should always submit a line break.
    // - Shift+Enter should also submit a line break unless the app explicitly
    //   enabled Kitty keyboard protocol (where Shift+Enter is distinct).
    if (!event.shift || options.kittyFlags === 0) {
      return event.sequence;
    }
  }

  // Use the native Ghostty encoder when available, but keep a conservative
  // fallback for startup, aggregate-session switching, and test environments.
  return encodeNativeKey(event, options) ?? encodeKeyFallback(event, options);
}
