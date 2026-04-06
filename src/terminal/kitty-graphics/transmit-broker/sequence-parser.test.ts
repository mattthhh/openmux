import { describe, expect, it } from 'bun:test';
import { SequenceParser } from './sequence-parser';
import type { PendingChunk } from './id-mapper';

const parser = new SequenceParser();

describe('SequenceParser', () => {
  it('resolves continuation-only final chunks from pending transmit state', () => {
    const parsed = parser.parse('\x1b_Gi=9;ZGF0YQ==\x1b\\');
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    const pendingChunk: PendingChunk = {
      guestKey: 'i:9',
      hostId: 12,
      params: {
        action: 't',
        format: '100',
        medium: 'd',
        more: true,
      },
      offload: null,
    };

    const transmit = parser.resolveTransmit({ parsed, pendingChunk });
    expect(transmit).toEqual({
      params: {
        action: 't',
        format: '100',
        medium: 'd',
        more: false,
      },
      guestId: '9',
      guestNumber: null,
      fallbackGuestKey: 'i:9',
    });
  });

  it('extracts guest keys from image delete commands', () => {
    const parsed = parser.parse('\x1b_Ga=d,d=i,i=17;\x1b\\');
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parser.resolveDelete(parsed)).toEqual({
      target: 'image',
      guestKey: 'i:17',
    });
  });

  it('injects synthetic guest ids back into emulator-facing sequences', () => {
    const parsed = parser.parse('\x1b_Ga=t,f=100;payload\x1b\\');
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(
      parser.injectGuestId({
        parsed,
        injectedGuestId: '2147483647',
      })
    ).toBe('\x1b_Ga=t,f=100,i=2147483647;payload\x1b\\');
  });
});
