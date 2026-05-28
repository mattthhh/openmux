/**
 * Tests for OSC Title Parser
 * Verifies parsing of terminal title escape sequences (OSC 0/1/2)
 */
import { describe, test, expect, vi } from 'bun:test';
import { createTitleParser } from '../../src/terminal/title-parser';

describe('Title Parser', () => {
  describe('OSC 0 - Set icon name and window title', () => {
    test('should parse OSC 0 with BEL terminator', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;My Terminal Title\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('My Terminal Title');
    });

    test('should parse OSC 0 with ST terminator (ESC \\)', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;My Terminal Title\x1b\\');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('My Terminal Title');
    });

    test('should handle empty title', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('');
    });
  });

  describe('OSC 1 - Set icon name', () => {
    test('should parse OSC 1 with BEL terminator', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]1;Icon Name\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Icon Name');
    });

    test('should parse OSC 1 with ST terminator', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]1;Icon Name\x1b\\');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Icon Name');
    });
  });

  describe('OSC 2 - Set window title', () => {
    test('should parse OSC 2 with BEL terminator', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]2;Window Title\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Window Title');
    });

    test('should parse OSC 2 with ST terminator', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]2;Window Title\x1b\\');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Window Title');
    });
  });

  describe('Other OSC codes', () => {
    test('should ignore OSC 3 and higher', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // OSC 3 - Set X property (not a title)
      parser.processData('\x1b]3;property=value\x07');
      // OSC 4 - Set color
      parser.processData('\x1b]4;0;#000000\x07');
      // OSC 10 - Set foreground color
      parser.processData('\x1b]10;#ffffff\x07');

      expect(onTitleChange).not.toHaveBeenCalled();
    });
  });

  describe('Chunked data handling', () => {
    test('should handle title split across chunks', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Split the sequence across multiple processData calls
      parser.processData('\x1b]0;');
      parser.processData('Chunk');
      parser.processData('ed ');
      parser.processData('Title\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Chunked Title');
    });

    test('should handle code and semicolon in separate chunks', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0');
      parser.processData(';Title\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Title');
    });

    test('should handle BEL terminator in separate chunk', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;Title');
      parser.processData('\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Title');
    });
  });

  describe('Multiple sequences', () => {
    test('should handle multiple title changes in one chunk', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;First\x07\x1b]0;Second\x07\x1b]0;Third\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(3);
      expect(onTitleChange).toHaveBeenNthCalledWith(1, 'First');
      expect(onTitleChange).toHaveBeenNthCalledWith(2, 'Second');
      expect(onTitleChange).toHaveBeenNthCalledWith(3, 'Third');
    });

    test('should handle mixed OSC codes', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;OSC0\x07\x1b]1;OSC1\x07\x1b]2;OSC2\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(3);
      expect(onTitleChange).toHaveBeenNthCalledWith(1, 'OSC0');
      expect(onTitleChange).toHaveBeenNthCalledWith(2, 'OSC1');
      expect(onTitleChange).toHaveBeenNthCalledWith(3, 'OSC2');
    });
  });

  describe('Embedded in terminal output', () => {
    test('should extract title from mixed output', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Simulate shell output with embedded title sequence
      parser.processData('user@host:~$ \x1b]0;user@host: ~\x07ls -la\r\n');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('user@host: ~');
    });

    test('should handle ANSI escape sequences alongside OSC', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Mix of CSI (color) and OSC (title) sequences
      parser.processData('\x1b[32mgreen\x1b[0m \x1b]0;My Title\x07 more text');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('My Title');
    });
  });

  describe('Special characters in title', () => {
    test('should handle Unicode characters', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;日本語タイトル 🎉\x07');

      expect(onTitleChange).toHaveBeenCalledWith('日本語タイトル 🎉');
    });

    test('should handle path-like titles', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;~/projects/my-app\x07');

      expect(onTitleChange).toHaveBeenCalledWith('~/projects/my-app');
    });

    test('should handle titles with special shell characters', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      parser.processData('\x1b]0;vim ~/.bashrc | grep PATH\x07');

      expect(onTitleChange).toHaveBeenCalledWith('vim ~/.bashrc | grep PATH');
    });
  });

  describe('Invalid sequences', () => {
    test('should abort on non-numeric OSC code', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Invalid: letter in OSC code
      parser.processData('\x1b]abc;Title\x07');

      expect(onTitleChange).not.toHaveBeenCalled();
    });

    test('should recover after invalid sequence', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Invalid sequence followed by valid one
      parser.processData('\x1b]abc;Invalid\x07\x1b]0;Valid Title\x07');

      expect(onTitleChange).toHaveBeenCalledTimes(1);
      expect(onTitleChange).toHaveBeenCalledWith('Valid Title');
    });
  });

  describe('Real-world shell prompts', () => {
    test('should handle bash PS1 with title', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // Typical bash prompt that sets title
      const bashOutput =
        '\x1b]0;user@hostname: /home/user\x07\x1b[01;32muser@hostname\x1b[00m:\x1b[01;34m~\x1b[00m$ ';
      parser.processData(bashOutput);

      expect(onTitleChange).toHaveBeenCalledWith('user@hostname: /home/user');
    });

    test('should handle zsh title sequences', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // zsh often uses OSC 2 specifically
      parser.processData('\x1b]2;zsh: ~/projects\x07');

      expect(onTitleChange).toHaveBeenCalledWith('zsh: ~/projects');
    });

    test('should handle vim title change', () => {
      const onTitleChange = vi.fn();
      const parser = createTitleParser({ onTitleChange });

      // vim sets title when opening a file
      parser.processData('\x1b]0;config.ts - VIM\x07');

      expect(onTitleChange).toHaveBeenCalledWith('config.ts - VIM');
    });
  });
});
