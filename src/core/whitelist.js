export const DEFAULT_WHITELIST_MITIGATION = -50;
export const DEFAULT_ADDRESS_BOOK_MITIGATION = -50;
export const MAX_WHITELIST_ENTRIES = 100;

/**
 * Returns true when senderAddress matches a whitelist entry.
 * Only 'exact' matchType is supported.
 *
 * @param {string} senderAddress - Normalized full email address (localpart@domain, lowercase).
 * @param {{ value: string, matchType: string }} entry
 */
export function matchesWhitelistEntry(senderAddress, entry) {
  if (entry.matchType === 'exact') {
    return senderAddress.toLowerCase() === entry.value.toLowerCase();
  }
  return false;
}

/**
 * Apply address-book whitelist mitigation.
 *
 * Returns { score, scoreReasons }. When isInAddressBook is true a single reason
 * with key 'whitelist.addressBook' and the configured negative delta is added.
 *
 * @param {object} opts
 * @param {boolean} opts.isInAddressBook      - True when the sender was found in the user's address books.
 * @param {number}  [opts.mitigationScore]    - Negative delta; default DEFAULT_ADDRESS_BOOK_MITIGATION
 */
export function applyAddressBookWhitelist({
  isInAddressBook,
  mitigationScore = DEFAULT_ADDRESS_BOOK_MITIGATION,
}) {
  if (!isInAddressBook) {
    return { score: 0, scoreReasons: [] };
  }
  return {
    score: mitigationScore,
    scoreReasons: [{
      key: 'whitelist.addressBook',
      label: 'Address book contact',
      delta: mitigationScore,
    }],
  };
}

/**
 * Apply manual whitelist entries to produce a score mitigation.
 *
 * Returns { score, scoreReasons }. When a matching entry is found, a single
 * reason with key 'whitelist.manual' and the configured negative delta is
 * added. Only the first match fires; remaining entries are not evaluated.
 *
 * The mitigation reduces the computed score but does not bypass classification.
 * A whitelisted message can still be classified as review or high-risk if
 * L1-L4 scores are high enough.
 *
 * @param {object} opts
 * @param {string} opts.senderAddress      - Normalized full address (localpart@domain)
 * @param {Array}  opts.whitelistEntries   - [{ value, matchType }]
 * @param {number} [opts.mitigationScore]  - Negative delta; default DEFAULT_WHITELIST_MITIGATION
 */
export function applyManualWhitelist({
  senderAddress,
  whitelistEntries,
  mitigationScore = DEFAULT_WHITELIST_MITIGATION,
}) {
  for (const entry of whitelistEntries) {
    if (matchesWhitelistEntry(senderAddress, entry)) {
      return {
        score: mitigationScore,
        scoreReasons: [{
          key: 'whitelist.manual',
          label: 'Manual whitelist',
          delta: mitigationScore,
          matchedValue: entry.value,
          matchType: entry.matchType,
        }],
      };
    }
  }
  return { score: 0, scoreReasons: [] };
}
