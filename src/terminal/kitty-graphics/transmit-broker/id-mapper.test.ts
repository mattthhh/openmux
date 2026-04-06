import { describe, expect, it } from 'bun:test';
import { IdMapper } from './id-mapper';

describe('IdMapper', () => {
  it('reuses host ids for the same guest image key', () => {
    const mapper = new IdMapper();

    const first = mapper.resolveTransmitTarget({
      ptyId: 'pty-1',
      guestId: '41',
      guestNumber: null,
      fallbackGuestKey: null,
    });
    const second = mapper.resolveTransmitTarget({
      ptyId: 'pty-1',
      guestId: '41',
      guestNumber: null,
      fallbackGuestKey: null,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.hostId).toBe(1);
    expect(second?.hostId).toBe(1);
    expect(second?.injectedGuestId).toBeNull();
  });

  it('allocates synthetic guest ids when the guest omits both i and I', () => {
    const mapper = new IdMapper();

    const target = mapper.resolveTransmitTarget({
      ptyId: 'pty-2',
      guestId: null,
      guestNumber: null,
      fallbackGuestKey: null,
    });

    expect(target).not.toBeNull();
    expect(target?.guestKey).toBe('i:2147483647');
    expect(target?.injectedGuestId).toBe('2147483647');
    expect(target?.hostId).toBe(1);
  });
});
