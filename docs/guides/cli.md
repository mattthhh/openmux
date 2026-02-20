# openmux CLI (v1)

This document specifies the first ergonomic, headless-style CLI for openmux
without introducing a muxd. The CLI talks to a UI-owned control socket for
pane/layout operations and falls back to on-disk session storage for session
index operations.

## Principles

- `openmux` with no args always steals and attaches (current behavior).
- Headless CLI commands never steal the shim client.
- Pane/layout commands require an attached UI (control socket available).
- Session listing/creation can run offline (disk-only).
- Explicit targets over tmux-style `-t` grammar.

## Control Socket

- Socket path: `~/.config/openmux/sockets/openmux-ui.sock`
- Environment overrides (tests/dev):
  - `OPENMUX_CONTROL_SOCKET_DIR`
  - `OPENMUX_CONTROL_SOCKET_PATH`
- Multiple control clients are allowed.
- The control socket is owned by the attached UI process.

## Commands

### Attach

```
openmux
openmux attach [--session <name|id>]
```

- Always steals and attaches.
- `--session` switches to the requested session on startup.
- If the named session does not exist, it is created and set active.

### Update

```
openmux update [--yes] [--prerelease]
```

- Checks GitHub Releases for a newer openmux version.
- Installs update assets into the managed runtime directory (`$XDG_DATA_HOME/openmux`).
- By default, prompts before installing.
- In non-interactive mode, pass `--yes`.
- `--prerelease` includes prerelease tags when selecting the latest version.

### Session

```
openmux session list [--json]
openmux session create [name]
```

- `session list` reads the on-disk session index.
- `session create`:
  - If UI control socket is available: create and switch in the UI.
  - Otherwise: create on disk and mark active for next attach.

### Pane

```
openmux pane split --direction <vertical|horizontal> [--workspace <1-9>] [--pane <selector>]
openmux pane send --text <text> [--workspace <1-9>] [--pane <selector>]
openmux pane capture [--lines <n>] [--format <text|ansi>] [--raw] [--workspace <1-9>] [--pane <selector>]
```

- All pane commands require a running UI (control socket).
- `pane split` focuses the target pane before splitting.
- `pane send` writes to the target pane’s PTY (C-style escapes like `\n`, `\t`, `\xNN`, `\uXXXX` are decoded).
- `pane capture` returns the last N lines from scrollback + visible screen, trimming trailing empty lines by default.
- `--raw` preserves trailing whitespace and blank lines.

## Targeting

`--pane <selector>` supports:

- `focused` (default)
- `main`
- `stack:<n>` (1-based index in stack)
- `pane:<id>`
- `pty:<id>`
- raw `pane-123` is treated as `pane:<id>`

Workspace rules:

- `--workspace` defaults to the active workspace.
- `main` and `stack:<n>` are resolved within the selected workspace.
- `pane:<id>` and `pty:<id>` may resolve across workspaces.

## Output

- `session list --json` emits:
  - `[{ id, name, createdAt, lastSwitchedAt, autoNamed, active }]`
- `session create` prints the new session id on stdout.
- `pane capture` prints captured text to stdout.
- Other commands are silent on success.

## Help

```
openmux --help
openmux pane --help
openmux pane capture --help
```

- `--help` works at the root and subcommand levels.

## Exit Codes

- `0` success
- `2` usage error
- `3` no active UI control socket
- `4` target not found
- `5` ambiguous target
- `6` internal error

## Examples

```
openmux session list --json
openmux session create dev
openmux attach --session dev
openmux update
openmux update --yes
openmux pane split --direction vertical --workspace 2
openmux pane send --pane focused --text "npm test\n"
openmux pane capture --pane focused --lines 200 --format ansi
```
