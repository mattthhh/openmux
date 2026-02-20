/**
 * Tests for Stream utilities.
 */
import { describe, test, expect, vi } from "bun:test"
import { streamFromSubscription, runStream, tap, take, collect } from '../../src/effect/stream-utils'

describe('streamFromSubscription', () => {
  test('emits values and cleans up on completion', async () => {
    let cleaned = false

    const stream = take(
      streamFromSubscription<number>(({ emit }) => {
        emit(1)
        emit(2)
        return () => {
          cleaned = true
        }
      }),
      2
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([1, 2])
    expect(cleaned).toBe(true)
  })
})

describe('runStream', () => {
  test('runs stream and allows cleanup', async () => {
    const values: number[] = []

    // Create an async iterable that yields a fixed number of values
    async function* gen() {
      for (let i = 0; i < 5; i++) {
        values.push(i)
        yield i
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }

    const stop = runStream(gen())
    
    // Wait for all values to be produced
    await new Promise(resolve => setTimeout(resolve, 50))
    
    stop()
    
    expect(values.length).toBe(5)
  })

  test('invokes onError when stream fails', async () => {
    const onError = vi.fn()

    async function* failingGen() {
      throw new Error('boom')
      yield 1
    }

    runStream(failingGen(), { onError })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(onError).toHaveBeenCalled()
  })
})

describe('tap', () => {
  test('calls side effect for each value', async () => {
    const sideEffects: number[] = []
    
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    const tapped = tap(gen(), (value) => {
      sideEffects.push(value)
    })

    const result = await Array.fromAsync(tapped)
    
    expect(result).toEqual([1, 2, 3])
    expect(sideEffects).toEqual([1, 2, 3])
  })
})

describe('take', () => {
  test('takes only N values', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    const taken = take(gen(), 3)
    const result = await Array.fromAsync(taken)
    
    expect(result).toEqual([1, 2, 3])
  })

  test('closes underlying iterator when done', async () => {
    let closed = false
    
    async function* gen() {
      try {
        yield 1
        yield 2
        yield 3
      } finally {
        closed = true
      }
    }

    const taken = take(gen(), 2)
    await Array.fromAsync(taken)
    
    expect(closed).toBe(true)
  })
})

describe('collect', () => {
  test('collects all values into array', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    const result = await collect(gen())
    expect(result).toEqual([1, 2, 3])
  })
})
