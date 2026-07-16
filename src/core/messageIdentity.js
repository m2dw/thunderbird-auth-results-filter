/**
 * Message identity extraction.
 *
 * Captures stable identity fields from a Thunderbird MessageHeader object and
 * its parsed full-message headers at receive time. The resulting object is
 * stored on each decision log entry to support future log export and
 * folder-lookup-based verdict derivation.
 *
 * This module contains only pure data-extraction logic so it can be tested
 * without Thunderbird browser APIs.
 */

/**
 * Parse the RFC5322 From header and return structured observability fields.
 *
 * Distinguishes four parse outcomes with a stable status string:
 *   - 'ok'        — a mailbox address with a domain was extracted successfully
 *   - 'missing'   — the From header was absent or empty
 *   - 'invalid'   — a header value was present but no mailbox address could be parsed
 *   - 'no_domain' — an address was parsed but contained no domain after '@'
 *
 * This function does not replace the existing extractFromDomain/extractFromLocalPart
 * helpers; it adds structured log data so callers can distinguish parse failures
 * from genuinely missing headers.
 *
 * @param {string|null|undefined} fromHeader - Raw value of the From header
 * @returns {{
 *   rawFrom: string|null,
 *   mailboxAddress: string|null,
 *   parseStatus: 'ok'|'missing'|'invalid'|'no_domain',
 *   fromDomain: string|null
 * }}
 */
export function parseFromHeader(fromHeader) {
  if (!fromHeader) {
    return { rawFrom: null, mailboxAddress: null, parseStatus: 'missing', fromDomain: null };
  }
  const rawFrom = fromHeader.slice(0, 200);
  const addr = parseMailboxAddress(fromHeader);
  if (!addr) {
    return { rawFrom, mailboxAddress: null, parseStatus: 'invalid', fromDomain: null };
  }
  const mailboxAddress = addr.slice(0, 200);
  const atIdx = addr.indexOf('@');
  const domain = atIdx >= 0 ? addr.slice(atIdx + 1) : '';
  if (!domain) {
    return { rawFrom, mailboxAddress, parseStatus: 'no_domain', fromDomain: null };
  }
  return { rawFrom, mailboxAddress, parseStatus: 'ok', fromDomain: domain.slice(0, 200) };
}

/**
 * Extract the domain from an RFC 2822 Message-ID header value.
 *
 * Message-ID format: <local-part@domain>
 *
 * Returns null for missing, empty, or malformed values (no angle brackets,
 * no '@', or empty domain portion).
 *
 * @param {string|null|undefined} messageIdHeader - Raw value of the message-id header
 * @returns {string|null} Lowercase domain, or null if missing/invalid
 */
export function parseMessageIdDomain(messageIdHeader) {
  if (!messageIdHeader) return null;
  const match = messageIdHeader.match(/<[^@>\s]+@([^>\s]+)>/);
  if (!match) return null;
  return match[1].toLowerCase() || null;
}

/**
 * Extract the actual mailbox address from an RFC5322 From header value.
 *
 * Angle-bracket form takes precedence over bare addresses so that a spoofed
 * display name like `"trusted@example.com" <attacker@evil.test>` resolves to
 * the real envelope address `attacker@evil.test`, not the display-name address.
 *
 * @param {string} fromHeader - Raw From header value (single address expected)
 * @returns {string} Lowercased email address, or empty string if not found
 */
export function parseMailboxAddress(fromHeader) {
  // name-addr: extract address from angle brackets
  const angleMatch = fromHeader.match(/<([^@<>\s]+@[^@<>\s>]+)>/);
  if (angleMatch) return angleMatch[1].toLowerCase();
  // addr-spec fallback: bare address
  const bareMatch = fromHeader.match(/([^\s"<>]+@[^\s"<>]+)/);
  return bareMatch ? bareMatch[1].toLowerCase() : '';
}

/**
 * Build a messageIdentity record from a Thunderbird message and its headers.
 *
 * All fields default to null if the source data is absent or undefined so
 * that callers never need to guard against missing properties.
 *
 * @param {object} message - Thunderbird MessageHeader (message.id, .subject, .folder, …)
 * @param {object} headers - Parsed header map from browser.messages.getFull().headers
 *                           Keys are lowercase; values are arrays of strings.
 * @returns {{
 *   thunderbirdMessageId: number|null,
 *   rfcMessageId:         string|null,
 *   initialAccountId:     string|null,
 *   initialFolderId:      string|null,
 *   initialFolderName:    string|null,
 *   initialFolderPath:    string|null,
 *   initialFolderType:    string|null,
 *   subject:              string|null,
 *   from:                 string|null,
 *   date:                 string|null
 * }}
 */
export function extractMessageIdentity(message, headers) {
  const folder = message?.folder ?? null;
  return {
    thunderbirdMessageId: message?.id ?? null,
    rfcMessageId:         headers?.['message-id']?.[0]?.trim() ?? null,
    initialAccountId:     folder?.accountId ?? null,
    initialFolderId:      folder?.id        ?? null,
    initialFolderName:    folder?.name      ?? null,
    initialFolderPath:    folder?.path      ?? null,
    initialFolderType:    folder?.type      ?? null,
    subject:              message?.subject  ?? null,
    from:                 headers?.['from']?.[0]  ?? null,
    date:                 headers?.['date']?.[0]  ?? null,
  };
}
