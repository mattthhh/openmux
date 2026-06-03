/**
 * Terminal class for zig-pty
 */

import fs from 'node:fs';
import { ptr } from 'bun:ffi';
import * as errore from 'errore';
import { lib } from './lib-loader';
import { EventEmitter } from './event-emitter';
import type { IPty, IPtyForkOptions, IExitEvent } from './types';
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_FILE } from './types';

const READ_BUFFER_SIZE = 65536;
const DRAIN_YIELD_INTERVAL = 8;

type WakeupReadResult = { done: true; value?: Uint8Array } | { done: false; value: Uint8Array };

interface WakeupReader {
  read: () => Promise<WakeupReadResult>;
  cancel: (reason?: unknown) => Promise<void>;
}

function shQuote(s: string): string {
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class Terminal implements IPty {
  private handle: number = -1;
  private _pid: number = -1;
  private _cols: number = DEFAULT_COLS;
  private _rows: number = DEFAULT_ROWS;
  private _readLoop: boolean = false;
  private _closing: boolean = false;
  private _exitFired: boolean = false;
  private _onData = new EventEmitter<string>();
  private _onExit = new EventEmitter<IExitEvent>();
  private _decoder = new TextDecoder('utf-8', { fatal: false });
  private _readBuffer: Buffer = Buffer.alloc(READ_BUFFER_SIZE);
  private _wakeupFd: number = -1;
  private _wakeupReader: WakeupReader | null = null;
  private _draining: boolean = false;
  private _drainRequested: boolean = false;
  private _pollingFallback: boolean = false;
  // Read throttle: sleep this many ms between drain yield cycles for background PTYs.
  // 0 = no throttle (focused), positive = background priority, -1 = paused (hidden).
  private _readThrottleMs: number = 0;
  // Wake resolver: when set, resolving this promise interrupts the current
  // Bun.sleep in the read loop, so setReadThrottleMs takes effect immediately.
  private _throttleWakeResolve: (() => void) | null = null;
  // Foreground process change tracking
  private _onForegroundProcessChange = new EventEmitter<string>();
  private _lastForegroundChangeCount = 0;
  private _lastForegroundProcessName: string | null = null;

  /**
   * Create a Terminal from an already-spawned handle (used by spawnAsync)
   */
  static fromHandle(handle: number, cols: number, rows: number): Terminal {
    const term = Object.create(Terminal.prototype) as Terminal;
    term.handle = handle;
    term._pid = lib.symbols.bun_pty_get_pid(handle);
    term._cols = cols;
    term._rows = rows;
    term._initializePumpState();
    term._startReadLoop();
    return term;
  }

  constructor(file: string = DEFAULT_FILE, args: string[] = [], opts: IPtyForkOptions = {}) {
    this._cols = opts.cols ?? DEFAULT_COLS;
    this._rows = opts.rows ?? DEFAULT_ROWS;
    const cwd = opts.cwd ?? process.cwd();
    this._initializePumpState();

    const cmdline = [file, ...args.map(shQuote)].join(' ');

    let envStr = '';
    if (opts.env) {
      const envPairs = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);
      envStr = envPairs.join('\0') + '\0';
    }

    this.handle = lib.symbols.bun_pty_spawn(
      Buffer.from(`${cmdline}\0`, 'utf8'),
      Buffer.from(`${cwd}\0`, 'utf8'),
      Buffer.from(`${envStr}\0`, 'utf8'),
      this._cols,
      this._rows
    );

    if (this.handle < 0) {
      throw new Error('PTY spawn failed');
    }

    this._pid = lib.symbols.bun_pty_get_pid(this.handle);
    this._startReadLoop();
  }

  get pid(): number {
    return this._pid;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get process(): string {
    return 'shell';
  }

  /**
   * Set read throttle: sleep this many ms between drain yield cycles.
   * 0 = no throttle (focused), positive = background priority, -1 = paused.
   * This reduces CPU usage and event loop pressure for background PTYs
   * with heavy output (e.g. find / -ls in a split pane).
   *
   * Wakes the read loop immediately so the new throttle takes effect
   * without waiting for the current sleep to expire.
   */
  setReadThrottleMs(ms: number): void {
    this._readThrottleMs = ms;
    // Wake the read loop so it picks up the new throttle value immediately.
    if (this._throttleWakeResolve) {
      this._throttleWakeResolve();
    }
  }

  get onData() {
    return this._onData.event;
  }

  get onExit() {
    return this._onExit.event;
  }

  /**
   * Event fired when the foreground process changes.
   * Provides the new foreground process name.
   */
  get onForegroundProcessChange() {
    return this._onForegroundProcessChange.event;
  }

  write(data: string): void {
    if (this._closing || this.handle < 0) return;
    const buf = Buffer.from(data, 'utf8');
    lib.symbols.bun_pty_write(this.handle, ptr(buf), buf.length);
  }

  resize(cols: number, rows: number): void {
    if (this._closing || this.handle < 0) return;
    this._cols = cols;
    this._rows = rows;
    lib.symbols.bun_pty_resize(this.handle, cols, rows);
  }

  resizeWithPixels(cols: number, rows: number, pixelWidth: number, pixelHeight: number): void {
    if (this._closing || this.handle < 0) return;
    this._cols = cols;
    this._rows = rows;
    lib.symbols.bun_pty_resize_with_pixels(this.handle, cols, rows, pixelWidth, pixelHeight);
  }

  kill(signal: string = 'SIGTERM'): void {
    if (this._closing) return;
    this._closing = true;
    this._readLoop = false;
    this._pollingFallback = false;
    this._draining = false;
    this._drainRequested = false;
    if (this._throttleWakeResolve) {
      this._throttleWakeResolve();
      this._throttleWakeResolve = null;
    }

    if (this.handle >= 0) {
      lib.symbols.bun_pty_kill(this.handle);
      lib.symbols.bun_pty_close(this.handle);
      this.handle = -1;
    }

    this._closeWakeupTransport();

    if (!this._exitFired) {
      this._exitFired = true;
      this._onExit.fire({ exitCode: 0, signal });
    }
  }

  /**
   * Get the foreground process group ID.
   * Uses tcgetpgrp() on the PTY master fd.
   * @returns The foreground process group PID, or -1 on error.
   */
  getForegroundPid(): number {
    if (this._closing || this.handle < 0) return -1;
    return lib.symbols.bun_pty_get_foreground_pid(this.handle);
  }

  /**
   * Get the current working directory of a process.
   * Uses native APIs: proc_pidinfo on macOS, /proc on Linux.
   * @param pid The process ID (defaults to shell PID)
   * @returns The CWD path, or null on error.
   */
  getCwd(pid?: number): string | null {
    const targetPid = pid ?? this._pid;
    if (targetPid <= 0) return null;

    const buf = Buffer.alloc(1024);
    const len = lib.symbols.bun_pty_get_cwd(targetPid, ptr(buf), buf.length);
    if (len <= 0) return null;

    return buf.toString('utf8', 0, len);
  }

  /**
   * Get the name of a process.
   * Uses native APIs: proc_name on macOS, /proc on Linux.
   * @param pid The process ID (defaults to foreground process)
   * @returns The process name, or null on error.
   */
  getProcessName(pid?: number): string | null {
    const targetPid = pid ?? this.getForegroundPid();
    if (targetPid <= 0) return null;

    const buf = Buffer.alloc(256);
    const len = lib.symbols.bun_pty_get_process_name(targetPid, ptr(buf), buf.length);
    if (len <= 0) return null;

    return buf.toString('utf8', 0, len);
  }

  /**
   * Get the foreground process name (convenience method).
   * Combines getForegroundPid() and getProcessName().
   * @returns The foreground process name, or null if no foreground process.
   */
  getForegroundProcessName(): string | null {
    const fgPid = this.getForegroundPid();
    if (fgPid <= 0 || fgPid === this._pid) {
      return this.getProcessName(this._pid);
    }
    return this.getProcessName(fgPid);
  }

  private _initializePumpState(): void {
    this._readLoop = false;
    this._closing = false;
    this._exitFired = false;
    this._onData = new EventEmitter<string>();
    this._onExit = new EventEmitter<IExitEvent>();
    this._onForegroundProcessChange = new EventEmitter<string>();
    this._lastForegroundChangeCount = 0;
    this._lastForegroundProcessName = null;
    this._decoder = new TextDecoder('utf-8', { fatal: false });
    this._readBuffer = Buffer.alloc(READ_BUFFER_SIZE);
    this._wakeupFd = -1;
    this._wakeupReader = null;
    this._draining = false;
    this._drainRequested = false;
    this._pollingFallback = false;
  }

  private _startReadLoop(): void {
    if (this._readLoop) return;
    this._readLoop = true;

    const wakeupFd = lib.symbols.bun_pty_dup_wakeup_fd(this.handle);
    if (wakeupFd < 0) {
      this._switchToPollingFallback('wakeup fd unavailable');
      return;
    }

    this._wakeupFd = wakeupFd;
    const reader = Bun.file(wakeupFd).stream().getReader();
    this._wakeupReader = reader;
    void this._runWakeupLoop(reader);
    this._scheduleDrain();
  }

  private async _runWakeupLoop(reader: WakeupReader): Promise<void> {
    while (this._readLoop && !this._closing && reader === this._wakeupReader) {
      const result = await reader
        .read()
        .catch((error) => new Error('PTY wakeup reader failed', { cause: error }));
      if (result instanceof Error) {
        if (this._closing || reader !== this._wakeupReader) return;
        console.warn('[zig-pty] Wakeup stream failed, falling back to polling:', result);
        this._closeWakeupTransport();
        this._switchToPollingFallback('wakeup stream error');
        return;
      }

      if (this._closing || reader !== this._wakeupReader) {
        return;
      }

      if (result.done) {
        console.warn('[zig-pty] Wakeup stream ended unexpectedly, falling back to polling');
        this._closeWakeupTransport();
        this._switchToPollingFallback('wakeup stream ended');
        return;
      }

      this._scheduleDrain();
    }
  }

  private _switchToPollingFallback(reason: string): void {
    if (this._closing || this._pollingFallback) return;
    this._pollingFallback = true;
    console.warn(`[zig-pty] Using polling fallback: ${reason}`);
    void this._runPollingReadLoop();
  }

  private _scheduleDrain(): void {
    if (this._closing || this._pollingFallback || this.handle < 0) return;
    if (this._draining) {
      this._drainRequested = true;
      return;
    }

    this._draining = true;
    void this._drainAvailableData();
  }

  private _checkForegroundProcessChange(): void {
    if (this.handle < 0 || this._closing) return;

    const currentCount = lib.symbols.bun_pty_get_foreground_change_count(this.handle);
    if (currentCount < 0) return;

    if (currentCount !== this._lastForegroundChangeCount) {
      this._lastForegroundChangeCount = currentCount;

      // Get the new foreground process name
      const fgName = this.getForegroundProcessName();
      if (fgName) {
        // Always fire when the counter changes — even if fgName matches
        // the previously stored name. A fast command (e.g. git status) can
        // start and exit between two checks, making the foreground go
        // shell→git→shell. The counter increments twice but we only see
        // the final name. Without firing here, the consumer (aggregate
        // view metadata handler) never learns that the foreground changed
        // back to the shell, leaving a stale process name in the sidebar.
        this._lastForegroundProcessName = fgName;
        this._onForegroundProcessChange.fire(fgName);
      }
    }
  }

  /**
   * Sleep for the current throttle interval, but wake immediately
   * if setReadThrottleMs is called (via _throttleWakeResolve).
   * Returns true if woken early by a throttle change.
   */
  private async _throttleSleep(): Promise<boolean> {
    if (this._readThrottleMs < 0) {
      // Paused: sleep 500ms, wakeable
      const wakePromise = new Promise<void>((resolve) => {
        this._throttleWakeResolve = resolve;
      });
      const timerPromise = new Promise<void>((resolve) => setTimeout(resolve, 500));
      await Promise.race([timerPromise, wakePromise]);
      this._throttleWakeResolve = null;
      return this._readThrottleMs >= 0; // woken early = throttle changed away from paused
    }
    if (this._readThrottleMs > 0) {
      const wakePromise = new Promise<void>((resolve) => {
        this._throttleWakeResolve = resolve;
      });
      const timerPromise = new Promise<void>((resolve) =>
        setTimeout(resolve, this._readThrottleMs)
      );
      await Promise.race([timerPromise, wakePromise]);
      this._throttleWakeResolve = null;
      return this._readThrottleMs === 0; // woken early = throttle changed to focused
    }
    // Focused: 4ms yield (not interruptible — focused PTYs need consistent pacing)
    await Bun.sleep(4);
    return false;
  }

  private async _drainAvailableData(): Promise<void> {
    let chunksSinceYield = 0;
    // Batch accumulator: collect decoded chunks and fire a single onData
    // at the end of the drain cycle (or on yield). This reduces JS-side
    // event loop pressure from per-chunk EventEmitter dispatch + handleData
    // + rawBufferAppend + scheduleNotify calls. Under heavy output (golden
    // star at 30fps = ~3 chunks/frame × 30 = 90 EventEmitter fires/sec),
    // batching cuts this to ~30 fires/sec with 1/3 the per-notification overhead.
    const batchedChunks: string[] = [];
    let batchedLength = 0;

    const flushBatch = () => {
      if (batchedChunks.length === 0) return;
      const data = batchedChunks.length === 1 ? batchedChunks[0] : batchedChunks.join('');
      batchedChunks.length = 0;
      batchedLength = 0;
      this._onData.fire(data);
    };

    while (this._readLoop && !this._closing && !this._pollingFallback) {
      // If paused (background-hidden), sleep until woken.
      // Data accumulates in the kernel's PTY buffer.
      if (this._readThrottleMs < 0) {
        flushBatch();
        await this._throttleSleep();
        // Check foreground process changes even while paused.
        // Without this, non-active session PTYs (which are paused
        // because no TerminalView renders them) never emit
        // onForegroundProcessChange events, causing the aggregate
        // view sidebar to show stale process names indefinitely.
        this._checkForegroundProcessChange();
        continue;
      }

      const n = lib.symbols.bun_pty_read(
        this.handle,
        ptr(this._readBuffer),
        this._readBuffer.length
      );

      if (n > 0) {
        const data = this._decoder.decode(this._readBuffer.subarray(0, n), { stream: true });
        if (data.length > 0) {
          batchedChunks.push(data);
          batchedLength += data.length;
        }

        chunksSinceYield += 1;
        if (chunksSinceYield >= DRAIN_YIELD_INTERVAL) {
          chunksSinceYield = 0;
          flushBatch();
          await this._throttleSleep();
        }
        continue;
      }

      if (n === -2) {
        this._handleTerminalExit();
        break;
      }

      if (n < 0) {
        this._handleReadFailure();
        break;
      }

      break;
    }

    // Flush any remaining batched data after the drain loop exits.
    flushBatch();

    // Check for foreground process changes after draining data
    this._checkForegroundProcessChange();

    this._draining = false;

    if (this._drainRequested && this._readLoop && !this._closing && !this._pollingFallback) {
      this._drainRequested = false;
      this._scheduleDrain();
      return;
    }

    this._drainRequested = false;
  }

  private async _runPollingReadLoop(): Promise<void> {
    if (this._closing || !this._pollingFallback) return;

    while (this._readLoop && !this._closing && this._pollingFallback) {
      const n = lib.symbols.bun_pty_read(
        this.handle,
        ptr(this._readBuffer),
        this._readBuffer.length
      );

      if (n > 0) {
        const data = this._decoder.decode(this._readBuffer.subarray(0, n), { stream: true });
        if (data.length > 0) {
          this._onData.fire(data);
        }
        await Bun.sleep(0);
        continue;
      }

      if (n === -2) {
        this._handleTerminalExit();
        return;
      }

      if (n < 0) {
        this._handleReadFailure();
        return;
      }

      // Check for foreground process changes during polling
      this._checkForegroundProcessChange();

      await Bun.sleep(1);
    }
  }

  private _handleTerminalExit(): void {
    if (this._closing) return;
    this._closing = true;
    this._readLoop = false;
    this._pollingFallback = false;
    this._draining = false;
    this._drainRequested = false;

    const remaining = this._decoder.decode();
    if (remaining.length > 0) {
      this._onData.fire(remaining);
    }

    const exitCode = this.handle >= 0 ? lib.symbols.bun_pty_get_exit_code(this.handle) : 0;
    if (this.handle >= 0) {
      lib.symbols.bun_pty_close(this.handle);
      this.handle = -1;
    }

    this._closeWakeupTransport();

    if (!this._exitFired) {
      this._exitFired = true;
      this._onExit.fire({ exitCode });
    }
  }

  private _handleReadFailure(): void {
    if (this._closing) return;
    this._closing = true;
    this._readLoop = false;
    this._pollingFallback = false;
    this._draining = false;
    this._drainRequested = false;

    const exitCode = this.handle >= 0 ? lib.symbols.bun_pty_get_exit_code(this.handle) : -1;
    if (this.handle >= 0) {
      lib.symbols.bun_pty_close(this.handle);
      this.handle = -1;
    }

    this._closeWakeupTransport();

    if (!this._exitFired) {
      this._exitFired = true;
      this._onExit.fire({ exitCode });
    }
  }

  private _closeWakeupTransport(): void {
    const reader = this._wakeupReader;
    this._wakeupReader = null;

    if (reader) {
      void reader.cancel().catch((error) => {
        console.warn('[zig-pty] Failed to cancel wakeup reader:', error);
      });
    }

    if (this._wakeupFd < 0) return;

    const closeResult = errore.try<void, Error>({
      try: () => fs.closeSync(this._wakeupFd),
      catch: (error) => new Error('Failed to close PTY wakeup fd', { cause: error }),
    });
    if (closeResult instanceof Error) {
      console.warn('[zig-pty] Failed to close wakeup fd:', closeResult);
    }
    this._wakeupFd = -1;
  }
}
