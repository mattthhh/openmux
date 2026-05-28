/**
 * Tests for sync mode parser (DEC Mode 2026)
 */
import { describe, test, expect } from 'bun:test';
import { createSyncModeParser } from '../../src/terminal/sync-mode-parser';

const SYNC_SET = '\x1b[?2026h';
const SYNC_RESET = '\x1b[?2026l';

describe('SyncModeParser', () => {
  test('passes through data without sync sequences', () => {
    const parser = createSyncModeParser();
    const result = parser.process('hello world');

    expect(result.readySegments).toEqual(['hello world']);
    expect(result.isBuffering).toBe(false);
  });

  test('buffers content between sync start and end', () => {
    const parser = createSyncModeParser();

    // Sync start - should start buffering
    const result1 = parser.process(`${SYNC_SET}frame content`);
    expect(result1.readySegments).toEqual([]);
    expect(result1.isBuffering).toBe(true);

    // Sync end - should flush buffer
    const result2 = parser.process(`more content${SYNC_RESET}`);
    expect(result2.readySegments).toEqual(['frame contentmore content']);
    expect(result2.isBuffering).toBe(false);
  });

  test('emits content before sync start', () => {
    const parser = createSyncModeParser();
    const result = parser.process(`prefix${SYNC_SET}buffered`);

    expect(result.readySegments).toEqual(['prefix']);
    expect(result.isBuffering).toBe(true);
  });

  test('emits content after sync end', () => {
    const parser = createSyncModeParser();

    parser.process(`${SYNC_SET}frame`);
    const result = parser.process(`${SYNC_RESET}suffix`);

    expect(result.readySegments).toEqual(['frame', 'suffix']);
    expect(result.isBuffering).toBe(false);
  });

  test('handles multiple sync frames in one chunk', () => {
    const parser = createSyncModeParser();
    const data = `${SYNC_SET}frame1${SYNC_RESET}between${SYNC_SET}frame2${SYNC_RESET}`;
    const result = parser.process(data);

    expect(result.readySegments).toEqual(['frame1', 'between', 'frame2']);
    expect(result.isBuffering).toBe(false);
  });

  test('handles split sync sequences across chunks', () => {
    const parser = createSyncModeParser();

    // Partial sync start sequence
    const result1 = parser.process('hello\x1b[?2026');
    // The partial escape is held back
    expect(result1.readySegments).toEqual(['hello']);
    expect(result1.isBuffering).toBe(false);

    // Complete the sync start
    const result2 = parser.process('hframe content');
    // Now we should be buffering
    expect(result2.readySegments).toEqual([]);
    expect(result2.isBuffering).toBe(true);

    // Send sync end
    const result3 = parser.process(`${SYNC_RESET}`);
    expect(result3.readySegments).toEqual(['frame content']);
    expect(result3.isBuffering).toBe(false);
  });

  test('flush returns buffered content and resets state', () => {
    const parser = createSyncModeParser();

    parser.process(`${SYNC_SET}buffered content`);
    expect(parser.isInSyncMode()).toBe(true);

    const flushed = parser.flush();
    expect(flushed).toBe('buffered content');
    expect(parser.isInSyncMode()).toBe(false);
  });

  test('flush returns partial escape sequences', () => {
    const parser = createSyncModeParser();

    parser.process('data\x1b[?20');
    const flushed = parser.flush();

    expect(flushed).toBe('\x1b[?20');
  });

  test('handles empty data', () => {
    const parser = createSyncModeParser();
    const result = parser.process('');

    expect(result.readySegments).toEqual([]);
    expect(result.isBuffering).toBe(false);
  });

  test('handles just sync sequences without content', () => {
    const parser = createSyncModeParser();
    const result = parser.process(`${SYNC_SET}${SYNC_RESET}`);

    expect(result.readySegments).toEqual([]);
    expect(result.isBuffering).toBe(false);
  });

  test('handles nested-looking sequences (not actually nested)', () => {
    const parser = createSyncModeParser();

    // Sync mode doesn't actually nest - second start is just content
    const result = parser.process(`${SYNC_SET}start${SYNC_SET}more${SYNC_RESET}`);

    // The second SYNC_SET is treated as content
    expect(result.readySegments).toEqual([`start${SYNC_SET}more`]);
    expect(result.isBuffering).toBe(false);
  });
});
