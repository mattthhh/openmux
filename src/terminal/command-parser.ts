/**
 * OSC Command Parser - Captures openmux shell hook commands.
 *
 * Parses OSC 777 sequences of the form:
 *   ESC ] 777 ; openmux ; cmd=<encoded> BEL
 *   ESC ] 777 ; openmux ; cmd=<encoded> ST
 *   ESC ] 777 ; openmux ; cwd=<encoded> BEL
 *   ESC ] 777 ; openmux ; cwd=<encoded> ST
 *
 * Where <encoded> is percent-encoded to avoid control characters.
 */

import * as errore from 'errore';
import { ValidationError } from '../effect/errors';

const ESC = '\x1b';
const BEL = '\x07';
const COMMAND_CODE = 777;
const COMMAND_PREFIX = 'openmux;cmd=';
const CWD_PREFIX = 'openmux;cwd=';
const NOTIFY_CODE = 9;
const NOTIFY_PREFIX = 'notify;';

export type DesktopNotificationSource = 'osc9' | 'osc777';

export interface DesktopNotification {
  title: string;
  body: string;
  source: DesktopNotificationSource;
}

export interface CommandParserOptions {
  onCommand: (command: string) => void;
  onCwd?: (cwd: string) => void;
  onNotification?: (notification: DesktopNotification) => void;
  shellName?: string;
}

async function decodeOscText(encoded: string): Promise<ValidationError | string> {
  if (!encoded) return '';
  const result = await errore.tryAsync<string, ValidationError>({
    try: () => Promise.resolve(decodeURIComponent(encoded)),
    catch: (e) =>
      new ValidationError({ reason: `Failed to decode OSC text: ${String(e)}`, cause: e }),
  });
  if (result instanceof ValidationError) {
    return encoded;
  }
  return result;
}

async function decodeCommand(encoded: string): Promise<string> {
  const result = await decodeOscText(encoded);
  if (result instanceof ValidationError) {
    return encoded;
  }
  return result;
}

function isConEmuOsc9Payload(payload: string): boolean {
  if (!payload) return false;
  const first = payload[0];

  // ConEmu wait input blocks all OSC 9;5 notifications.
  if (first === '5') return true;
  if (payload.length < 2 || payload[1] !== ';') return false;

  switch (first) {
    case '1':
    case '2':
    case '3':
    case '6':
      return true;
    case '4': {
      if (payload.length < 3) return false;
      const state = payload[2];
      if (state === '0' || state === '3') return true;
      if (state === '1' || state === '2' || state === '4') {
        if (payload.length === 3) return true;
        return payload[3] === ';';
      }
      return false;
    }
    default:
      return false;
  }
}

function splitNotificationPayload(payload: string): { title: string; body: string } | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  const separatorIndex = trimmed.indexOf(';');
  if (separatorIndex === -1) {
    return { title: '', body: trimmed };
  }

  const title = trimmed.slice(0, separatorIndex).trim();
  const body = trimmed.slice(separatorIndex + 1).trim();

  if (!body) {
    return { title: '', body: title };
  }

  return { title, body };
}

async function parseDesktopNotification(
  code: number,
  oscText: string
): Promise<DesktopNotification | null> {
  if (code === NOTIFY_CODE) {
    if (isConEmuOsc9Payload(oscText)) return null;
    const decoded = await decodeOscText(oscText);
    if (decoded instanceof ValidationError) return null;
    const payload = splitNotificationPayload(decoded);
    if (!payload) return null;
    return { ...payload, source: 'osc9' };
  }

  if (code === COMMAND_CODE) {
    if (!oscText.startsWith(NOTIFY_PREFIX)) return null;
    const decoded = await decodeOscText(oscText.slice(NOTIFY_PREFIX.length));
    if (decoded instanceof ValidationError) return null;
    const payload = splitNotificationPayload(decoded);
    if (!payload) return null;
    return { ...payload, source: 'osc777' };
  }

  return null;
}

function stripZshPromptEolMark(command: string): string {
  const trimmed = command.trimEnd();
  if (!trimmed.endsWith('%')) return trimmed;

  const before = trimmed.slice(0, -1);
  if (before.endsWith('%')) {
    return trimmed;
  }

  const lastToken = trimmed.split(/\s+/).pop() ?? '';
  if (/^\d+%$/.test(lastToken)) {
    return trimmed;
  }

  return before.trimEnd();
}

function sanitizeCommand(command: string, shellName?: string): string {
  let result = command.trim();
  if (!result) return '';
  if ((shellName ?? '').toLowerCase() === 'zsh') {
    result = stripZshPromptEolMark(result).trim();
  }
  return result;
}

async function parseReportedCwd(code: number, oscText: string): Promise<string | null> {
  if (code !== COMMAND_CODE || !oscText.startsWith(CWD_PREFIX)) {
    return null;
  }

  const encoded = oscText.slice(CWD_PREFIX.length);
  const decoded = await decodeOscText(encoded);
  if (decoded instanceof ValidationError) {
    return encoded || null;
  }

  return decoded || null;
}

/**
 * Creates a command parser that can be called with data chunks.
 */
export function createCommandParser(options: CommandParserOptions) {
  const { onCommand, onCwd, shellName, onNotification } = options;

  // State for OSC sequence parsing
  let inOscSequence = false;
  let collectingText = false;
  let oscCodeBuffer: string[] = [];
  let oscTextBuffer: string[] = [];

  async function processData(data: string): Promise<void> {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (inOscSequence) {
        if (char === BEL) {
          await handleOscComplete();
          continue;
        }

        if (char === ESC && i + 1 < data.length && data[i + 1] === '\\') {
          i += 1;
          await handleOscComplete();
          continue;
        }

        if (!collectingText) {
          if (char === ';') {
            collectingText = true;
          } else if (char >= '0' && char <= '9') {
            oscCodeBuffer.push(char);
          } else {
            resetOsc();
          }
        } else {
          oscTextBuffer.push(char);
        }
        continue;
      }

      if (char === ESC && i + 1 < data.length && data[i + 1] === ']') {
        inOscSequence = true;
        collectingText = false;
        oscCodeBuffer = [];
        oscTextBuffer = [];
        i += 1;
      }
    }
  }

  async function handleOscComplete(): Promise<void> {
    const oscCode = oscCodeBuffer.join('');
    const oscText = oscTextBuffer.join('');
    const code = Number.parseInt(oscCode, 10);

    let handledOpenmuxEvent = false;

    if (code === COMMAND_CODE && oscText.startsWith(COMMAND_PREFIX)) {
      const encoded = oscText.slice(COMMAND_PREFIX.length);
      const decoded = await decodeCommand(encoded);
      const sanitized = sanitizeCommand(decoded, shellName);
      if (sanitized) {
        onCommand(sanitized);
      }
      handledOpenmuxEvent = true;
    }

    if (!handledOpenmuxEvent && onCwd) {
      const cwd = await parseReportedCwd(code, oscText);
      if (cwd) {
        onCwd(cwd);
        handledOpenmuxEvent = true;
      }
    }

    if (!handledOpenmuxEvent && onNotification) {
      const notification = await parseDesktopNotification(code, oscText);
      if (notification) {
        onNotification(notification);
      }
    }

    resetOsc();
  }

  function resetOsc(): void {
    inOscSequence = false;
    collectingText = false;
    oscCodeBuffer = [];
    oscTextBuffer = [];
  }

  return {
    processData,
  };
}
