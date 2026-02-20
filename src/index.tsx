/**
 * Terminal multiplexer with master-stack layout
 */

import { getCliVersion } from './cli/version';

async function handleCliFlags(): Promise<boolean> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    const version = await getCliVersion();
    console.log(version);
    return true;
  }
  return false;
}

async function runShimIfRequested(): Promise<boolean> {
  if (!process.argv.includes('--shim')) {
    return false;
  }

  const { runShim } = await import('./shim/main');
  await runShim();
  return true;
}

async function main() {
  if (await handleCliFlags()) {
    return;
  }
  if (await runShimIfRequested()) {
    return;
  }

  const { runCli } = await import('./cli');
  const cliOutcome = await runCli(process.argv.slice(2));
  if (cliOutcome.kind === 'handled') {
    process.exitCode = cliOutcome.exitCode;
    return;
  }
  if (cliOutcome.kind === 'attach' && cliOutcome.session) {
    process.env.OPENMUX_START_SESSION = cliOutcome.session;
  }

  try {
    // Initialize services first
    const { initializeServices } = await import('./effect/services');
    const { setServices } = await import('./effect/bridge/services-instance');
    const services = await initializeServices();
    if (services instanceof Error) {
      throw new Error(`Failed to initialize services: ${services.message}`);
    }
    setServices(services);

    const { render, useRenderer } = await import('@opentui/solid');
    const { ConsolePosition } = await import('@opentui/core');
    const { App } = await import('./App');
    const { detectHostCapabilities } = await import('./terminal');
    const { onMount, onCleanup } = await import('solid-js');
    const { createPasteInterceptingStdin } = await import('./terminal/paste-intercepting-stdin');
    const { triggerClipboardPaste } = await import('./terminal/focused-pty-registry');
    const { setHostSequenceWriter, writeHostSequence } = await import('./terminal/host-output');

    // Wrapper component that handles kitty keyboard setup after render
    function AppWithSetup() {
      const renderer = useRenderer();

      onMount(() => {
        setHostSequenceWriter((sequence) => {
          const stdout = (renderer as any).stdout ?? process.stdout;
          const writeOut = (renderer as any).realStdoutWrite ?? stdout.write.bind(stdout);
          writeOut.call(stdout, sequence);
          if (stdout.isTTY) {
            (stdout as any)._handle?.flush?.();
          }
        });
        // Enable kitty keyboard protocol AFTER renderer setup
        // Flag 1 = disambiguate escape codes (detect Alt+key without breaking regular input)
        // Flag 2 = report key releases/repeats
        // Flag 8 was too aggressive - it reports ALL keys as escape codes, breaking shift
        // Must be done after createCliRenderer since setupTerminal() resets modes
        // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
        renderer.enableKittyKeyboard(3);
        // Use set mode to ensure report_events is enabled in Ghostty.
        writeHostSequence('\x1b[=3;1u');
        // Enable focus-in/out events from the host terminal.
        writeHostSequence('\x1b[?1004h');
        // Enable color scheme reporting (Ghostty mode 2031).
        writeHostSequence('\x1b[?2031h');
      });

      onCleanup(() => {
        // Disable focus tracking so we don't pollute the parent shell.
        writeHostSequence('\x1b[?1004l');
        writeHostSequence('\x1b[?2031l');
        setHostSequenceWriter(null);
      });

      return <App />;
    }

    // Prime host capabilities (including color query) before the renderer takes over stdin
    const hostCaps = await detectHostCapabilities();
    const useThreadEnv = (process.env.OPENMUX_RENDER_USE_THREAD ?? '').toLowerCase();
    const useThread =
      useThreadEnv === '1' || useThreadEnv === 'true'
        ? true
        : useThreadEnv === '0' || useThreadEnv === 'false'
          ? false
          : !hostCaps.kittyGraphics;

    // Create paste-intercepting stdin wrapper
    // This intercepts bracketed paste sequences at the raw Buffer level (before UTF-8 encoding)
    // and triggers clipboard read instead of using unreliable stdin paste data
    const interceptingStdin = createPasteInterceptingStdin(
      process.stdin,
      {
        onPasteTriggered: () => {
          // Trigger clipboard read and PTY write
          // App.tsx registers the handler which:
          // - Reads from system clipboard (always complete, no chunking issues)
          // - Checks if child app has mode 2004 enabled
          // - Wraps with bracketed paste markers if needed
          // - Writes atomically to PTY
          triggerClipboardPaste();
        },
      }
    );

    // Render the app with Solid - render creates the renderer internally
    await render(() => <AppWithSetup />, {
      stdin: interceptingStdin,
      exitOnCtrlC: false,
      exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT'], // No SIGINT - let Ctrl+C go to PTY
      useMouse: true, // Enable mouse tracking to properly consume mouse escape sequences
      enableMouseMovement: true, // Track mouse movement for drag and hover events
      useConsole: true, // Enable debug console (toggle with prefix + `)
      useKittyKeyboard: { events: true },
      useThread,
      consoleOptions: {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      },
    });
  } catch (error) {
    console.error('Failed to start openmux:', error);
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      const base = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
      const dir = path.join(base, 'openmux');
      const logPath = path.join(dir, 'startup-error.log');
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(logPath, `${message}\n`, 'utf8');
    } catch {
      // Best-effort logging only.
    }
    process.exit(1);
  }
}

main();
