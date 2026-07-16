import { isTrustedAuthservId } from '../core/trust.js';
import { extractRegistrableDomain } from '../core/psl.js';
import { getDomainParts } from '../core/domainParts.js';
import { scoreMessage } from '../core/scoring.js';
import { computeHeuristicMetrics } from '../core/heuristics.js';
import { computeDisplayNameMetrics } from '../core/displayNameMetrics.js';
import { computeAlignmentMetrics, computePassAlignmentSummary } from '../core/alignment.js';
import { extractMessageIdentity, parseMailboxAddress, parseFromHeader, parseMessageIdDomain } from '../core/messageIdentity.js';
import { analyzeMailAuthSignals, adaptAuthResults, adaptCompositeSignals } from '../modules/mailAuthSignalAdapter.js';
import { computeMessageIdMetrics } from '../core/compositeRules.js';
import { extractBodySnippet } from '../modules/bodySnippet.js';
import { buildNotificationContent } from '../modules/notificationContent.js';
import { computeHeaderMetrics } from '../core/headerMetrics.js';
import { prunedCandidates } from '../modules/candidates.js';
import { getStorage, saveStorage } from '../modules/storage.js';
import {
  shouldNotifyAfterAssessment,
  shouldShowImmediately,
  addToNotifQueue,
  isJunkLikeFolderType,
} from '../modules/notificationPolicy.js';
import { scheduleNotificationCandidate } from '../modules/notificationScheduler.js';

const MAX_LOG_ENTRIES = 1000;

// Serializes decision log writes so concurrent handleNewMessage() calls do not
// overwrite each other's entries.
let storageWriteQueue = Promise.resolve();

// ── Notification click-to-open ────────────────────────────────────────────────
//
// Each add-on notification gets a unique string ID so we can map it back to the
// Thunderbird message ID when the user clicks. The map is kept small (≤ 50
// entries) to avoid unbounded memory growth; oldest entry is evicted first.
//
// browser.messageDisplay.open({ messageId }) is available in Thunderbird 96+,
// which is within our strict_min_version of 102.

const MAX_PENDING_NOTIFICATIONS = 50;
const pendingNotifications = new Map(); // notificationId → Thunderbird message.id
let notifCounter = 0;

// ── Notification pacing ───────────────────────────────────────────────────────
//
// Notifications are shown no faster than settings.notificationMinIntervalMs.
// Queued notifications are capped at MAX_NOTIF_QUEUE; the oldest is dropped
// when the cap is exceeded.

const MAX_NOTIF_QUEUE = 5;
let notifLastShownAt = 0;
let notifPendingQueue = []; // [{ notifId, meta, minIntervalMs, msgId, checkEligibility }]
let notifDrainTimer = null;
let notifDrainActive = false;

function _doShowNotification(notifId, opts, msgId) {
  notifLastShownAt = Date.now();
  pendingNotifications.set(notifId, msgId);
  if (pendingNotifications.size > MAX_PENDING_NOTIFICATIONS) {
    pendingNotifications.delete(pendingNotifications.keys().next().value);
  }
  browser.notifications.create(notifId, opts).catch(() => {
    pendingNotifications.delete(notifId);
  });
}

async function drainNotifQueue() {
  notifDrainTimer = null;
  if (notifPendingQueue.length === 0) return;
  const entry = notifPendingQueue.shift();
  notifDrainActive = true;
  try {
    let eligible = false;
    try {
      eligible = await entry.checkEligibility(entry.msgId);
    } catch {
      // Treat any error as ineligible — do not notify.
    }

    if (eligible) {
      // Coalesce same-folder entries held in the pacing queue.
      const same = [];
      const rest = [];
      for (const q of notifPendingQueue) {
        if (q.meta?.folderName === entry.meta?.folderName &&
            q.meta?.accountName === entry.meta?.accountName) {
          same.push(q);
        } else {
          rest.push(q);
        }
      }
      notifPendingQueue = rest;

      let extraCount = 0;
      for (const q of same) {
        let ok = false;
        try { ok = await q.checkEligibility(q.msgId); } catch {}
        if (ok) extraCount++;
      }

      const count = 1 + extraCount;
      const opts = { type: 'basic', ...buildNotificationContent({ ...entry.meta, count }) };
      _doShowNotification(entry.notifId, opts, entry.msgId);
    }
  } finally {
    notifDrainActive = false;
  }
  if (notifPendingQueue.length > 0) {
    notifDrainTimer = setTimeout(drainNotifQueue, entry.minIntervalMs);
  }
}

function scheduleOrShowNotification(minIntervalMs, notifId, meta, msgId, checkEligibility) {
  const now = Date.now();
  if (shouldShowImmediately(notifLastShownAt, now, minIntervalMs)) {
    _doShowNotification(notifId, { type: 'basic', ...buildNotificationContent(meta) }, msgId);
  } else {
    notifPendingQueue = addToNotifQueue(
      notifPendingQueue,
      MAX_NOTIF_QUEUE,
      { notifId, meta, minIntervalMs, msgId, checkEligibility },
    );
    if (!notifDrainTimer && !notifDrainActive) {
      const delay = minIntervalMs - (now - notifLastShownAt);
      notifDrainTimer = setTimeout(drainNotifQueue, delay);
    }
  }
}

browser.notifications.onClicked.addListener(notifId => {
  const msgId = pendingNotifications.get(notifId);
  pendingNotifications.delete(notifId);
  browser.notifications.clear(notifId).catch(() => {});
  if (msgId == null) return;
  browser.messageDisplay.open({ messageId: msgId }).catch(() => {});
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  try {
    const accounts = await browser.accounts.list();
    for (const account of accounts) {
      await ensureReviewFolderForAccount(account.id);
    }
  } catch {
    // Ignore; lazy creation in applyAction will handle it.
  }
});

browser.messages.onNewMailReceived.addListener(async (folder, messages) => {
  for (const message of messages.messages) {
    await handleNewMessage(message).catch(console.error);
  }
});

async function handleNewMessage(message) {
  const full = await browser.messages.getFull(message.id);

  const data = await getStorage();
  const { trustedDomains, senderDomainRules, manualWhitelist, settings } = data;

  // Build trustedAuthservIds by extracting authserv-ids that actually appear in
  // Authentication-Results headers and testing each against the add-on's full trust
  // semantics. This covers matchType:'domain' entries (e.g. { value:'example.com',
  // matchType:'domain' }) whose subdomain authserv-ids (e.g. mx.example.com) would
  // otherwise fail the exact-only match used by mail-auth-signal internally.
  const rawAuthResultHeaders = [].concat(full.headers['authentication-results'] ?? []);
  const trustedAuthservIds = [...new Set(
    rawAuthResultHeaders
      .map(h => h.split(/[\s;]/)[0]?.toLowerCase())
      .filter(Boolean)
      .filter(id => isTrustedAuthservId(id, trustedDomains))
  )];

  const { metrics, signals } = analyzeMailAuthSignals({
    headers: full.headers,
    trustedAuthservIds,
    getRegistrableDomain: extractRegistrableDomain,
  });
  const parsed = adaptAuthResults(metrics.authenticationResults);

  const fromHeader = full.headers['from']?.[0] ?? '';
  const fromDomain = metrics.fromDomain ?? extractFromDomainFallback(fromHeader);
  // Use senderIdentity.localPart (populated by the package when fromDomain is extractable);
  // fall back to the local helper only when the package returned null (no domain path).
  // Lowercase to match the add-on's parseMailboxAddress convention used by the fallback.
  const fromLocalPart = (metrics.senderIdentity.localPart?.toLowerCase()) ?? extractFromLocalPart(fromHeader);
  const messageIdDomain = parseMessageIdDomain(full.headers['message-id']?.[0] ?? null);

  const headerMetrics = computeHeaderMetrics({
    headers: full.headers,
    fromDomain,
  });

  const senderAddress = fromLocalPart && fromDomain
    ? `${fromLocalPart.toLowerCase()}@${fromDomain.toLowerCase()}`
    : '';

  const isInAddressBook = settings.addressBookWhitelistEnabled && senderAddress
    ? await isEmailInAddressBook(senderAddress)
    : false;

  const accountDomains = await getAccountDomains(message.folder?.accountId);

  const fromParseMetrics = parseFromHeader(full.headers['from']?.[0] ?? null);

  const displayNameMetrics = computeDisplayNameMetrics({
    fromHeader: full.headers['from']?.[0] ?? null,
    fromDomain,
    fromAddress: fromParseMetrics.mailboxAddress ?? null,
  });

  const passAlignmentSummary = computePassAlignmentSummary({ parsedAuthResults: parsed, trustedDomains, fromDomain });

  const messageIdMetrics = computeMessageIdMetrics({
    messageIdDomain,
    fromDomain,
    anyAuthAligned: passAlignmentSummary.anyAuthAligned,
  });

  const mailAuthSignalReasons = adaptCompositeSignals(signals, settings.compositeScores, {
    addonAnyAuthAligned: passAlignmentSummary.anyAuthAligned,
    anyTrustedDmarcPass: passAlignmentSummary.anyTrustedDmarcPass,
  });

  const result = scoreMessage({
    parsedAuthResults: parsed,
    trustedDomains,
    senderDomain: fromDomain,
    senderLocalPart: fromLocalPart,
    messageIdDomain,
    senderDomainRules,
    authScores: settings.authScores,
    heuristicScores: settings.heuristicScores,
    layer2Scores: settings.layer2Scores,
    compositeScores: settings.compositeScores,
    alignmentSummary: passAlignmentSummary,
    whitelistEntries: manualWhitelist ?? [],
    whitelistMitigationScore: settings.whitelistMitigationScore,
    isInAddressBook,
    addressBookMitigationScore: settings.addressBookMitigationScore,
    headerMetrics,
    accountDomains,
    customFormulas: data.customFormulas ?? [],
    displayNameMetrics,
    messageIdMetrics,
    mailAuthSignalReasons,
  });

  const now = Date.now();

  const actionTaken = await applyAction(message, result, settings);

  // Notify for eligible messages if the user has enabled add-on notifications.
  // Eligibility uses shouldNotifyAfterAssessment (score threshold + enabled flag).
  // A configurable delay (notificationDelayMs, default 3000 ms) is applied so
  // that junk/spam classification by Thunderbird or other add-ons can settle
  // before the notification is shown.  After the delay, the message state is
  // re-checked; notifications for messages that became junk or moved to a
  // junk/spam/trash folder are suppressed.
  // Visible notifications are paced to no faster than notificationMinIntervalMs.
  // Failures are silently swallowed so they cannot interrupt scoring, movement,
  // candidate tracking, or decision logging.
  if (shouldNotifyAfterAssessment(settings, result)) {
    const rawFrom     = full.headers['from']?.[0]?.trim() || null;
    const subject     = message.subject?.trim()            || null;
    const snippet     = extractBodySnippet(full.parts);
    const folderName  = message.folder?.name ?? null;
    const acctName    = await getAccountName(message.folder?.accountId ?? null);
    const acctEmail   = await getAccountEmail(message.folder?.accountId ?? null);

    const meta = { folderName, accountName: acctName, accountEmail: acctEmail, rawFrom, subject, snippet };
    const notifId = `auth-filter-${++notifCounter}`;
    const minIntervalMs = settings.notificationMinIntervalMs ?? 4000;
    const delayMs = settings.notificationDelayMs ?? 3000;

    scheduleNotificationCandidate(
      { tbMessageId: message.id, notifId, opts: { type: 'basic', ...buildNotificationContent(meta) } },
      {
        delayMs,
        checkEligibility: checkMessageEligibilityAfterDelay,
        showNotification: (_nId, _opts, tbMsgId) =>
          scheduleOrShowNotification(minIntervalMs, notifId, meta, tbMsgId, checkMessageEligibilityAfterDelay),
      },
    );
  }

  const messageIdentity = extractMessageIdentity(message, full.headers);

  const heuristicMetrics = computeHeuristicMetrics({
    fromDomain,
    fromLocalPart,
  });

  const alignmentMetrics = computeAlignmentMetrics({
    parsedAuthResults: parsed,
    trustedDomains,
    fromDomain,
  });

  const entry = {
    timestamp: now,
    subject: message.subject ?? '',
    fromDomain,
    authservId: parsed[0]?.authservId ?? '',
    trusted: parsed.length > 0 ? isTrustedAuthservId(parsed[0].authservId, trustedDomains) : null,
    score: result.score,
    classification: result.classification,
    scoreReasons: result.scoreReasons,
    heuristicMetrics,
    displayNameMetrics,
    alignmentMetrics,
    messageIdMetrics,
    headerMetrics,
    fromParseMetrics,
    messageIdentity,
    senderIdentity: metrics.senderIdentity,
    action: actionTaken,
    formulaDiagnostics: result.formulaDiagnostics ?? [],
  };

  await enqueueLogWrite(entry);
}

function enqueueLogWrite(entry) {
  storageWriteQueue = storageWriteQueue.then(async () => {
    const fresh = await getStorage();
    const mergedCandidates = prunedCandidates(
      fresh.candidates.filter(c => !isTrustedAuthservId(c.authservId, fresh.trustedDomains)),
    );
    const mergedLog = [entry, ...fresh.decisionLog].slice(0, MAX_LOG_ENTRIES);
    await saveStorage({ ...fresh, candidates: mergedCandidates, decisionLog: mergedLog });
  }).catch(console.error);
  return storageWriteQueue;
}

/**
 * Choose exactly one destination for the message and return an action status
 * string that reflects what actually happened.
 *
 * High-risk + moveHighRiskToJunk → Junk only (Review is skipped).
 * Otherwise → per-account Review folder if configured.
 */
async function applyAction(message, result, settings) {
  if (result.classification === 'normal') return 'classified-normal';

  if (result.classification === 'high-risk' && settings.moveHighRiskToJunk) {
    try {
      const markOk = await moveToJunk(message);
      return markOk ? 'moved-junk' : 'moved-junk-mark-failed';
    } catch {
      return 'move-junk-failed';
    }
  }

  if (settings.moveToReview) {
    const accountId = message.folder?.accountId;
    if (!accountId) return 'no-review-folder-configured';
    const folderId = settings.reviewFolders?.[accountId] ??
      await ensureReviewFolderForAccount(accountId);
    if (!folderId) return 'no-review-folder-configured';
    try {
      await browser.messages.move([message.id], folderId);
      return 'moved-review';
    } catch {
      return 'move-review-failed';
    }
  }

  return `classified-${result.classification}`;
}

/** Returns true if the junk flag was set, false if marking failed (move still proceeds). */
async function moveToJunk(message) {
  const markOk = await browser.messages.update(message.id, { junk: true })
    .then(() => true, () => false);

  const accounts = await browser.accounts.list();
  for (const account of accounts) {
    if (account.id !== message.folder?.accountId) continue;
    const junk = findFolderByType(account.folders, 'junk');
    if (junk) {
      await browser.messages.move([message.id], junk.id);
      return markOk;
    }
  }
  throw new Error('junk folder not found');
}

/**
 * Find or create the "Auth Review" folder for a specific account and persist
 * its id in settings.reviewFolders[accountId].
 * Returns the folder id on success, null if unavailable.
 * Safe to call multiple times; exits early if already configured.
 */
async function ensureReviewFolderForAccount(accountId) {
  const data = await getStorage();
  if (data.settings.reviewFolders?.[accountId]) {
    return data.settings.reviewFolders[accountId];
  }

  try {
    const accounts = await browser.accounts.list();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return null;

    const inbox = findFolderByType(account.folders, 'inbox');
    if (!inbox) return null;

    const existing = inbox.subFolders?.find(f => f.name === 'Auth Review');
    const target = existing ?? await browser.folders.create(inbox, 'Auth Review');

    // Re-read to avoid overwriting concurrent changes.
    const latest = await getStorage();
    const reviewFolders = { ...(latest.settings.reviewFolders ?? {}), [accountId]: target.id };
    await saveStorage({ ...latest, settings: { ...latest.settings, reviewFolders } });
    return target.id;
  } catch {
    return null;
  }
}

function findFolderByType(folders, type) {
  for (const f of folders) {
    if (f.type === type) return f;
    if (f.subFolders?.length) {
      const found = findFolderByType(f.subFolders, type);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns true when emailAddress is found in the user's Thunderbird address books.
 * Matches only exact RFC5322 address comparisons, not display names.
 * Enumerates each address book individually to avoid NS_ERROR_FAILURE from
 * mailing-list nodes when searching with a null address book ID.
 * Returns false on any API error so scoring is never blocked by address-book failures.
 */
async function isEmailInAddressBook(emailAddress) {
  try {
    const lower = emailAddress.toLowerCase();
    let books;
    try {
      books = await browser.addressBooks.list();
    } catch {
      return false;
    }
    for (const book of books) {
      if (!book.id) continue;
      let contacts;
      try {
        contacts = await browser.contacts.quickSearch(book.id, lower);
      } catch {
        continue;
      }
      if (contacts.some(c => {
        if (c.type && c.type !== 'contact') return false;
        const p = c.properties ?? {};
        const primary = (p.PrimaryEmail ?? '').toLowerCase();
        const secondary = (p.SecondEmail ?? '').toLowerCase();
        return primary === lower || secondary === lower;
      })) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Re-check whether a message is still eligible for notification after the
 * delay has elapsed.  Suppresses notification when the message is now marked
 * as junk or has been moved into a junk, spam, or trash folder.
 * Returns false on any API error so a stale or deleted message never notifies.
 *
 * @param {number} tbMessageId - Thunderbird message.id.
 * @returns {Promise<boolean>}
 */
async function checkMessageEligibilityAfterDelay(tbMessageId) {
  try {
    const msg = await browser.messages.get(tbMessageId);
    if (!msg) return false;
    if (msg.junk) return false;
    if (isJunkLikeFolderType(msg.folder?.type ?? '')) return false;
    return true;
  } catch {
    return false;
  }
}

// Used when mail-auth-signal cannot extract a domain (e.g. single-label hosts such
// as 'user@localhost' where normalizeDomain requires a dot).
function extractFromDomainFallback(fromHeader) {
  const addr = parseMailboxAddress(fromHeader);
  return addr.split('@')[1] ?? '';
}

function extractFromLocalPart(fromHeader) {
  const addr = parseMailboxAddress(fromHeader);
  return addr.split('@')[0] ?? '';
}

/**
 * Returns the display name of an account, or null when unavailable.
 * Failures are silently swallowed.
 */
async function getAccountName(accountId) {
  if (!accountId) return null;
  try {
    const account = await browser.accounts.get(accountId);
    return account?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the email address of the first identity for an account, or null when unavailable.
 * Used to prefer account email over display name in notification titles.
 */
async function getAccountEmail(accountId) {
  if (!accountId) return null;
  try {
    const account = await browser.accounts.get(accountId);
    return account?.identities?.[0]?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the unique PSL registrable domains for all identities of an account.
 * Returns an empty array when the account is unavailable or has no parseable email domains.
 * Failures are silently swallowed so scoring is never blocked.
 */
async function getAccountDomains(accountId) {
  if (!accountId) return [];
  try {
    const account = await browser.accounts.get(accountId);
    const identities = account?.identities ?? [];
    const domains = new Set();
    for (const identity of identities) {
      const email = identity.email ?? '';
      const atIdx = email.indexOf('@');
      if (atIdx < 0) continue;
      const rd = getDomainParts(email.slice(atIdx + 1).toLowerCase()).registrableDomain;
      if (rd) domains.add(rd);
    }
    return [...domains];
  } catch {
    return [];
  }
}

