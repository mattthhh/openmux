/**
 * Keyboard event normalization helpers.
 */

import type { KeyboardEvent } from '../../core/keyboard-event';

export type OpenTuiKeyEvent = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  option?: boolean;
  meta?: boolean;
  sequence?: string;
  baseCode?: number;
  eventType?: 'press' | 'repeat' | 'release';
  repeated?: boolean;
  source?: 'raw' | 'kitty';
};

export function normalizeKeyEvent(event: OpenTuiKeyEvent): KeyboardEvent {
  const sequence = event.sequence ?? '';
  const metaIsAlt = !!event.meta && !event.option && sequence.startsWith('\x1b');
  const alt = event.option || metaIsAlt;
  const meta = metaIsAlt ? false : alt ? false : event.meta;

  return {
    key: event.name,
    ctrl: event.ctrl,
    shift: event.shift,
    alt,
    meta,
    sequence: event.sequence,
    baseCode: event.baseCode,
    eventType: event.eventType,
    repeated: event.repeated,
  };
}
