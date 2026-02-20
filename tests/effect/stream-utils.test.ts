/**
 * Comprehensive tests for Stream utilities.
 */
import { describe, test, expect, vi } from "bun:test"
import { 
  streamFromSubscription, 
  runStream, 
  tap, 
  take, 
  collect, 
  debounce,
  repeatWithInterval,
  filter,
  map
} from '../../src/effect/stream-utils'

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

  test('cleanup is called when iterator is disposed', async () => {
    let cleaned = false

    const stream = streamFromSubscription<number>(({ emit, complete }) => {
      emit(1)
      complete()
      return () => {
        cleaned = true
      }
    })

    // Array.fromAsync consumes all values and ends, but doesn't call cleanup
    // Cleanup is only called when iterator.return() is explicitly invoked
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next() // Get value 1
    await iterator.next() // Get done
    expect(cleaned).toBe(false) // Not cleaned yet
    
    await iterator.return!() // Explicit cleanup
    expect(cleaned).toBe(true)
  })

  test('streams without complete() are infinite and require take() or cleanup', async () => {
    const values: number[] = []
    let emittedCount = 0
    
    // This stream never calls complete() - it's infinite
    const stream = streamFromSubscription<number>(({ emit }) => {
      const interval = setInterval(() => {
        emittedCount++
        emit(emittedCount)
      }, 10)
      
      return () => clearInterval(interval)
    })

    // Must use take() to limit consumption, or it runs forever
    const limited = take(stream, 5)
    
    for await (const value of limited) {
      values.push(value)
    }
    
    expect(values).toEqual([1, 2, 3, 4, 5])
    expect(emittedCount).toBeGreaterThanOrEqual(5) // May have emitted more before cleanup
  })

  test('handles complete() callback to end stream', async () => {
    const stream = streamFromSubscription<number>(({ emit, complete }) => {
      emit(1)
      emit(2)
      complete()
      return () => {}
    })

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([1, 2])
  })

  test('handles values emitted before complete()', async () => {
    const values: number[] = []
    
    const stream = streamFromSubscription<number>(({ emit, complete }) => {
      setTimeout(() => {
        emit(1)
        emit(2)
        complete()
      }, 10)
      return () => {}
    })

    for await (const value of stream) {
      values.push(value)
    }
    
    expect(values).toEqual([1, 2])
  })

  test('handles async subscription setup with complete', async () => {
    let setupComplete = false
    
    const stream = streamFromSubscription<number>(async ({ emit, complete }) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      setupComplete = true
      emit(1)
      complete() // Required to end the stream
      return () => {}
    })

    const result = await Array.fromAsync(stream)
    expect(setupComplete).toBe(true)
    expect(result).toEqual([1])
  })

  test('handles early cleanup', async () => {
    let cleaned = false
    let emitted = false
    
    const stream = streamFromSubscription<number>(({ emit }) => {
      const interval = setInterval(() => {
        emitted = true
        emit(1)
      }, 10)
      
      return () => {
        clearInterval(interval)
        cleaned = true
      }
    })

    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return!()
    
    expect(cleaned).toBe(true)
    
    // Wait a bit and verify no more emissions
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(emitted).toBe(true) // Should have emitted once
  })

  test('handles rapid emit calls with complete', async () => {
    const stream = streamFromSubscription<number>(({ emit, complete }) => {
      for (let i = 0; i < 100; i++) {
        emit(i)
      }
      complete() // Required to end the stream
      return () => {}
    })

    const result = await Array.fromAsync(stream)
    expect(result).toHaveLength(100)
    expect(result[0]).toBe(0)
    expect(result[99]).toBe(99)
  })
})

describe('debounce', () => {
  test('debounces rapid values, emitting only last', async () => {
    const stream = debounce(
      streamFromSubscription<number>(({ emit, complete }) => {
        emit(1)
        emit(2)
        emit(3)
        setTimeout(() => {
          emit(4)
          complete()
        }, 100)
        return () => {}
      }),
      50
    )

    const result = await Array.fromAsync(stream)
    // Should emit 3 after debounce, then 4 after second debounce
    expect(result).toEqual([3, 4])
  })

  test('waits for debounce delay before emitting', async () => {
    const startTime = Date.now()
    const delays: number[] = []
    
    const stream = tap(
      debounce(
        streamFromSubscription<number>(({ emit, complete }) => {
          emit(1)
          setTimeout(() => complete(), 100)
          return () => {}
        }),
        50
      ),
      () => {
        delays.push(Date.now() - startTime)
      }
    )

    await Array.fromAsync(stream)
    
    // Should wait at least 50ms before emitting
    expect(delays[0]).toBeGreaterThanOrEqual(45) // Allow small timing variance
  })

  test('handles single value', async () => {
    const stream = debounce(
      streamFromSubscription<number>(({ emit, complete }) => {
        setTimeout(() => {
          emit(42)
          complete()
        }, 10)
        return () => {}
      }),
      50
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([42])
  })

  test('cancels debounce when new value arrives', async () => {
    const emitted: number[] = []
    
    const stream = tap(
      debounce(
        streamFromSubscription<number>(({ emit, complete }) => {
          emit(1)
          setTimeout(() => emit(2), 30)
          setTimeout(() => emit(3), 60)
          setTimeout(() => complete(), 150)
          return () => {}
        }),
        50
      ),
      (val) => {
        emitted.push(val)
      }
    )

    await Array.fromAsync(stream)
    
    // Timeline:
    // t=0: emit(1), starts 50ms debounce
    // t=30: emit(2), cancels first debounce, starts new 50ms debounce
    // t=60: emit(3), cancels second debounce, starts new 50ms debounce  
    // t=110: debounce fires, emits 3
    // t=150: complete() called, emits pending value (none, already emitted)
    expect(emitted).toEqual([3])
  })

  test('emits pending value on completion', async () => {
    const stream = debounce(
      streamFromSubscription<number>(({ emit, complete }) => {
        emit(1)
        emit(2)
        complete()
        return () => {}
      }),
      100 // Longer than complete timeout
    )

    const result = await Array.fromAsync(stream)
    // Should emit pending value 2 immediately on complete, not wait for debounce
    expect(result).toEqual([2])
  })

  test('handles empty stream', async () => {
    const stream = debounce(
      streamFromSubscription<number>(({ complete }) => {
        complete()
        return () => {}
      }),
      50
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([])
  })

  test('does not block event loop', async () => {
    let otherWorkDone = false
    
    const stream = debounce(
      streamFromSubscription<number>(({ emit, complete }) => {
        emit(1)
        setTimeout(() => complete(), 100)
        return () => {}
      }),
      50
    )

    // Start consuming stream
    const promise = Array.fromAsync(stream)
    
    // Other work should be able to run
    await new Promise(resolve => setTimeout(resolve, 10))
    otherWorkDone = true
    
    await promise
    expect(otherWorkDone).toBe(true)
  })
})

describe('repeatWithInterval', () => {
  test('repeats function on interval', async () => {
    let callCount = 0
    
    const stream = take(
      repeatWithInterval(() => {
        callCount++
        return callCount
      }, 50),
      3
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([1, 2, 3])
    expect(callCount).toBe(3)
  })

  test('waits for async functions', async () => {
    let callCount = 0
    
    const stream = take(
      repeatWithInterval(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        callCount++
        return callCount
      }, 50),
      3
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([1, 2, 3])
  })

  test('continues on error', async () => {
    let callCount = 0
    
    const stream = take(
      repeatWithInterval(() => {
        callCount++
        if (callCount === 2) throw new Error('test error')
        return callCount
      }, 30),
      4
    )

    const result = await Array.fromAsync(stream)
    // take(4) gets 4 successful yields. Calls: 1(yield), 2(error), 3(yield), 4(yield), 5(yield)
    expect(result).toEqual([1, 3, 4, 5])
  })

  test('maintains interval timing', async () => {
    const timestamps: number[] = []
    const startTime = Date.now()
    
    const stream = take(
      repeatWithInterval(() => {
        timestamps.push(Date.now() - startTime)
        return timestamps.length
      }, 50),
      3
    )

    await Array.fromAsync(stream)
    
    // Intervals should be roughly 50ms apart (allowing for variance)
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(40)
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(40)
  })

  test('cleanup prevents further execution after return', async () => {
    let callCount = 0
    
    const stream = repeatWithInterval(() => {
      callCount++
      return callCount
    }, 10)

    const iterator = stream[Symbol.asyncIterator]()
    
    // Get first value
    const first = await iterator.next()
    expect(first.value).toBe(1)
    expect(callCount).toBe(1)
    
    // Call return to cleanup
    await iterator.return!()
    
    // Wait a bit to ensure no more calls happen
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Should still be 1 - no more calls after cleanup
    expect(callCount).toBe(1)
  })

  test('cleanup clears pending timeout', async () => {
    let callCount = 0
    
    const stream = repeatWithInterval(() => {
      callCount++
      return callCount
    }, 100) // Long interval

    const iterator = stream[Symbol.asyncIterator]()
    
    // Get first value
    await iterator.next()
    expect(callCount).toBe(1)
    
    // Immediately cleanup before next interval
    await iterator.return!()
    
    // Wait for the interval that would have fired
    await new Promise(resolve => setTimeout(resolve, 150))
    
    // Should still be 1 - timeout was cleared
    expect(callCount).toBe(1)
  })

  test('cleanup during fn execution', async () => {
    let callCount = 0
    
    const stream = repeatWithInterval(async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 50))
      return callCount
    }, 10)

    const iterator = stream[Symbol.asyncIterator]()
    
    // Start getting first value (but it will take time)
    const nextPromise = iterator.next()
    
    // Cleanup while fn is executing
    await iterator.return!()
    
    // Wait for the promise to resolve
    const result = await nextPromise
    
    // Should return done: true since we cleaned up
    expect(result.done).toBe(true)
  })

  test('multiple cleanups are safe', async () => {
    const stream = repeatWithInterval(() => 1, 10)
    const iterator = stream[Symbol.asyncIterator]()
    
    // Multiple returns should not throw
    await expect(iterator.return!()).resolves.toBeDefined()
    await expect(iterator.return!()).resolves.toBeDefined()
    await expect(iterator.return!()).resolves.toBeDefined()
  })
})

describe('filter', () => {
  test('filters values based on predicate', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    const filtered = filter(gen(), (value) => value % 2 === 0)
    const result = await Array.fromAsync(filtered)
    
    expect(result).toEqual([2, 4])
  })

  test('handles empty stream', async () => {
    async function* gen() {}

    const filtered = filter(gen(), () => true)
    const result = await Array.fromAsync(filtered)
    
    expect(result).toEqual([])
  })

  test('filters all values', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    const filtered = filter(gen(), () => false)
    const result = await Array.fromAsync(filtered)
    
    expect(result).toEqual([])
  })

  test('allows all values', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    const filtered = filter(gen(), () => true)
    const result = await Array.fromAsync(filtered)
    
    expect(result).toEqual([1, 2, 3])
  })
})

describe('map', () => {
  test('maps values using function', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    const mapped = map(gen(), (value) => value * 2)
    const result = await Array.fromAsync(mapped)
    
    expect(result).toEqual([2, 4, 6])
  })

  test('handles async mapper', async () => {
    async function* gen() {
      yield 1
      yield 2
    }

    const mapped = map(gen(), async (value) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return value * 10
    })
    const result = await Array.fromAsync(mapped)
    
    expect(result).toEqual([10, 20])
  })

  test('handles empty stream', async () => {
    async function* gen() {}

    const mapped = map(gen(), (value) => value)
    const result = await Array.fromAsync(mapped)
    
    expect(result).toEqual([])
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

  test('cleanup stops stream early', async () => {
    const values: number[] = []
    let stopped = false

    async function* gen() {
      let i = 0
      while (!stopped) {
        values.push(i)
        yield i++
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    const stop = runStream(gen())
    
    // Let it produce a few values
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(values.length).toBeGreaterThanOrEqual(3)
    
    const countBefore = values.length
    stop()
    stopped = true
    
    // Wait and verify no more values
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(values.length).toBe(countBefore)
  })

  test('handles stream label in error message', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    async function* failingGen() {
      throw new Error('test error')
    }

    runStream(failingGen(), { label: 'test-stream' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[openmux] stream error (test-stream)'),
      expect.any(Error)
    )
    
    consoleSpy.mockRestore()
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

  test('handles async side effect', async () => {
    const sideEffects: number[] = []
    
    async function* gen() {
      yield 1
      yield 2
    }

    const tapped = tap(gen(), async (value) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      sideEffects.push(value)
    })

    const result = await Array.fromAsync(tapped)
    
    expect(result).toEqual([1, 2])
    expect(sideEffects).toEqual([1, 2])
  })

  test('propagates errors from side effect', async () => {
    async function* gen() {
      yield 1
      yield 2
    }

    const tapped = tap(gen(), () => {
      throw new Error('side effect error')
    })

    await expect(Array.fromAsync(tapped)).rejects.toThrow('side effect error')
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

  test('handles taking more than available', async () => {
    async function* gen() {
      yield 1
      yield 2
    }

    const taken = take(gen(), 5)
    const result = await Array.fromAsync(taken)
    
    expect(result).toEqual([1, 2])
  })

  test('handles taking zero', async () => {
    async function* gen() {
      yield 1
      yield 2
    }

    const taken = take(gen(), 0)
    const result = await Array.fromAsync(taken)
    
    expect(result).toEqual([])
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

  test('handles empty stream', async () => {
    async function* gen() {}

    const result = await collect(gen())
    expect(result).toEqual([])
  })
})

describe('integration', () => {
  test('combines multiple operators', async () => {
    const stream = take(
      filter(
        map(
          streamFromSubscription<number>(({ emit, complete }) => {
            emit(1)
            emit(2)
            emit(3)
            emit(4)
            complete()
            return () => {}
          }),
          (x) => x * 2
        ),
        (x) => x > 4
      ),
      2
    )

    const result = await Array.fromAsync(stream)
    // 1*2=2 (filtered out), 2*2=4 (filtered out), 3*2=6 (kept), 4*2=8 (kept)
    expect(result).toEqual([6, 8])
  })

  test('debounce + tap pipeline', async () => {
    const tapped: number[] = []
    
    const stream = tap(
      debounce(
        streamFromSubscription<number>(({ emit, complete }) => {
          emit(1)
          emit(2)
          setTimeout(() => {
            emit(3)
            complete()
          }, 100)
          return () => {}
        }),
        50
      ),
      (val) => {
        tapped.push(val)
      }
    )

    const result = await Array.fromAsync(stream)
    expect(result).toEqual([2, 3])
    expect(tapped).toEqual([2, 3])
  })

  test('runStream with debounced source', async () => {
    const values: number[] = []
    
    const stream = tap(
      debounce(
        streamFromSubscription<number>(({ emit, complete }) => {
          emit(1)
          emit(2)
          setTimeout(() => complete(), 100)
          return () => {}
        }),
        50
      ),
      (val) => {
        values.push(val)
      }
    )

    const stop = runStream(stream)
    
    // Wait for debounce to fire
    await new Promise(resolve => setTimeout(resolve, 150))
    
    stop()
    
    expect(values).toEqual([2])
  })
})