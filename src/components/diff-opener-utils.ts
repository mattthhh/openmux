import type { DiffTarget } from '../core/diff-opener';

/** Score how well a branch target matches a query. Higher = better match. */
function computeScore(entry: DiffTarget, terms: string[]): number {
  if (entry.isSeparator) return -1;

  const lower = entry.label.toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (lower === term) {
      score += 100;
      continue;
    }
    if (lower.startsWith(term)) {
      score += 80;
      continue;
    }
    if (lower.includes(term)) {
      score += 50;
      continue;
    }
    return -1;
  }

  // Boost built-in targets
  if (entry.type === 'unstaged') score += 10;
  if (entry.type === 'staged') score += 8;
  if (entry.type === 'lastCommit') score += 5;

  return score;
}

export function filterDiffTargets(targets: DiffTarget[], query: string): DiffTarget[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return targets;

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return targets;

  const scored = targets
    .map((target) => ({ target, score: computeScore(target, terms) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.target);
}
