/**
 * Pure helpers for add-on notification eligibility and pacing.
 * All functions are side-effect-free so they can be unit-tested without browser APIs.
 */

/**
 * Return true when a Thunderbird folder type string represents a junk, spam,
 * or trash folder.  Used to suppress delayed notifications for messages that
 * were moved into these folders before the delay expired.
 *
 * @param {string} folderType - Value of message.folder.type from the Thunderbird API.
 * @returns {boolean}
 */
export function isJunkLikeFolderType(folderType) {
  return folderType === 'junk' || folderType === 'trash' || folderType === 'spam';
}

/**
 * Decide whether a message result should produce an add-on notification.
 *
 * @param {object} settings - Stored settings (notifyAfterAssessment, notificationMaxScore).
 * @param {object} result   - Score result object ({ score, classification, … }).
 * @returns {boolean}
 */
export function shouldNotifyAfterAssessment(settings, result) {
  if (!settings.notifyAfterAssessment) return false;
  const maxScore = settings.notificationMaxScore ?? 49;
  return result.score <= maxScore;
}

/**
 * Return true when enough time has elapsed to show the next notification immediately.
 *
 * @param {number} lastShownAt   - Timestamp (ms) when the last notification was shown, or 0.
 * @param {number} now           - Current timestamp (ms).
 * @param {number} minIntervalMs - Minimum interval between notifications (ms).
 * @returns {boolean}
 */
export function shouldShowImmediately(lastShownAt, now, minIntervalMs) {
  return now - lastShownAt >= minIntervalMs;
}

/**
 * Add an entry to the notification queue, dropping the oldest entry when the
 * queue exceeds maxSize.  Returns the new queue without mutating the original.
 *
 * @param {Array}  queue   - Current queue.
 * @param {number} maxSize - Maximum allowed queue length.
 * @param {*}      entry   - Entry to append.
 * @returns {Array}
 */
export function addToNotifQueue(queue, maxSize, entry) {
  const next = [...queue, entry];
  if (next.length > maxSize) next.shift();
  return next;
}
