import type { FileEntry } from '../core/file-opener';

/** Score how well a file matches a query. Higher = better match. */
function computeScore(entry: FileEntry, terms: string[]): number {
  const lower = entry.relativePath.toLowerCase();
  const parts = lower.split('/');

  let score = 0;
  for (const term of terms) {
    // Exact basename match
    const basename = parts[parts.length - 1] ?? '';
    if (basename === term) {
      score += 100;
      continue;
    }
    // Basename starts with term
    if (basename.startsWith(term)) {
      score += 80;
      continue;
    }
    // Basename contains term
    if (basename.includes(term)) {
      score += 50;
      continue;
    }
    // Full path contains term
    if (lower.includes(term)) {
      score += 20;
      continue;
    }
    // No match for this term - reject
    return -1;
  }

  // Prefer shorter paths (closer to root)
  score -= parts.length;

  // Prefer files in common source directories
  const dir = parts.slice(0, -1).join('/');
  if (dir.startsWith('src') || dir.startsWith('lib') || dir.startsWith('cmd')) {
    score += 5;
  }

  return score;
}

export function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return files;

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return files;

  // Hide "Open folder" when the user is typing a query
  const candidates = files.filter((entry) => !entry.isFolderAction);

  const scored = candidates
    .map((entry) => ({ entry, score: computeScore(entry, terms) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.entry);
}
