/**
 * Pure helper functions for the message display popup.
 * No browser APIs — fully unit-testable.
 */

/**
 * Find a decision log entry by RFC Message-ID (stable primary key).
 * Returns the first matching entry, or null when not found.
 *
 * Matching is exact after trimming both sides. RFC Message-IDs are
 * case-sensitive by spec, so no case folding is applied.
 *
 * @param {Array} decisionLog - Array of decision log entries.
 * @param {string|null|undefined} rfcMessageId - RFC Message-ID to look up.
 * @returns {object|null}
 */
export function findLogEntryByRfcMessageId(decisionLog, rfcMessageId) {
  if (!rfcMessageId || !Array.isArray(decisionLog)) return null;
  const needle = rfcMessageId.trim();
  if (!needle) return null;
  return decisionLog.find(
    e => e.messageIdentity?.rfcMessageId?.trim() === needle,
  ) ?? null;
}

/**
 * Recursively search a Thunderbird folder list for the first folder whose
 * type is "inbox". Searches depth-first through subFolders.
 *
 * @param {Array} folders - Thunderbird MailFolder array.
 * @returns {object|null}
 */
export function findInboxFolder(folders) {
  if (!Array.isArray(folders)) return null;
  for (const f of folders) {
    if (f.type === 'inbox') return f;
    const found = findInboxFolder(f.subFolders);
    if (found) return found;
  }
  return null;
}

/**
 * Extract displayable context key-value pairs from a score reason object.
 * Skips the standard fields (key, label, delta) so callers see only
 * the supplemental context fields.
 *
 * @param {object} reason
 * @returns {Array<{key: string, value: string}>}
 */
export function reasonContextPairs(reason) {
  const SKIP = new Set(['key', 'label', 'delta']);
  return Object.entries(reason)
    .filter(([k]) => !SKIP.has(k))
    .map(([k, v]) => ({ key: k, value: Array.isArray(v) ? v.join(', ') : String(v) }));
}

/**
 * Determine whether a message folder is a configured review folder.
 *
 * Checks the folder id against the stored reviewFolders map for the account.
 * Falls back to matching the default folder name "Auth Review" when no
 * reviewFolders entry exists for the account, so messages in manually-named
 * folders are still recognised even before the background has stored the id.
 *
 * @param {object|null|undefined} folder - Thunderbird folder object ({ id, accountId, name })
 * @param {object|null|undefined} settings - Add-on settings (settings.reviewFolders map)
 * @returns {boolean}
 */
export function isInReviewFolder(folder, settings) {
  if (!folder) return false;
  const configuredId = settings?.reviewFolders?.[folder.accountId];
  if (configuredId) return configuredId === folder.id;
  return (folder.name ?? '') === 'Auth Review';
}

/**
 * Return the most significant score reasons for the compact summary view.
 *
 * Selects up to `limit` reasons sorted by descending absolute delta,
 * excluding reasons with a zero delta (diagnostic-only entries).
 *
 * @param {Array} scoreReasons - Full array of score reason objects.
 * @param {number} [limit=3] - Maximum number of reasons to return.
 * @returns {Array}
 */
export function primaryReasons(scoreReasons, limit = 3) {
  if (!Array.isArray(scoreReasons)) return [];
  return [...scoreReasons]
    .filter(r => typeof r.delta === 'number' && r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

/**
 * Derive key protective/non-match facts for the "Protective factors" popup section.
 *
 * Returns an array of fact objects. Each has a `factKey` discriminator plus
 * type-specific fields:
 *
 *   { factKey: 'mitigation', scoreKey: string, delta: number }
 *     A named mitigation rule that reduced the score.
 *
 *   { factKey: 'dkimAligned' }
 *     A DKIM signature is aligned with the From domain — a structural gate
 *     that prevents several high-score composite rules from firing.
 *
 *   { factKey: 'noTrustedAuth' }
 *     No trusted Authentication-Results header was present, so authentication
 *     layer scoring contributed zero.
 *
 *   { factKey: 'belowThreshold', score: number, threshold: number, thresholdName: string }
 *     The total score remained below a named classification threshold.
 *     Only emitted when score > 0 (score 0 is trivially safe).
 *
 * Facts are ordered: mitigations first, then structural facts, then threshold.
 *
 * @param {object} entry - Decision log entry.
 * @param {object} [options]
 * @param {number} [options.reviewThreshold=50]    - Score at which Review begins.
 * @param {number} [options.highRiskThreshold=100] - Score at which High-risk begins.
 * @returns {Array<object>}
 */
export function buildProtectiveFacts(entry, { reviewThreshold = 50, highRiskThreshold = 100 } = {}) {
  if (!entry || typeof entry !== 'object') return [];
  const facts = [];
  const scoreReasons = Array.isArray(entry.scoreReasons) ? entry.scoreReasons : [];
  const alignmentMetrics =
    entry.alignmentMetrics != null && typeof entry.alignmentMetrics === 'object'
      ? entry.alignmentMetrics
      : {};
  const score = typeof entry.score === 'number' ? entry.score : null;

  // 1. Named mitigation rules that fired (negative delta, original order)
  for (const reason of scoreReasons) {
    if (typeof reason.delta === 'number' && reason.delta < 0) {
      facts.push({ factKey: 'mitigation', scoreKey: reason.key, delta: reason.delta });
    }
  }

  // 2. DKIM aligned with From — only informative when risk signals are also present
  const hasRiskReasons = scoreReasons.some(r => typeof r.delta === 'number' && r.delta > 0);
  if (alignmentMetrics.anyDkimAligned === true && hasRiskReasons) {
    facts.push({ factKey: 'dkimAligned' });
  }

  // 3. No trusted Authentication-Results were available.
  //    Detected when authserv.untrusted appears and no auth.* scored reasons appear.
  const hasUntrustedEntry = scoreReasons.some(r => r.key === 'authserv.untrusted');
  const hasAuthEntry = scoreReasons.some(
    r => typeof r.key === 'string' && r.key.startsWith('auth.'),
  );
  if (hasUntrustedEntry && !hasAuthEntry) {
    facts.push({ factKey: 'noTrustedAuth' });
  }

  // 4. Score remained below the nearest higher classification threshold.
  //    Skipped when score is 0 (no risk signals; trivially safe).
  if (score !== null && score > 0) {
    if (score < reviewThreshold) {
      facts.push({
        factKey: 'belowThreshold',
        score,
        threshold: reviewThreshold,
        thresholdName: 'Review',
      });
    } else if (score < highRiskThreshold) {
      facts.push({
        factKey: 'belowThreshold',
        score,
        threshold: highRiskThreshold,
        thresholdName: 'High-risk',
      });
    }
  }

  return facts;
}

/**
 * Build a manual whitelist entry object from an email address.
 *
 * Returns null when the address is absent or not a valid `local@domain` form.
 *
 * @param {string|null|undefined} emailAddress - Full email address (may already be lowercase)
 * @returns {{ value: string, matchType: 'exact' }|null}
 */
export function buildWhitelistEntry(emailAddress) {
  if (!emailAddress || typeof emailAddress !== 'string') return null;
  const normalized = emailAddress.trim().toLowerCase();
  if (!normalized.includes('@')) return null;
  return { value: normalized, matchType: 'exact' };
}
