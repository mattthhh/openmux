/**
 * Tests for KittyTransmitBroker.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it, vi } from 'bun:test';
import * as capabilitiesActual from '../../src/terminal/capabilities';

let KittyTransmitBroker: typeof import('../../src/terminal/kitty-graphics/transmit-broker').KittyTransmitBroker;

vi.mock('../../src/terminal/capabilities', () => ({
  ...capabilitiesActual,
  getHostCapabilities: () => ({
    terminalName: 'kitty',
    da1Response: null,
    da2Response: null,
    xtversionResponse: null,
    kittyGraphics: true,
    trueColor: true,
    colors: null,
  }),
}));

const ESC = '\x1b';

/** Helper to run code with modified env vars, restores after */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    prior[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('KittyTransmitBroker', () => {
  beforeAll(async () => {
    ({ KittyTransmitBroker } = await import('../../src/terminal/kitty-graphics/transmit-broker'));
  });

  describe('basic transmit', () => {
    it('forwards transmit payloads to the host writer', () => {
      const broker = new KittyTransmitBroker();
      const writes: string[] = [];
      broker.setWriter((chunk) => writes.push(chunk));

      const sequence = `${ESC}_Ga=t,f=100,i=7;QUJD${ESC}\\`;
      const output = broker.handleSequence('pty-1', sequence);

      expect(output).toBe(sequence);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('a=t');
      expect(writes[0]).toContain('f=100');
      expect(writes[0]).toContain('i=1');
      expect(writes[0]).toContain('QUJD');
    });

    it('rewrites implicit transmissions with a synthetic id', () => {
      const broker = new KittyTransmitBroker();
      const writes: string[] = [];
      broker.setWriter((chunk) => writes.push(chunk));

      const sequence = `${ESC}_Ga=T,f=24;QUJD${ESC}\\`;
      const output = broker.handleSequence('pty-2', sequence);

      expect(output).toContain('i=');
      expect(output).toContain('a=T');
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('a=t');
      expect(writes[0]).toContain('i=1');
    });
  });

  describe('chunked transmissions', () => {
    it('reuses host ids across chunked transmissions', () => {
      withEnv({ OPENMUX_KITTY_OFFLOAD_THRESHOLD: '0' }, () => {
        const broker = new KittyTransmitBroker();
        const writes: string[] = [];
        broker.setWriter((chunk) => writes.push(chunk));

        const first = `${ESC}_Ga=t,f=24,m=1;QUJ${ESC}\\`;
        const second = `${ESC}_G;DRA=${ESC}\\`;

        const outFirst = broker.handleSequence('pty-3', first);
        const outSecond = broker.handleSequence('pty-3', second);

        expect(outFirst).toContain('i=');
        expect(outSecond).not.toContain('i=');
        expect(writes).toHaveLength(2);
        expect(writes[0]).toContain('m=1');
        expect(writes[0]).toContain('i=1');
        expect(writes[1]).toContain('i=1');
      });
    });

    it('finalizes chunked relay continuations that include only image id', () => {
      withEnv({ OPENMUX_KITTY_OFFLOAD_THRESHOLD: '0' }, () => {
        const broker = new KittyTransmitBroker();
        const writes: string[] = [];
        broker.setWriter((chunk) => writes.push(chunk));

        const first = `${ESC}_Ga=t,f=24,i=7,m=1;QUJ${ESC}\\`;
        const second = `${ESC}_Gi=7;DRA=${ESC}\\`;

        const outFirst = broker.handleSequence('pty-3b', first);
        const outSecond = broker.handleSequence('pty-3b', second);

        expect(outFirst).toBe(first);
        expect(outSecond).toBe(second);
        expect(writes).toHaveLength(2);
        expect(writes[0]).toContain('m=1');
        expect(writes[0]).toContain('i=1');
        expect(writes[1]).not.toContain('m=1');
        expect(writes[1]).toContain('i=1');
      });
    });
  });

  describe('emulator stub mode', () => {
    it('strips png payloads for emulator sequences', () => {
      withEnv({ OPENMUX_KITTY_EMULATOR_STUB: '1' }, () => {
        const broker = new KittyTransmitBroker();
        broker.setWriter(() => {});

        const png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
        const sequence = `${ESC}_Ga=t,f=100;${png}${ESC}\\`;
        const output = broker.handleSequence('pty-4', sequence);

        expect(output).toContain('f=100');
        expect(output).toContain('s=1');
        expect(output).toContain('v=1');
        expect(output).not.toContain(png);
      });
    });

    it('stubs file-based png transmissions for emulator parsing', () => {
      withEnv({ OPENMUX_KITTY_EMULATOR_STUB: '1' }, () => {
        const broker = new KittyTransmitBroker();
        broker.setWriter(() => {});

        const png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
        const filePath = path.join(os.tmpdir(), `openmux-kitty-broker-${Date.now()}.png`);
        fs.writeFileSync(filePath, Buffer.from(png, 'base64'));
        const payload = Buffer.from(filePath).toString('base64');
        const sequence = `${ESC}_Ga=t,f=100,t=f,i=7;${payload}${ESC}\\`;
        const output = broker.handleSequence('pty-5', sequence);

        expect(output).toContain('f=100');
        expect(output).toContain('s=1');
        expect(output).toContain('v=1');
        expect(output).not.toContain(payload);

        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      });
    });

    it('drops compression flags when stubbing png payloads', () => {
      withEnv({ OPENMUX_KITTY_EMULATOR_STUB: '1' }, () => {
        const broker = new KittyTransmitBroker();
        broker.setWriter(() => {});

        const png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
        const sequence = `${ESC}_Ga=t,f=100,o=z;${png}${ESC}\\`;
        const output = broker.handleSequence('pty-6', sequence);

        expect(output).toContain('f=100');
        expect(output).not.toContain('o=');
        expect(output).not.toContain(png);
      });
    });

    it('stubs shared memory payloads when emulator stub is enabled', () => {
      withEnv({ OPENMUX_KITTY_EMULATOR_STUB: '1' }, () => {
        const broker = new KittyTransmitBroker();
        broker.setWriter(() => {});

        const sequence = `${ESC}_Ga=t,t=s,s=10,v=12,i=9;SHMKEY${ESC}\\`;
        const output = broker.handleSequence('pty-9', sequence);

        expect(output).toContain('f=100');
        expect(output).toContain('s=10');
        expect(output).toContain('v=12');
        expect(output).not.toContain('t=s');
        expect(output).not.toContain('SHMKEY');
      });
    });
  });

  describe('id handling', () => {
    it('treats i=0 as implicit and injects a synthetic id', () => {
      const broker = new KittyTransmitBroker();
      const writes: string[] = [];
      broker.setWriter((chunk) => writes.push(chunk));

      const sequence = `${ESC}_Ga=t,f=24,i=0;QUJD${ESC}\\`;
      const output = broker.handleSequence('pty-7', sequence);

      expect(output).toContain('i=');
      expect(output).not.toContain('i=0');
      expect(writes[0]).toContain('i=1');
    });

    it('forwards delete-image commands with mapped host ids', () => {
      const broker = new KittyTransmitBroker();
      const writes: string[] = [];
      broker.setWriter((chunk) => writes.push(chunk));

      const payload = Buffer.from('abcd').toString('base64');
      const sequence = `${ESC}_Ga=t,f=24,i=9;${payload}${ESC}\\`;
      broker.handleSequence('pty-9', sequence);

      const deleteSeq = `${ESC}_Ga=d,d=i,i=9${ESC}\\`;
      const output = broker.handleSequence('pty-9', deleteSeq);

      expect(output).toBe(deleteSeq);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toContain('a=d');
      expect(writes[1]).toContain('d=I');
      expect(writes[1]).toContain('i=1');
    });

    it('does not forward delete-all commands to the host', () => {
      const broker = new KittyTransmitBroker();
      const writes: string[] = [];
      broker.setWriter((chunk) => writes.push(chunk));

      const payload = Buffer.from('abcd').toString('base64');
      const sequence = `${ESC}_Ga=t,f=24,i=9;${payload}${ESC}\\`;
      broker.handleSequence('pty-10', sequence);

      const deleteSeq = `${ESC}_Ga=d,d=a${ESC}\\`;
      const output = broker.handleSequence('pty-10', deleteSeq);

      expect(output).toBe(deleteSeq);
      expect(writes).toHaveLength(1);
    });
  });

  describe('offloading', () => {
    it('offloads large direct payloads to file transfers', () => {
      withEnv(
        {
          OPENMUX_KITTY_OFFLOAD_THRESHOLD: '1',
          OPENMUX_KITTY_OFFLOAD_CLEANUP_MS: '60000',
        },
        () => {
          const broker = new KittyTransmitBroker();
          const writes: string[] = [];
          broker.setWriter((chunk) => writes.push(chunk));

          const payload = Buffer.from('abcd').toString('base64');
          const sequence = `${ESC}_Ga=t,f=24;${payload}${ESC}\\`;
          const output = broker.handleSequence('pty-8', sequence);

          expect(output).toContain(payload);
          expect(writes).toHaveLength(1);
          const host = writes[0];
          expect(host).toContain('t=f');
          expect(host).not.toContain(payload);
          const payloadStart = host.indexOf(';') + 1;
          const payloadEnd = host.indexOf(`${ESC}\\`);
          const hostPayload = host.slice(payloadStart, payloadEnd);
          const filePath = Buffer.from(hostPayload, 'base64').toString('utf8');
          expect(filePath.length).toBeGreaterThan(0);
          expect(filePath).toContain('tty-graphics-protocol');

          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore cleanup failures
          }
        }
      );
    });

    it('offloads chunked direct payloads when the total image exceeds the threshold', () => {
      withEnv(
        {
          OPENMUX_KITTY_OFFLOAD_THRESHOLD: '64',
          OPENMUX_KITTY_OFFLOAD_CLEANUP_MS: '60000',
        },
        () => {
          const broker = new KittyTransmitBroker();
          const writes: string[] = [];
          broker.setWriter((chunk) => writes.push(chunk));

          const payload = Buffer.from(
            'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
          ).toString('base64');
          const first = payload.slice(0, 24);
          const second = payload.slice(24, 48);
          const third = payload.slice(48);

          broker.handleSequence('pty-8b', `${ESC}_Ga=t,f=24,i=12,m=1;${first}${ESC}\\`);
          broker.handleSequence('pty-8b', `${ESC}_Gm=1;${second}${ESC}\\`);
          const output = broker.handleSequence('pty-8b', `${ESC}_G;${third}${ESC}\\`);

          expect(output).toContain(third);
          expect(writes).toHaveLength(1);
          const host = writes[0];
          expect(host).toContain('t=f');
          expect(host).not.toContain(payload);
          const payloadStart = host.indexOf(';') + 1;
          const payloadEnd = host.indexOf(`${ESC}\\`);
          const hostPayload = host.slice(payloadStart, payloadEnd);
          const filePath = Buffer.from(hostPayload, 'base64').toString('utf8');
          expect(filePath.length).toBeGreaterThan(0);
          expect(filePath).toContain('tty-graphics-protocol');

          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore cleanup failures
          }
        }
      );
    });
  });
});
