/**
 * CopyNotification - displays a toast when text is copied to clipboard
 * Positioned at the top-right of the pane where copy occurred
 */

import { Show, createMemo, type Accessor } from 'solid-js';
import { RGBA } from '@opentui/core';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { getDefaultColors, getHostColors } from '../terminal/terminal-colors';
import { mixColor, toRgba } from '../terminal/color-utils';

interface PaneRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopyNotificationProps {
  visible: boolean;
  status: 'pending' | 'success' | 'error';
  charCount: number;
  /** Rectangle of the pane where copy occurred */
  paneRect: PaneRectangle | null;
}

const TOAST_WIDTH = 25;
const TOAST_HEIGHT = 3;

const HEX_RGBA_RE = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;
const AUTO_VALUE = 'auto';
const BG_ALPHA = 204;
const BG_BLEND = 0.05;

function parseRgbaHex(value: string, fallback: RGBA): RGBA {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === AUTO_VALUE) return fallback;
  const match = HEX_RGBA_RE.exec(trimmed);
  if (!match) return fallback;
  const hex = match[1];
  const alpha = match[2];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = alpha ? parseInt(alpha, 16) : 255;
  return RGBA.fromInts(r, g, b, a);
}

/**
 * A toast notification that appears at the top-right of the pane
 * Styled with left/right partial borders matching the pane focus color
 * Uses semi-transparent dark background
 */
function formatCharCount(charCount: number): string {
  if (charCount >= 1_000_000) {
    return `${(charCount / 1_000_000).toFixed(charCount >= 10_000_000 ? 0 : 1)}M`;
  }
  if (charCount >= 1_000) {
    return `${(charCount / 1_000).toFixed(charCount >= 10_000 ? 0 : 1)}k`;
  }
  return `${charCount}`;
}

export function CopyNotification(props: CopyNotificationProps) {
  const theme = useTheme();
  const terminal = useTerminal();
  const copyColors = () => theme.ui.copyNotification;
  const palette = createMemo(() => {
    void terminal.hostColorsVersion;
    return getHostColors() ?? getDefaultColors();
  });
  const backgroundColor = createMemo(() => palette().background);
  const foregroundColor = createMemo(() => palette().foreground);
  const autoBgColor = createMemo(() =>
    toRgba(mixColor(backgroundColor(), foregroundColor(), BG_BLEND), BG_ALPHA)
  );
  const autoTextColor = createMemo(() => toRgba(foregroundColor()));
  const autoBorderColor = createMemo(() =>
    parseRgbaHex(theme.pane.focusedBorderColor, autoTextColor())
  );
  const bgColor = () => parseRgbaHex(copyColors().backgroundColor, autoBgColor());
  const textColor = () => parseRgbaHex(copyColors().textColor, autoTextColor());
  const borderColor = () => parseRgbaHex(copyColors().borderColor, autoBorderColor());
  const label = createMemo(() => {
    if (props.status === 'pending') return 'Copying content…';
    if (props.status === 'error') return 'Copy failed';
    if (props.charCount > 0) return `Copied ${formatCharCount(props.charCount)} chars`;
    return 'Copied to clipboard';
  });

  return (
    <Show when={props.visible && props.paneRect}>
      {(paneRect: Accessor<PaneRectangle>) => {
        const leftPosition = () => Math.max(0, paneRect().x + paneRect().width - TOAST_WIDTH - 2);
        const topPosition = () => paneRect().y + 1;

        return (
          <box
            style={{
              position: 'absolute',
              left: leftPosition(),
              top: topPosition(),
              width: TOAST_WIDTH,
              height: TOAST_HEIGHT,
              backgroundColor: bgColor(),
              zIndex: 250,
              border: ['left', 'right'],
              borderStyle: 'single',
              borderColor: borderColor(),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <text
              style={{
                fg: textColor(),
              }}
              content={label()}
            />
          </box>
        );
      }}
    </Show>
  );
}
