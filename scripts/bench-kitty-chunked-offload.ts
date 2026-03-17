#!/usr/bin/env bun
import { performance } from 'node:perf_hooks';
import { KittyTransmitRelay } from '../src/terminal/kitty-graphics/transmit-relay';
import { KittyTransmitBroker } from '../src/terminal/kitty-graphics/transmit-broker';

const ESC = '\x1b';
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';

interface Args {
  decodedBytes: number;
  chunkChars: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    decodedBytes: 900 * 1024,
    chunkChars: 4096,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!next) continue;
    if (arg === '--decoded-bytes') {
      args.decodedBytes = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === '--chunk-chars') {
      args.chunkChars = Number.parseInt(next, 10);
      i += 1;
    }
  }

  return args;
}

function createPayloadBase64(decodedBytes: number): string {
  const seed = Buffer.from(PNG_1X1, 'base64');
  if (decodedBytes <= seed.length) {
    return seed.subarray(0, decodedBytes).toString('base64');
  }
  const padding = Buffer.alloc(decodedBytes - seed.length, 0);
  return Buffer.concat([seed, padding]).toString('base64');
}

function buildChunkSequence(chunk: string, index: number, total: number): string {
  if (index === 0) {
    const more = total > 1 ? ',m=1' : '';
    return `${ESC}_Ga=t,f=100,i=7${more};${chunk}${ESC}\\`;
  }
  if (index < total - 1) {
    return `${ESC}_Gm=1;${chunk}${ESC}\\`;
  }
  return `${ESC}_G;${chunk}${ESC}\\`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const relay = new KittyTransmitRelay({
    stubPng: true,
    stubAllFormats: true,
    stubSharedMemory: false,
  });
  const broker = new KittyTransmitBroker();
  (broker as KittyTransmitBroker & { enabled: boolean }).enabled = true;

  let hostWriteBytes = 0;
  let hostWriteCount = 0;
  let relayForwardCount = 0;
  let relayForwardBytes = 0;
  let emulatorBytes = 0;

  broker.setWriter((chunk) => {
    hostWriteBytes += Buffer.byteLength(chunk, 'utf8');
    hostWriteCount += 1;
  });

  const payload = createPayloadBase64(args.decodedBytes);
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += args.chunkChars) {
    chunks.push(payload.slice(i, i + args.chunkChars));
  }

  const startedAt = performance.now();
  for (let i = 0; i < chunks.length; i += 1) {
    const sequence = buildChunkSequence(chunks[i], i, chunks.length);
    const result = relay.handleSequence('bench-pty', sequence);
    emulatorBytes += Buffer.byteLength(result.emuSequence, 'utf8');
    if (result.forwardSequence) {
      relayForwardCount += 1;
      relayForwardBytes += Buffer.byteLength(result.forwardSequence, 'utf8');
      broker.handleSequence('bench-pty', result.forwardSequence);
    }
  }
  const totalMs = performance.now() - startedAt;

  console.log(`decoded_bytes=${args.decodedBytes}`);
  console.log(`payload_base64_chars=${payload.length}`);
  console.log(`chunk_chars=${args.chunkChars}`);
  console.log(`chunk_count=${chunks.length}`);
  console.log(`relay_forward_count=${relayForwardCount}`);
  console.log(`relay_forward_bytes=${relayForwardBytes}`);
  console.log(`broker_host_write_count=${hostWriteCount}`);
  console.log(`broker_host_write_bytes=${hostWriteBytes}`);
  console.log(`emulator_bytes=${emulatorBytes}`);
  console.log(`total_ms=${totalMs.toFixed(2)}`);
  console.log(`METRIC host_write_kb=${(hostWriteBytes / 1024).toFixed(2)}`);
  console.log(`METRIC total_ms=${totalMs.toFixed(2)}`);
}

main();
