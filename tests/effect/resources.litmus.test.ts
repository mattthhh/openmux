import { describe, it, expect, vi } from "vitest"
import { ResourceStack } from "../../src/effect/resources.js"

describe("ResourceStack litmus tests", () => {
  it("should run cleanup after function exits", async () => {
    let cleaned = false
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => {
        cleaned = true
      })
      expect(cleaned).toBe(false)
    }
    await test()
    expect(cleaned).toBe(true)
  })

  it("should clean up resources in LIFO order", async () => {
    const order: number[] = []
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => { order.push(1) })
      resources.defer(() => { order.push(2) })
      resources.defer(() => { order.push(3) })
    }
    await test()
    expect(order).toEqual([3, 2, 1])
  })

  it("should continue cleanup even when one fails", async () => {
    const order: number[] = []
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => { order.push(1) })
      resources.defer(() => {
        throw new Error("Cleanup failed")
      })
      resources.defer(() => { order.push(3) })
    }
    // AsyncDisposableStack aggregates errors but still throws
    await expect(test()).rejects.toThrow()
    expect(order).toContain(1)
    expect(order).toContain(3)
  })

  it("should work with await using", async () => {
    let disposed = false
    const stack = new ResourceStack()
    stack.defer(() => {
      disposed = true
    })
    await using _resources = stack
    expect(disposed).toBe(false)
    // _resources goes out of scope here
    await _resources[Symbol.asyncDispose]()
    expect(disposed).toBe(true)
  })

  it("should clear timers automatically", async () => {
    let timerRan = false
    async function test() {
      await using resources = new ResourceStack()
      const timer = setTimeout(() => { timerRan = true }, 10)
      resources.registerTimer(timer)
      expect(timerRan).toBe(false)
    }
    await test()
    // Wait a bit to ensure timer would have fired if not cleared
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(timerRan).toBe(false)
  })

  it("should call unsubscribe functions", async () => {
    let unsubscribed = false
    const unsubscribe = () => {
      unsubscribed = true
    }
    async function test() {
      await using resources = new ResourceStack()
      resources.registerSubscription(unsubscribe)
      expect(unsubscribed).toBe(false)
    }
    await test()
    expect(unsubscribed).toBe(true)
  })

  it("should clean up all registered resources", async () => {
    const cleaned: string[] = []
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => { cleaned.push("resource1") })
      resources.defer(() => { cleaned.push("resource2") })
      resources.defer(() => { cleaned.push("resource3") })
      resources.registerSubscription(() => { cleaned.push("subscription") })
      const timer = setTimeout(() => { cleaned.push("timer") }, 1000)
      resources.registerTimer(timer)
    }
    await test()
    expect(cleaned).toContain("resource1")
    expect(cleaned).toContain("resource2")
    expect(cleaned).toContain("resource3")
    expect(cleaned).toContain("subscription")
  })

  it("should clean up on early return", async () => {
    let cleaned = false
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => {
        cleaned = true
      })
      if (true) return "early"
      resources.defer(() => { cleaned = true })
      return "late"
    }
    const result = await test()
    expect(result).toBe("early")
    expect(cleaned).toBe(true)
  })

  it("should clean up when exception is thrown", async () => {
    let cleaned = false
    async function test() {
      await using resources = new ResourceStack()
      resources.defer(() => {
        cleaned = true
      })
      throw new Error("Test error")
    }
    await expect(test()).rejects.toThrow("Test error")
    expect(cleaned).toBe(true)
  })

  it("should not error on empty stack disposal", async () => {
    const resources = new ResourceStack()
    let error: unknown
    try {
      await resources[Symbol.asyncDispose]()
    } catch (e) {
      error = e
    }
    expect(error).toBeUndefined()
  })

  it("should use deferSafe to log but not stop on errors", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const cleaned: number[] = []
    async function test() {
      await using resources = new ResourceStack()
      resources.deferSafe(() => { cleaned.push(1) })
      resources.deferSafe(() => {
        throw new Error("Safe cleanup error")
      })
      resources.deferSafe(() => { cleaned.push(3) })
    }
    await test()
    // Cleanups run in LIFO order, so 3 runs before 1
    expect(cleaned).toEqual([3, 1])
    expect(consoleSpy).toHaveBeenCalledWith(
      "Resource cleanup failed:",
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })

  it("should deferAll to register multiple cleanups", async () => {
    const order: number[] = []
    async function test() {
      await using resources = new ResourceStack()
      resources.deferAll(
        () => { order.push(1) },
        () => { order.push(2) },
        () => { order.push(3) }
      )
    }
    await test()
    expect(order).toEqual([3, 2, 1])
  })

  it("should register and clear intervals", async () => {
    let intervalRan = 0
    async function test() {
      await using resources = new ResourceStack()
      const interval = setInterval(() => { intervalRan++ }, 5)
      resources.registerInterval(interval)
      // Let it run once
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    await test()
    const countAfterDispose = intervalRan
    // Wait to ensure interval doesn't continue
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(intervalRan).toBe(countAfterDispose)
  })

  it("should abort AbortController on cleanup", async () => {
    const controller = new AbortController()
    async function test() {
      await using resources = new ResourceStack()
      resources.registerAbortController(controller)
      expect(controller.signal.aborted).toBe(false)
    }
    await test()
    expect(controller.signal.aborted).toBe(true)
  })

  it("should register and remove event listeners", async () => {
    const emitter = {
      on: vi.fn(),
      off: vi.fn(),
    }
    const handler = () => {}
    async function test() {
      await using resources = new ResourceStack()
      resources.registerEventListener(emitter, "test", handler)
      expect(emitter.on).toHaveBeenCalledWith("test", handler)
      expect(emitter.off).not.toHaveBeenCalled()
    }
    await test()
    expect(emitter.off).toHaveBeenCalledWith("test", handler)
  })

  it("should register async disposable resources", async () => {
    let disposed = false
    const resource: AsyncDisposable = {
      async [Symbol.asyncDispose]() {
        disposed = true
      },
    }
    async function test() {
      await using resources = new ResourceStack()
      const returned = resources.registerDisposable(resource)
      expect(returned).toBe(resource)
      expect(disposed).toBe(false)
    }
    await test()
    expect(disposed).toBe(true)
  })
})
