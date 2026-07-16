export const MAX_CANDIDATES = 50;

/**
 * Return a new array pruned to MAX_CANDIDATES, dropping the entries with the
 * oldest lastSeen timestamps.
 */
export function prunedCandidates(candidates) {
  if (candidates.length <= MAX_CANDIDATES) return candidates;
  return [...candidates]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_CANDIDATES);
}
