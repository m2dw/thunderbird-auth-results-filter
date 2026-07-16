/**
 * Manages delayed notification display for assessed messages.
 *
 * Notifications are held for a configurable delay so that junk/spam
 * classification by Thunderbird or other add-ons can settle before a
 * notification is shown. Each Thunderbird message ID is tracked so that
 * duplicate scheduling during the delay window produces only one notification.
 */

// tbMessageId → timerId for all currently pending candidates.
const pendingCandidates = new Map();

/**
 * Schedule a notification candidate for delayed display.
 *
 * If a candidate for the same tbMessageId is already pending, this call is
 * silently ignored — no duplicate notification is produced.
 *
 * After delayMs milliseconds, checkEligibility(tbMessageId) is awaited.
 * If it resolves to true, showNotification(notifId, opts, tbMessageId) is
 * called. In either case the candidate is removed from the pending set.
 *
 * @param {object} candidate
 * @param {number} candidate.tbMessageId   - Thunderbird message.id (numeric).
 * @param {string} candidate.notifId       - Unique notification string ID.
 * @param {object} candidate.opts          - browser.notifications.create options.
 * @param {object} deps
 * @param {number}   deps.delayMs           - ms to wait before the eligibility re-check.
 * @param {Function} deps.checkEligibility  - async (tbMessageId) → boolean.
 * @param {Function} deps.showNotification  - (notifId, opts, tbMessageId) → void.
 * @param {Function} [deps.schedule]        - (fn, ms) → timerId (default: setTimeout).
 * @param {Function} [deps.cancel]          - (timerId) → void (default: clearTimeout).
 */
export function scheduleNotificationCandidate(candidate, deps) {
  const { tbMessageId, notifId, opts } = candidate;
  const {
    delayMs,
    checkEligibility,
    showNotification,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = deps;

  if (pendingCandidates.has(tbMessageId)) return;

  const timerId = schedule(async () => {
    pendingCandidates.delete(tbMessageId);
    let eligible = false;
    try {
      eligible = await checkEligibility(tbMessageId);
    } catch {
      // Treat any error as ineligible — do not notify.
    }
    if (eligible) {
      showNotification(notifId, opts, tbMessageId);
    }
  }, delayMs);

  pendingCandidates.set(tbMessageId, timerId);
}

/**
 * Cancel a pending delayed notification candidate.
 * No-op if no candidate is pending for the given tbMessageId.
 *
 * @param {number}   tbMessageId - Thunderbird message.id.
 * @param {Function} [cancel]    - (timerId) → void (default: clearTimeout).
 */
export function cancelNotification(tbMessageId, cancel = clearTimeout) {
  const timerId = pendingCandidates.get(tbMessageId);
  if (timerId == null) return;
  cancel(timerId);
  pendingCandidates.delete(tbMessageId);
}

/**
 * Number of currently pending notification candidates.
 * Exposed for testing; not part of the production API.
 *
 * @returns {number}
 */
export function pendingCount() {
  return pendingCandidates.size;
}

/**
 * Clear all pending candidates without firing them.
 * Intended only for test isolation — do not call in production code.
 *
 * @param {Function} [cancel] - (timerId) → void (default: clearTimeout).
 */
export function _resetForTests(cancel = clearTimeout) {
  for (const timerId of pendingCandidates.values()) {
    cancel(timerId);
  }
  pendingCandidates.clear();
}
