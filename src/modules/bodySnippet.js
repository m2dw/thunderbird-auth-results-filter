/**
 * Plain-text body snippet extractor for Thunderbird MIME part trees.
 *
 * Used by background.js to obtain a short preview for new-mail notifications.
 * Extracted as a module so the same implementation can be tested directly.
 */

/**
 * Recursively scan the MIME part tree from browser.messages.getFull() and
 * return a short normalised plain-text snippet.
 *
 * Prefers text/plain; skips text/html to avoid raw markup in notifications.
 * Content-Type comparison is case-insensitive (MIME spec requirement).
 * Returns null when no usable content is found.
 *
 * Compatible with Thunderbird 102+ (no getFull options required).
 *
 * @param {Array}  parts            - MessagePart array (may be undefined/null).
 * @param {number} [maxLength=160]
 * @returns {string|null}
 */
export function extractBodySnippet(parts, maxLength = 160) {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part) continue;
    // Normalise to lowercase; MIME Content-Type is case-insensitive.
    const ct = String(part.contentType ?? '').toLowerCase();
    if (ct.startsWith('text/plain') && part.body) {
      const normalized = part.body.replace(/\s+/g, ' ').trim();
      if (normalized) {
        return normalized.length > maxLength
          ? normalized.slice(0, maxLength) + '…' // …
          : normalized;
      }
    }
    // Recurse into multipart containers (multipart/alternative, multipart/mixed, …).
    const nested = extractBodySnippet(part.parts, maxLength);
    if (nested) return nested;
  }
  return null;
}
