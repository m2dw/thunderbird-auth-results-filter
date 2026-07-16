/**
 * Log export helpers.
 *
 * Pure functions used by the options page to build the JSON export payload.
 * No browser APIs are used here so these functions are fully unit-testable.
 */

/**
 * Strip angle brackets from a Message-ID value if present.
 * "<abc@example.com>" → "abc@example.com"
 * "abc@example.com"   → "abc@example.com"
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeRfcMessageId(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Build the ordered list of headerMessageId query values to try.
 * Returns the raw stored value and the angle-bracket-stripped form,
 * deduplicated (so if the raw value has no brackets, only one entry).
 *
 * @param {string} value - Stored rfcMessageId value.
 * @returns {string[]}
 */
export function buildHeaderMessageIdQueryValues(value) {
  if (typeof value !== 'string' || !value) return [];
  const raw = value.trim();
  if (!raw) return [];
  const normalized = normalizeRfcMessageId(raw);
  return raw === normalized ? [raw] : [raw, normalized];
}

/**
 * Choose the best match from a deduplicated list of Thunderbird message objects.
 * Prefers a message whose folder.accountId matches initialAccountId.
 * Falls back to the first message when no account match is found.
 *
 * @param {object[]}    messages          - Flat, deduplicated message list.
 * @param {string|null} initialAccountId  - Preferred account ID (may be null).
 * @returns {object|null}
 */
export function chooseBestMessageQueryResult(messages, initialAccountId) {
  if (!messages || messages.length === 0) return null;
  if (initialAccountId) {
    const preferred = messages.find(m => m.folder?.accountId === initialAccountId);
    if (preferred) return preferred;
  }
  return messages[0];
}

/**
 * Derive an export verdict from a Thunderbird folder object and junk flag.
 *
 * Verdict rules (evaluated in order):
 *   1. junk === true                             → 'spam'
 *   2. folder.id is in reviewFolderIds           → 'undecided'
 *      (covers user-configured review folders regardless of display name)
 *   3. folder.name === 'Auth Review'             → 'undecided'
 *      (fallback for the default folder created by the add-on, or
 *       legacy entries whose folder ID is not in the current settings)
 *   4. folder.type === 'junk'                   → 'spam'
 *      (compatibility fallback when junk flag is unavailable)
 *   5. any other found folder                    → 'ham'
 *   6. null / no folder                          → 'unknown'
 *
 * @param {object|null} folder
 * @param {Set<string>} [reviewFolderIds] - Set of configured review folder IDs
 *   from settings.reviewFolders (all accounts). Defaults to empty set.
 * @param {boolean|null} [junk] - Thunderbird junk flag from the message object.
 *   true = marked as junk, false = not junk, null = unavailable.
 * @returns {'spam'|'undecided'|'ham'|'unknown'}
 */
export function deriveExportVerdict(folder, reviewFolderIds = new Set(), junk = null) {
  if (junk === true) return 'spam';
  if (!folder) return 'unknown';
  if (folder.id && reviewFolderIds.has(folder.id)) return 'undecided';
  if (folder.name === 'Auth Review') return 'undecided';
  if (folder.type === 'junk') return 'spam';
  return 'ham';
}

/**
 * Build an exportState object for entries that could not be resolved.
 *
 * @param {'no_message_id'|'not_found'|'not_found_by_message_id'|'lookup_error'} [reason]
 * @returns {{ found: false, exportVerdict: 'unknown', reason: string }}
 */
export function buildUnknownExportState(reason = 'not_found') {
  return { found: false, exportVerdict: 'unknown', reason };
}

/**
 * Build the top-level JSON export payload.
 *
 * @param {object}   data                   - Raw storage data (for settings).
 * @param {Array}    entriesWithExportState  - Log entries already annotated with exportState.
 * @param {string}   addonVersion            - Add-on version string from the manifest.
 * @returns {object}
 */
export function buildExportPayload(data, entriesWithExportState, addonVersion) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    addonVersion,
    settings: data.settings ?? {},
    decisionLog: entriesWithExportState,
  };
}
