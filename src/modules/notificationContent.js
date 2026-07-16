import { getMessage } from './i18n.js';

/**
 * Pure helper for building notification title/message from message metadata.
 * All inputs are optional; missing values are handled gracefully.
 *
 * @param {object} params
 * @param {string|null} [params.folderName]    - Destination folder name.
 * @param {string|null} [params.accountName]   - Account display name.
 * @param {string|null} [params.accountEmail]  - Receiving account identity email (preferred for title).
 * @param {string|null} [params.rawFrom]       - Raw RFC5322 From header value.
 * @param {string|null} [params.subject]       - Message subject.
 * @param {string|null} [params.snippet]       - Plain-text body snippet.
 * @param {number}      [params.count=1]       - Total eligible message count.
 * @returns {{ title: string, message: string }}
 */
export function buildNotificationContent({
  folderName = null,
  accountName = null,
  accountEmail = null,
  rawFrom = null,
  subject = null,
  snippet = null,
  count = 1,
} = {}) {
  let title;
  if (count === 1) {
    const email = accountEmail?.trim();
    if (email) {
      title = getMessage('notification_single_account', [email]);
    } else {
      const id = accountName?.trim() || folderName?.trim() || 'Inbox';
      title = getMessage('notification_single_fallback', [id]);
    }
  } else {
    title = getMessage('notification_multi_title');
  }

  const lines = [];
  if (count > 1) {
    lines.push(getMessage('notification_multi_body', [String(count)]));
  }

  if (rawFrom?.trim()) lines.push(rawFrom.trim());
  lines.push(subject?.trim() || getMessage('notification_no_subject'));

  const extra = count - 1;
  if (extra > 0) {
    lines.push(getMessage('notification_more_messages', [String(extra)]));
  } else if (snippet?.trim()) {
    lines.push(snippet.trim());
  }

  return { title, message: lines.join('\n') };
}
