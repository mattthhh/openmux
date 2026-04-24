/**
 * Shared hint truncation helpers.
 */

export function truncateHint(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text.padEnd(width);
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

/** Truncate hint text without padding — for right-aligned flex containers. */
export function truncateHintRight(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}
