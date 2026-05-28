const ESC = '\x1b';
const BEL = '\x07';
const CSI_C1 = '\x9b';
const DCS_C1 = '\x90';
const OSC_C1 = '\x9d';
const ST_C1 = '\x9c';
const APC_C1 = '\x9f';

type ParseState =
  | 'text'
  | 'esc'
  | 'csi'
  | 'osc'
  | 'dcs'
  | 'apc'
  | 'osc-esc'
  | 'dcs-esc'
  | 'apc-esc';

export function findIncompleteSequenceStart(data: string): number | null {
  let state: ParseState = 'text';
  let seqStart = -1;

  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    switch (state) {
      case 'text':
        if (ch === ESC) {
          state = 'esc';
          seqStart = i;
        } else if (ch === CSI_C1) {
          state = 'csi';
          seqStart = i;
        } else if (ch === OSC_C1) {
          state = 'osc';
          seqStart = i;
        } else if (ch === DCS_C1) {
          state = 'dcs';
          seqStart = i;
        } else if (ch === APC_C1) {
          state = 'apc';
          seqStart = i;
        }
        break;
      case 'esc':
        if (ch === '[') {
          state = 'csi';
        } else if (ch === ']') {
          state = 'osc';
        } else if (ch === 'P') {
          state = 'dcs';
        } else if (ch === '_') {
          state = 'apc';
        } else if (ch === ESC) {
          state = 'esc';
          seqStart = i;
        } else {
          state = 'text';
          seqStart = -1;
        }
        break;
      case 'csi': {
        const code = ch.charCodeAt(0);
        if (code >= 0x40 && code <= 0x7e) {
          state = 'text';
          seqStart = -1;
        }
        break;
      }
      case 'osc':
        if (ch === BEL || ch === ST_C1) {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'osc-esc';
        }
        break;
      case 'osc-esc':
        if (ch === '\\') {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'osc-esc';
        } else {
          state = 'osc';
        }
        break;
      case 'dcs':
        if (ch === ST_C1) {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'dcs-esc';
        }
        break;
      case 'dcs-esc':
        if (ch === '\\') {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'dcs-esc';
        } else {
          state = 'dcs';
        }
        break;
      case 'apc':
        if (ch === ST_C1) {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'apc-esc';
        }
        break;
      case 'apc-esc':
        if (ch === '\\') {
          state = 'text';
          seqStart = -1;
        } else if (ch === ESC) {
          state = 'apc-esc';
        } else {
          state = 'apc';
        }
        break;
    }
  }

  if (state === 'text') {
    return null;
  }
  return seqStart >= 0 ? seqStart : null;
}

export function stripKittyResponses(data: string): string {
  let result = '';
  let i = 0;

  while (i < data.length) {
    const ch = data[i];
    const isEscApc =
      ch === ESC && i + 2 < data.length && data[i + 1] === '_' && data[i + 2] === 'G';
    const isC1Apc = ch === '\x9f' && i + 1 < data.length && data[i + 1] === 'G';

    if (!isEscApc && !isC1Apc) {
      result += ch;
      i += 1;
      continue;
    }

    const start = i;
    let pos = i + (isEscApc ? 3 : 2);
    let end = -1;
    let terminatorLength = 0;
    while (pos < data.length) {
      if (data[pos] === ST_C1) {
        end = pos + 1;
        terminatorLength = 1;
        break;
      }
      if (data[pos] === ESC && pos + 1 < data.length && data[pos + 1] === '\\') {
        end = pos + 2;
        terminatorLength = 2;
        break;
      }
      pos += 1;
    }

    if (end < 0) {
      result += data.slice(start);
      break;
    }

    const body = data.slice(isEscApc ? start + 3 : start + 2, end - terminatorLength);
    const sep = body.indexOf(';');
    if (sep === -1) {
      result += data.slice(start, end);
      i = end;
      continue;
    }

    const control = body.slice(0, sep);
    const payload = body.slice(sep + 1);
    const hasAction = control.includes('a=');
    const isOk = payload === 'OK';
    const hasNonBase64 = /[^A-Za-z0-9+/=]/.test(payload);

    if (!hasAction && (isOk || hasNonBase64)) {
      i = end;
      continue;
    }

    result += data.slice(start, end);
    i = end;
  }

  return result;
}
