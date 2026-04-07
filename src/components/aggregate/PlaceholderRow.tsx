/**
 * PlaceholderRow - "..." row for unloaded sessions in tree-based aggregate view
 * Single line indicating more content available on demand
 */

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
  /** Click handler to load the session */
  onClick?: () => void;
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

  const handleClick = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onClick?.();
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleClick}
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
