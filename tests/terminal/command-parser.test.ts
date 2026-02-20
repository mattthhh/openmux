/*
 * Tests for OSC command parsing and notifications.
 */
import { describe, test, expect, vi } from "bun:test"
import { createCommandParser } from '../../src/terminal/command-parser'

describe('Command Parser', () => {
  test('parses OSC 9 notifications with title and body', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]9;System Alert;Process completed.\x07')

    expect(onCommand).not.toHaveBeenCalled()
    expect(onNotification).toHaveBeenCalledTimes(1)
    expect(onNotification).toHaveBeenCalledWith({
      title: 'System Alert',
      body: 'Process completed.',
      source: 'osc9',
    })
  })

  test('parses OSC 9 notifications with body only', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]9;Process completed.\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: '',
      body: 'Process completed.',
      source: 'osc9',
    })
  })

  test('ignores OSC 9 ConEmu commands', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    const sequences = [
      '\x1b]9;1;100\x07',
      '\x1b]9;2;Hello\x07',
      '\x1b]9;3;New Title\x07',
      '\x1b]9;4;1;33\x07',
      '\x1b]9;4;0\x07',
      '\x1b]9;5\x07',
      '\x1b]9;6;macro\x07',
    ]

    for (const seq of sequences) {
      await parser.processData(seq)
    }

    expect(onNotification).not.toHaveBeenCalled()
  })

  test('parses OSC 9 notifications that are not valid ConEmu commands', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]9;1a;Notice\x07')
    await parser.processData('\x1b]9;4;1x\x07')

    expect(onNotification).toHaveBeenCalledTimes(2)
    expect(onNotification).toHaveBeenNthCalledWith(1, {
      title: '1a',
      body: 'Notice',
      source: 'osc9',
    })
    expect(onNotification).toHaveBeenNthCalledWith(2, {
      title: '4',
      body: '1x',
      source: 'osc9',
    })
  })

  test('parses OSC 777 notify payloads', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]777;notify;Task;Done\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: 'Task',
      body: 'Done',
      source: 'osc777',
    })
  })

  test('does not emit notification for openmux command', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]777;openmux;cmd=ls\x07')

    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onNotification).not.toHaveBeenCalled()
  })

  test('handles chunked OSC 9 sequences', async () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    await parser.processData('\x1b]9;Chunk')
    await parser.processData('ed;Notice\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: 'Chunked',
      body: 'Notice',
      source: 'osc9',
    })
  })
})