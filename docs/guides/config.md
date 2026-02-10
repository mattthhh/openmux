# Configuration

This document is generated from the default openmux config.

It mirrors the file created at:
- `~/.config/openmux/config.toml`
- `$XDG_CONFIG_HOME/openmux/config.toml` (if set)

Regenerate with:

```bash
bun scripts/generate-config-doc.ts
```

```toml
[layout]
windowGap = 0
borderWidth = 1
defaultLayoutMode = "vertical"
defaultSplitRatio = 0.5
minPaneWidth = 10
minPaneHeight = 5

  [layout.outerPadding]
  top = 0
  right = 0
  bottom = 0
  left = 0

[theme]
searchAccentColor = "#FFAA00"

  [theme.pane]
  borderColor = "#444444"
  focusedBorderColor = "#00AAFF"
  copyModeBorderColor = "#8b5cf6"
  urgentBorderColor = "#FF5500"
  borderStyle = "rounded"
  innerGap = 1
  outerGap = 1
  titleColor = "#888888"
  focusedTitleColor = "#FFFFFF"
  copyModeTitleColor = "#8b5cf6"

  [theme.statusBar]
  backgroundColor = "#1a1a1a"
  foregroundColor = "#CCCCCC"
  activeTabColor = "#00AAFF"
  inactiveTabColor = "#666666"
  successColor = "#33CC66"

  [theme.ui]
  mutedText = "#666666"

    [theme.ui.listSelection]
    foreground = "#FFFFFF"
    background = "#334455"

    [theme.ui.buttonFocus]
    foreground = "#FFFFFF"
    background = "#334455"

    [theme.ui.copyNotification]
    borderColor = "auto"
    textColor = "auto"
    backgroundColor = "auto"

[theme.ui.copyMode.selection]
foreground = "#f5f3ff"
background = "#7c3aed"

[theme.ui.copyMode.cursor]
foreground = "#1f2937"
background = "#c4b5fd"

[theme.ui.aggregate.selection]
foreground = "#FFFFFF"
background = "#3b82f6"
dim = "#93c5fd"

[theme.ui.aggregate.diff]
added = "#22c55e"
removed = "#ef4444"
addedSelected = "#86efac"
removedSelected = "#fca5a5"
binarySelected = "#cbd5f5"

[session]
autoSaveIntervalMs = 30_000
autoCreatePaneOnEmptyWorkspace = true

[keyboard]
vimMode = "off"
vimSequenceTimeoutMs = 1_000
prefixOnly = false

[keybindings]
prefixKey = "ctrl+b"
prefixTimeoutMs = 2_000

  [keybindings.normal]
  "alt+h" = "pane.focus.west"
  "alt+j" = "pane.focus.south"
  "alt+k" = "pane.focus.north"
  "alt+l" = "pane.focus.east"
  "alt+m" = "mode.move"
  "alt+n" = "pane.new"
  "alt+s" = "session.picker.toggle"
  "alt+t" = "template.overlay.toggle"
  "alt+g" = "aggregate.toggle"
  "alt+f" = "search.open"
  "alt+p" = "command.palette.toggle"
  "alt+[" = "layout.cycle.prev"
  "alt+]" = "layout.cycle.next"
  "alt+z" = "pane.zoom"
  "alt+x" = "pane.close"
  "alt+-" = "pane.split.horizontal"
  "alt+\\" = "pane.split.vertical"
  "alt+1" = "workspace.switch.1"
  "alt+2" = "workspace.switch.2"
  "alt+3" = "workspace.switch.3"
  "alt+4" = "workspace.switch.4"
  "alt+5" = "workspace.switch.5"
  "alt+6" = "workspace.switch.6"
  "alt+7" = "workspace.switch.7"
  "alt+8" = "workspace.switch.8"
  "alt+9" = "workspace.switch.9"

  [keybindings.prefix]
  1 = "workspace.switch.1"
  2 = "workspace.switch.2"
  3 = "workspace.switch.3"
  4 = "workspace.switch.4"
  5 = "workspace.switch.5"
  6 = "workspace.switch.6"
  7 = "workspace.switch.7"
  8 = "workspace.switch.8"
  9 = "workspace.switch.9"
  h = "pane.focus.west"
  j = "pane.focus.south"
  k = "pane.focus.north"
  l = "pane.focus.east"
  m = "mode.move"
  n = "pane.new"
  enter = "pane.new"
  "\\" = "pane.split.vertical"
  - = "pane.split.horizontal"
  x = "pane.close"
  v = "layout.mode.vertical"
  "shift+h" = "layout.mode.horizontal"
  t = "layout.mode.stacked"
  "shift+t" = "template.overlay.toggle"
  s = "session.picker.toggle"
  g = "aggregate.toggle"
  "/" = "search.open"
  "[" = "copy.mode"
  ":" = "command.palette.toggle"
  z = "pane.zoom"
  "]" = "clipboard.paste"
  p = "clipboard.paste"
  "`" = "console.toggle"
  q = "app.quit"
  d = "app.detach"
  "shift+o" = "keyboard.prefix-only.toggle"
  escape = "mode.cancel"

  [keybindings.move]
  h = "pane.move.west"
  j = "pane.move.south"
  k = "pane.move.north"
  l = "pane.move.east"
  escape = "mode.cancel"

  [keybindings.search]
  "ctrl+n" = "search.next"
  "ctrl+p" = "search.prev"
  enter = "search.confirm"
  escape = "search.cancel"
  backspace = "search.delete"

  [keybindings.commandPalette]
  down = "command.palette.down"
  up = "command.palette.up"
  enter = "command.palette.confirm"
  escape = "command.palette.close"
  backspace = "command.palette.delete"

[keybindings.templateOverlay.apply]
escape = "template.close"
tab = "template.tab.save"
down = "template.list.down"
up = "template.list.up"
enter = "template.apply"
"ctrl+x" = "template.delete"
"ctrl+d" = "template.delete"

[keybindings.templateOverlay.save]
escape = "template.close"
tab = "template.tab.apply"
enter = "template.save"
backspace = "template.save.delete"

[keybindings.aggregate.list]
down = "aggregate.list.down"
up = "aggregate.list.up"
enter = "aggregate.list.preview"
tab = "aggregate.list.jump"
"alt+escape" = "aggregate.list.close"
"alt+a" = "aggregate.list.toggle.scope"
"alt+x" = "aggregate.kill"
backspace = "aggregate.list.delete"

[keybindings.aggregate.preview]
"alt+escape" = "aggregate.preview.exit"
"alt+f" = "aggregate.preview.search"
"alt+x" = "aggregate.kill"

[keybindings.aggregate.search]
enter = "aggregate.search.confirm"
escape = "aggregate.search.cancel"
"ctrl+n" = "aggregate.search.next"
"ctrl+p" = "aggregate.search.prev"
backspace = "aggregate.search.delete"

[keybindings.aggregate.prefix]
q = "aggregate.prefix.quit"
d = "aggregate.prefix.detach"
escape = "aggregate.prefix.exit"
"/" = "aggregate.prefix.search"

[keybindings.sessionPicker.list]
escape = "session.picker.close"
down = "session.picker.down"
up = "session.picker.up"
enter = "session.picker.select"
backspace = "session.picker.filter.delete"
"ctrl+n" = "session.picker.create"
"ctrl+r" = "session.picker.rename"
"ctrl+x" = "session.picker.delete"
"ctrl+d" = "session.picker.delete"

[keybindings.sessionPicker.rename]
escape = "session.picker.rename.cancel"
enter = "session.picker.rename.confirm"
backspace = "session.picker.rename.delete"

  [keybindings.confirmation]
  escape = "confirm.cancel"
  enter = "confirm.accept"
  left = "confirm.focus.confirm"
  h = "confirm.focus.confirm"
  right = "confirm.focus.cancel"
  l = "confirm.focus.cancel"
  tab = "confirm.focus.cancel"
```
