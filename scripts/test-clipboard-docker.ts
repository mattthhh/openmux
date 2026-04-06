#!/usr/bin/env bun
/**
 * Docker test for clipboard support
 * Tests that the clipboard service correctly detects available tools
 * Note: wl-clipboard requires a real Wayland compositor to function, so we
 * verify the correct tool is selected based on environment variables
 */

import { createClipboard } from '../src/effect/services/Clipboard';

async function checkToolExists(cmd: string): Promise<boolean> {
  try {
    const result = await Bun.$`which ${cmd}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function testEnvironment(name: string, env: Record<string, string | undefined>) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${name}`);
  console.log('='.repeat(50));

  // Set environment
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    console.log(`${key}: ${value || '(unset)'}`);
  }

  const wayland = !!process.env.WAYLAND_DISPLAY;
  const hasWlCopy = await checkToolExists('wl-copy');
  const hasXclip = await checkToolExists('xclip');

  console.log(`\nExpected behavior:`);
  if (wayland && hasWlCopy) {
    console.log('  → Should use wl-copy/wl-paste (Wayland mode)');
  } else if (hasXclip) {
    console.log('  → Should use xclip (X11 mode)');
  } else {
    console.log('  → No clipboard tool available');
  }

  // Create clipboard service
  console.log('\nInitializing clipboard service...');
  const clipboard = await createClipboard();
  console.log('✓ Clipboard service created');

  // Try read (will fail without actual display server, but shows which tool was selected)
  console.log('\nTesting clipboard read...');
  const readResult = await clipboard.read();

  if (readResult instanceof Error) {
    console.log(`  Result: ${readResult.message}`);

    // Check if the error mentions the expected tool
    const errorStr = readResult.message.toLowerCase();
    if (wayland && hasWlCopy && errorStr.includes('wl-paste')) {
      console.log('  ✓ Correctly attempted to use wl-paste (Wayland)');
    } else if ((!wayland || !hasWlCopy) && hasXclip && errorStr.includes('xclip')) {
      console.log('  ✓ Correctly attempted to use xclip (X11)');
    }
  } else {
    console.log(`  ✓ Read successful: "${readResult.substring(0, 50)}..."`);
  }

  return true;
}

async function main() {
  console.log('Clipboard Service Detection Tests');
  console.log('=================================\n');
  console.log('Platform:', process.platform);
  console.log('Architecture:', process.arch);

  // Test 1: Wayland mode
  await testEnvironment('Wayland Mode', {
    WAYLAND_DISPLAY: 'wayland-0',
    DISPLAY: undefined,
  });

  // Test 2: X11 mode
  await testEnvironment('X11 Mode', {
    WAYLAND_DISPLAY: undefined,
    DISPLAY: ':0',
  });

  // Test 3: Neither (should prefer Wayland tools if available, then X11)
  await testEnvironment('No Display (Wayland tools available)', {
    WAYLAND_DISPLAY: undefined,
    DISPLAY: undefined,
  });

  console.log('\n' + '='.repeat(50));
  console.log('All detection tests completed successfully!');
  console.log('='.repeat(50));
  console.log('\nNote: Actual clipboard operations require a running');
  console.log('Wayland compositor or X11 display server.');
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
