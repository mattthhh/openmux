/**
 * Stream helpers for bridging async iterables into UI components.
 * Replaces Effect Stream with native TypeScript async iterables.
 */

export interface RunStreamOptions {
  label?: string;
  onError?: (cause: unknown) => void;
}

/**
 * Run an async iterable and return a cleanup function.
 * Handles errors via options.onError or logs to console.
 */
export function runStream<T>(
  iterable: AsyncIterable<T>,
  options: RunStreamOptions = {}
): () => void {
  let isRunning = true;
  let iterator: AsyncIterator<T> | null = null;

  const run = async () => {
    try {
      iterator = iterable[Symbol.asyncIterator]();
      while (isRunning) {
        const result = await iterator.next();
        if (result.done) break;
      }
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        const label = options.label ? ` (${options.label})` : '';
        console.warn(`[openmux] stream error${label}:`, error);
      }
    } finally {
      // Ensure iterator is cleaned up
      if (iterator && typeof iterator.return === 'function') {
        try {
          await iterator.return();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  };

  // Start the stream
  void run();

  // Return cleanup function
  return () => {
    isRunning = false;
    if (iterator && typeof iterator.return === 'function') {
      void iterator.return();
    }
  };
}

export interface SubscriptionCallbacks<T> {
  /** Emit a value to the stream */
  emit: (value: T) => void;
  /** Signal that the stream is complete */
  complete: () => void;
}

/**
 * Create an async iterable from a subscription function.
 * The subscription function receives emit and complete callbacks, returns cleanup.
 * If complete() is called, the stream ends naturally. If cleanup is called, it's aborted.
 */
export function streamFromSubscription<T>(
  subscribe: (callbacks: SubscriptionCallbacks<T>) => Promise<() => void> | (() => void)
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const buffer: T[] = [];
      let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
      let cleanup: (() => void) | null = null;
      let isDone = false;

      const emit = (value: T) => {
        if (isDone) return;
        if (resolveNext) {
          resolveNext({ value, done: false });
          resolveNext = null;
        } else {
          buffer.push(value);
        }
      };

      const complete = () => {
        if (isDone) return;
        isDone = true;
        if (resolveNext) {
          resolveNext({ value: undefined as T, done: true });
          resolveNext = null;
        }
      };

      // Initialize subscription
      const initPromise = Promise.resolve(subscribe({ emit, complete })).then((cleanupFn) => {
        cleanup = cleanupFn;
      });

      return {
        async next(): Promise<IteratorResult<T>> {
          await initPromise;

          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }

          if (isDone) {
            return { value: undefined as T, done: true };
          }

          return new Promise((resolve) => {
            resolveNext = (result) => {
              resolveNext = null;
              resolve(result);
            };
          });
        },

        async return(): Promise<IteratorResult<T>> {
          isDone = true;

          // Resolve any pending next() call with done
          if (resolveNext) {
            resolveNext({ value: undefined as T, done: true });
            resolveNext = null;
          }

          // Always call cleanup to release resources
          // This handles both early termination and natural completion
          if (cleanup) {
            cleanup();
            cleanup = null;
          }
          return { value: undefined as T, done: true };
        },
      };
    },
  };
}

/**
 * Apply a tap (side effect) to each value in an async iterable.
 */
export function tap<T>(
  iterable: AsyncIterable<T>,
  fn: (value: T) => void | Promise<void>
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const value of iterable) {
        await fn(value);
        yield value;
      }
    },
  };
}

/**
 * Filter values in an async iterable.
 */
export function filter<T>(
  iterable: AsyncIterable<T>,
  predicate: (value: T) => boolean
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const value of iterable) {
        if (predicate(value)) {
          yield value;
        }
      }
    },
  };
}

/**
 * Debounce an async iterable by a delay in milliseconds.
 * Only emits the last value after the delay has passed without new values.
 */
export function debounce<T>(iterable: AsyncIterable<T>, delayMs: number): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = iterable[Symbol.asyncIterator]();
      let lastValue: T | undefined = undefined;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      while (true) {
        // Set up debounce timer if we have a pending value
        let debouncePromise: Promise<void> | null = null;
        if (lastValue !== undefined) {
          debouncePromise = new Promise((resolve) => {
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              resolve();
            }, delayMs);
          });
        }

        // Race between next value and debounce firing
        const raceResult = await Promise.race([
          iterator.next().then((result) => ({ type: 'value' as const, result })),
          debouncePromise?.then(() => ({ type: 'debounce' as const })) ??
            new Promise<never>(() => {}), // never resolves if no debounce
        ]);

        if (raceResult.type === 'debounce') {
          // Debounce fired, yield the pending value
          if (lastValue !== undefined) {
            yield lastValue;
            lastValue = undefined;
          }
        } else {
          // Got a new value
          const result = raceResult.result;

          if (result.done) {
            // Iterator done, yield pending value if any
            if (lastValue !== undefined) {
              yield lastValue;
            }
            break;
          }

          // Cancel previous debounce if any
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }

          // Store new value (will trigger debounce on next iteration)
          lastValue = result.value;
        }
      }
    },
  };
}

/**
 * Create an async iterable that repeats an async function on a fixed interval.
 * Supports cleanup via iterator.return() to prevent infinite loops.
 */
export function repeatWithInterval<T>(
  fn: () => Promise<T> | T,
  intervalMs: number
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let isRunning = true;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        isRunning = false;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const iterator: AsyncIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          if (!isRunning) {
            return { value: undefined as T, done: true };
          }

          try {
            const value = await fn();
            if (!isRunning) {
              return { value: undefined as T, done: true };
            }

            // Set up timeout for next iteration
            await new Promise<void>((resolve) => {
              timeoutId = setTimeout(() => {
                timeoutId = null;
                resolve();
              }, intervalMs);
            });

            return { value, done: false };
          } catch {
            // Continue on error - set up timeout and return next value
            if (isRunning) {
              await new Promise<void>((resolve) => {
                timeoutId = setTimeout(() => {
                  timeoutId = null;
                  resolve();
                }, intervalMs);
              });
            }
            return iterator.next();
          }
        },

        async return(): Promise<IteratorResult<T>> {
          cleanup();
          return { value: undefined as T, done: true };
        },
      };

      return iterator;
    },
  };
}

export function take<T>(iterable: AsyncIterable<T>, count: number): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = iterable[Symbol.asyncIterator]();
      let taken = 0;

      return {
        async next(): Promise<IteratorResult<T>> {
          if (taken >= count) {
            // Close the underlying iterator when we're done
            if (iterator.return) {
              await iterator.return();
            }
            return { value: undefined as T, done: true };
          }

          const result = await iterator.next();
          if (result.done) {
            return { value: undefined as T, done: true };
          }

          taken++;
          return { value: result.value, done: false };
        },

        async return(): Promise<IteratorResult<T>> {
          if (iterator.return) {
            await iterator.return();
          }
          return { value: undefined as T, done: true };
        },
      };
    },
  };
}

/**
 * Map values in an async iterable.
 */
export function map<T, U>(
  iterable: AsyncIterable<T>,
  fn: (value: T) => U | Promise<U>
): AsyncIterable<U> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const value of iterable) {
        yield await fn(value);
      }
    },
  };
}

/**
 * Collect all values from an async iterable into an array.
 */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of iterable) {
    results.push(value);
  }
  return results;
}
