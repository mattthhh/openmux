import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fsActual from "node:fs";

import * as capabilitiesActual from "../../../src/terminal/capabilities";
import * as hostColorSchemeActual from "../../../src/terminal/host-color-scheme";
import * as terminalColorsActual from "../../../src/terminal/terminal-colors";
import type { TerminalColors } from "../../../src/terminal/terminal-colors";
import { effectBridgeMocks } from "../../mocks/effect-bridge";

let createHostColorSync: typeof import("../../../src/contexts/terminal/host-color-sync").createHostColorSync;
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const mocks = vi.hoisted(() => {
  const schemeListenerRef: { current: ((scheme: "light" | "dark") => void) | null } = { current: null };
  const appearanceTriggerRef: { current: (() => void) | null } = { current: null };
  const watchCallbackRef: { current: ((event: string, filename?: string) => void) | null } = { current: null };
  const watchClose = vi.fn();
  return {
    schemeListenerRef,
    appearanceTriggerRef,
    watchCallbackRef,
    watchClose,
    areTerminalColorsEqual: vi.fn(),
    getHostColors: vi.fn(),
    refreshHostColorsCache: vi.fn(),
    setHostColors: vi.fn(),
    setHostCapabilitiesColors: vi.fn(),
    applyHostColors: effectBridgeMocks.applyHostColors,
    watchSystemAppearance: vi.fn(),
  };
});

vi.mock("node:fs", () => {
  const watch = (path: string, options: unknown, cb: (event: string, filename?: string) => void) => {
    mocks.watchCallbackRef.current = cb;
    return { close: mocks.watchClose };
  };
  return {
    ...fsActual,
    default: { ...fsActual, watch },
    watch,
  };
});

vi.mock("../../../src/terminal/terminal-colors", () => ({
  ...terminalColorsActual,
  areTerminalColorsEqual: mocks.areTerminalColorsEqual,
  getHostColors: mocks.getHostColors,
  refreshHostColors: mocks.refreshHostColorsCache,
  setHostColors: mocks.setHostColors,
}));

vi.mock("../../../src/terminal/host-color-scheme", () => ({
  ...hostColorSchemeActual,
  onHostColorScheme: (listener: (scheme: "light" | "dark") => void) => {
    mocks.schemeListenerRef.current = listener;
    return vi.fn();
  },
}));

vi.mock("../../../src/terminal/capabilities", () => ({
  ...capabilitiesActual,
  setHostCapabilitiesColors: mocks.setHostCapabilitiesColors,
}));

vi.mock("../../../native/zig-pty/ts/index", () => ({
  spawnAsync: vi.fn(),
  watchSystemAppearance: (cb: () => void) => {
    mocks.appearanceTriggerRef.current = cb;
    return vi.fn();
  },
}));

const makeColors = (foreground: number, background: number, isDefault = false): TerminalColors => ({
  foreground,
  background,
  palette: Array.from({ length: 16 }, (_, idx) => (foreground + idx) & 0xffffff),
  isDefault,
});

describe("createHostColorSync", () => {
  const renderer = { requestRender: vi.fn() };
  const bumpHostColorsVersion = vi.fn();
  const isActive = () => true;
  const originalHome = process.env.HOME;

  beforeAll(async () => {
    ({ createHostColorSync } = await import("../../../src/contexts/terminal/host-color-sync"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, "platform", { ...originalPlatform, value: "darwin" });
    }
    process.env.HOME = "/tmp";
    mocks.areTerminalColorsEqual.mockReturnValue(false);
    mocks.applyHostColors.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    vi.useRealTimers();
  });

  it("refreshes host colors and applies updates", async () => {
    const previous = makeColors(0x111111, 0x222222);
    const next = makeColors(0xaaaaaa, 0xbbbbbb);
    mocks.getHostColors.mockReturnValue(previous);
    mocks.refreshHostColorsCache.mockResolvedValue(next);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    const didChange = await sync.refreshHostColors({ timeoutMs: 123, oscMode: "fast" });

    expect(didChange).toBe(true);
    expect(mocks.refreshHostColorsCache).toHaveBeenCalledWith({ timeoutMs: 123, oscMode: "fast" });
    expect(mocks.setHostCapabilitiesColors).toHaveBeenCalledWith(next);
    expect(bumpHostColorsVersion).toHaveBeenCalled();
    expect(renderer.requestRender).toHaveBeenCalled();
    expect(mocks.applyHostColors).toHaveBeenCalledWith(next);
  });

  it("applies cached scheme colors before refresh", async () => {
    const dark = makeColors(0x101010, 0x202020);
    const light = makeColors(0xf0f0f0, 0xffffff);
    mocks.getHostColors
      .mockReturnValueOnce(dark)
      .mockReturnValueOnce(light);
    mocks.refreshHostColorsCache.mockResolvedValue(light);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    sync.start();
    expect(mocks.schemeListenerRef.current).not.toBeNull();

    mocks.schemeListenerRef.current?.("light");
    await new Promise((resolve) => setImmediate(resolve));

    mocks.setHostColors.mockClear();
    mocks.setHostCapabilitiesColors.mockClear();
    mocks.applyHostColors.mockClear();

    mocks.schemeListenerRef.current?.("dark");
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.setHostColors).toHaveBeenCalledWith(dark);
    expect(mocks.setHostCapabilitiesColors).toHaveBeenCalledWith(dark);
    expect(renderer.requestRender).toHaveBeenCalled();
    expect(mocks.applyHostColors).toHaveBeenCalledWith(dark);
  });

  it("polls fast then schedules full refresh on appearance change", async () => {
    // Use real timers since fake timers struggle with nested async + timer scheduling
    const next = makeColors(0x333333, 0x444444);
    mocks.refreshHostColorsCache.mockResolvedValue(next);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    sync.start();
    expect(mocks.appearanceTriggerRef.current).not.toBeNull();

    mocks.appearanceTriggerRef.current?.();
    
    // Wait for debounce (50ms) + palette delay (400ms) + buffer
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(mocks.refreshHostColorsCache).toHaveBeenCalledTimes(2);
    expect(mocks.refreshHostColorsCache).toHaveBeenNthCalledWith(1, { timeoutMs: 200, oscMode: "fast" });
    expect(mocks.refreshHostColorsCache).toHaveBeenNthCalledWith(2, { timeoutMs: 500, oscMode: "full" });
  });
});
