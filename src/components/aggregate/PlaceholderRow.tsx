/**
 * PlaceholderRow - "..." row for unloaded sessions in tree-based aggregate view
 * Single line indicating more content available on demand
 */

import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { AggregateTheme } from '../../core/types';

export interface PlaceholderRowProps {
  /** Indentation string */
  indent: string;
  /** Max width available */
  maxWidth: number;
  /** Theme colors */
  aggregateTheme: AggregateTheme;
  /** Text colors from overlay */
  textColors: {
    foreground: string;
    muted: string;
    subtle: string;
  };
  /** Whether this row is selected */
  isSelected?: boolean;
  /** Selection handler (fires on mouseDown for immediate visual feedback) */
  onSelect?: () => void;
  /** Action handler to load the session (fires on mouseUp after click cycle completes) */
  onAction?: () => void;
  /** Optional label (defaults to "...") */
  label?: string;
}

/**
 * Placeholder row for unloaded sessions
 * Format: [indent][prefix] ...
 */
export function PlaceholderRow(props: PlaceholderRowProps) {
  const selectionColors = () => props.aggregateTheme.selection;
  const subtleColor = () =>
    props.isSelected ? selectionColors().foreground : props.textColors.subtle;
  const bgColor = () => (props.isSelected ? selectionColors().background : undefined);

  const label = () => props.label ?? '...';

  const handleMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect?.();
  };

  const handleMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onAction?.();
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      {/* Indentation */}
      <text fg={subtleColor()} selectable={false}>
        {props.indent}
      </text>
      {/* Placeholder dots in subtle color */}
      <text fg={subtleColor()} selectable={false}>
        {label()}
      </text>
    </box>
  );
}
