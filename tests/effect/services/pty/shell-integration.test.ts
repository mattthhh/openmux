import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareShellIntegration } from '../../../../src/effect/services/pty/shell-integration';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const ORIGINAL_OPENMUX_SHELL_HOOKS = process.env.OPENMUX_SHELL_HOOKS;

function createEnvRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-shell-integration-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { root, home };
}

describe('prepareShellIntegration', () => {
  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = ORIGINAL_HOME;
    }

    if (ORIGINAL_XDG_CONFIG_HOME === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
    }

    if (ORIGINAL_OPENMUX_SHELL_HOOKS === undefined) {
      delete process.env.OPENMUX_SHELL_HOOKS;
    } else {
      process.env.OPENMUX_SHELL_HOOKS = ORIGINAL_OPENMUX_SHELL_HOOKS;
    }
  });

  it('creates a bash rcfile shim that reports cwd updates', () => {
    const { root, home } = createEnvRoot();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
    delete process.env.OPENMUX_SHELL_HOOKS;

    const result = prepareShellIntegration('/bin/bash', { HOME: home });

    expect(result.args[0]).toBe('--rcfile');
    expect(result.args[1]).toBeTruthy();
    expect(result.env.OPENMUX_ORIGINAL_BASHRC).toBe(path.join(home, '.bashrc'));

    const hookPath = result.env.OPENMUX_SHELL_INTEGRATION;
    expect(hookPath).toBeTruthy();
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf8')).toContain('__openmux_emit_cwd');
    expect(fs.readFileSync(hookPath, 'utf8')).toContain('PROMPT_COMMAND');
    expect(fs.readFileSync(hookPath, 'utf8')).toContain('openmux;cwd=%s');

    const rcfilePath = result.args[1]!;
    expect(fs.existsSync(rcfilePath)).toBe(true);
    const rcfile = fs.readFileSync(rcfilePath, 'utf8');
    expect(rcfile).toContain('OPENMUX_ORIGINAL_BASHRC');
    expect(rcfile).toContain('OPENMUX_SHELL_INTEGRATION');
  });

  it('keeps zsh integration wired for chpwd-driven cwd updates', () => {
    const { root, home } = createEnvRoot();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
    delete process.env.OPENMUX_SHELL_HOOKS;

    const result = prepareShellIntegration('/bin/zsh', { HOME: home });

    expect(result.args).toEqual([]);
    const hookPath = result.env.OPENMUX_SHELL_INTEGRATION;
    expect(hookPath).toBeTruthy();
    const hook = fs.readFileSync(hookPath, 'utf8');
    expect(hook).toContain('add-zsh-hook chpwd __openmux_chpwd');
    expect(hook).toContain('openmux;cwd=%s');
  });
});
