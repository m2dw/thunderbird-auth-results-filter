import { getStorage, updateStorage } from '../modules/storage.js';
import { findLogEntryByRfcMessageId, reasonContextPairs, isInReviewFolder, buildWhitelistEntry, primaryReasons, buildProtectiveFacts } from '../modules/popupHelpers.js';
import { formatDelta } from '../modules/logFormat.js';
import { parseMailboxAddress } from '../core/messageIdentity.js';
import { MAX_WHITELIST_ENTRIES } from '../core/whitelist.js';
import {
  getMessage,
  localizeDocument,
  localizedActionLabel,
  localizedClassification,
  localizedReasonLabel,
  localizedSummaryForKey,
  localizedTitleForKey,
} from '../modules/i18n.js';
import { deriveAccountProtectionStatus, PROTECTION_STATES } from '../modules/protectionStatus.js';

localizeDocument();

async function init() {
  const content = document.getElementById('content');

  let message = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      try {
        message = await browser.messageDisplay.getDisplayedMessage(tab.id);
        if (message) break;
      } catch {
        // Tab may not support messageDisplay; try the next.
      }
    }
  } catch {
    // Ignore; fall through to "no message" state.
  }

  if (!message) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'no-message';
    p.textContent = getMessage('popup_no_message');
    content.appendChild(p);
    return;
  }

  // Retrieve the RFC Message-ID from full message headers.
  let rfcMessageId = null;
  try {
    const full = await browser.messages.getFull(message.id);
    rfcMessageId = full.headers['message-id']?.[0]?.trim() ?? null;
  } catch {
    // Cannot retrieve headers; matching will fall through to not-found state.
  }

  const data = await getStorage();
  const entry = findLogEntryByRfcMessageId(data.decisionLog, rfcMessageId);
  const inReviewFolder = isInReviewFolder(message.folder, data.settings);
  const senderAddress = parseMailboxAddress(message.author ?? '');

  if (!entry) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'no-entry';
    p.textContent = getMessage('popup_no_entry');
    content.appendChild(p);
    renderActionsPanel(content, { inReviewFolder, message, senderAddress, data });
    prependProtectionNotice(content, message, data);
    return;
  }

  renderEntry(content, entry, { inReviewFolder, message, senderAddress, data });
  prependProtectionNotice(content, message, data);
}

/**
 * Show a one-line notice when authentication scoring is not active for the
 * displayed message's account. Nothing is shown when it is active.
 */
function prependProtectionNotice(container, message, data) {
  const accountId = message?.folder?.accountId;
  if (!accountId) return;
  const status = deriveAccountProtectionStatus({
    accountId,
    trustedDomains: data.trustedDomains,
    accountSetup: data.settings?.accountSetup,
    decisionLog: data.decisionLog,
  });
  if (status.state === PROTECTION_STATES.ACTIVE) return;

  const notice = document.createElement('div');
  notice.className = 'protection-notice';
  const text = document.createElement('span');
  text.textContent = getMessage('popup_status_inactive');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'protection-notice-btn';
  btn.textContent = getMessage('popup_btn_open_setup');
  btn.addEventListener('click', () => {
    // '#setup' makes the options page open the guided setup on load.
    browser.tabs.create({ url: browser.runtime.getURL('options/options.html#setup') });
  });
  notice.append(text, ' ', btn);
  container.prepend(notice);
}

function renderEntry(container, entry, context = {}) {
  container.innerHTML = '';

  // 1. Compact summary: classification, score, action taken
  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'summary-panel';

  const classEl = document.createElement('span');
  classEl.className = `classification ${entry.classification ?? ''}`;
  classEl.textContent = localizedClassification(entry.classification);
  summaryPanel.appendChild(classEl);

  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'score-badge';
  scoreBadge.textContent = getMessage('popup_score', [String(entry.score ?? 0)]);
  summaryPanel.appendChild(scoreBadge);

  if (entry.action) {
    const actionEl = document.createElement('span');
    actionEl.className = 'action-label';
    actionEl.textContent = localizedActionLabel(entry.action);
    summaryPanel.appendChild(actionEl);
  }

  container.appendChild(summaryPanel);

  // 2. Primary reasons (top reasons by absolute delta, compact)
  const topReasons = primaryReasons(entry.scoreReasons ?? []);
  if (topReasons.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'primary-reasons';
    for (const reason of topReasons) {
      const li = document.createElement('li');
      li.className = 'primary-reason-item';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'reason-label';
      labelSpan.textContent = localizedReasonLabel(reason);
      const primaryTooltip = localizedSummaryForKey(reason.key);
      if (primaryTooltip) labelSpan.title = primaryTooltip;

      const deltaSpan = document.createElement('span');
      deltaSpan.className = `reason-delta ${deltaClass(reason.delta)}`;
      deltaSpan.textContent = formatDelta(reason.delta);

      li.appendChild(labelSpan);
      li.appendChild(deltaSpan);
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // 3. Protective factors ("Why not higher risk?" section)
  const protectiveFacts = buildProtectiveFacts(entry);
  if (protectiveFacts.length > 0) {
    const pfSection = document.createElement('div');
    pfSection.className = 'protective-facts';

    const pfHeading = document.createElement('p');
    pfHeading.className = 'protective-facts-heading';
    pfHeading.textContent = getMessage('popup_protective_factors');
    pfSection.appendChild(pfHeading);

    const pfList = document.createElement('ul');
    pfList.className = 'protective-facts-list';

    for (const fact of protectiveFacts) {
      const li = document.createElement('li');
      li.className = 'protective-fact-item';

      if (fact.factKey === 'mitigation') {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'protective-fact-name';
        nameSpan.textContent = localizedTitleForKey(fact.scoreKey);
        const tip = localizedSummaryForKey(fact.scoreKey);
        if (tip) nameSpan.title = tip;
        li.appendChild(nameSpan);
      } else if (fact.factKey === 'dkimAligned') {
        li.textContent = getMessage('popup_fact_dkim_aligned');
      } else if (fact.factKey === 'noTrustedAuth') {
        li.textContent = getMessage('popup_fact_no_trusted_auth');
      } else if (fact.factKey === 'belowThreshold') {
        const msgKey = fact.thresholdName === 'High-risk'
          ? 'popup_fact_below_high_risk'
          : 'popup_fact_below_review';
        li.textContent = getMessage(msgKey, [String(fact.score), String(fact.threshold)]);
      }

      pfList.appendChild(li);
    }

    pfSection.appendChild(pfList);
    container.appendChild(pfSection);
  }

  // 4. Actions panel (review actions + open options)
  renderActionsPanel(container, context);

  // 4. Collapsible details: identity + full score reasons
  const details = document.createElement('details');
  details.className = 'score-details';

  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = getMessage('popup_score_details');
  details.appendChild(detailsSummary);

  // Identity fields
  const id = entry.messageIdentity ?? {};
  const identityRows = [
    { label: getMessage('popup_identity_from'), value: id.from },
    { label: getMessage('popup_identity_subject'), value: id.subject },
    { label: getMessage('popup_identity_from_domain'), value: entry.fromDomain },
    { label: getMessage('popup_identity_message_id'), value: id.rfcMessageId },
  ];
  const hasIdentity = identityRows.some(r => r.value);
  if (hasIdentity) {
    const table = document.createElement('table');
    table.className = 'identity-table';
    for (const row of identityRows) {
      if (!row.value) continue;
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      tdLabel.textContent = row.label;
      const tdValue = document.createElement('td');
      tdValue.textContent = row.value;
      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      table.appendChild(tr);
    }
    details.appendChild(table);
  }

  // Full score reasons
  const reasons = entry.scoreReasons;
  if (Array.isArray(reasons) && reasons.length > 0) {
    const h3 = document.createElement('h3');
    h3.className = 'details-heading';
    h3.textContent = getMessage('popup_all_reasons');
    details.appendChild(h3);

    const ul = document.createElement('ul');
    ul.className = 'reason-list';

    for (const reason of reasons) {
      const li = document.createElement('li');
      li.className = 'reason-item';

      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'reason-summary';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'reason-label';
      labelSpan.textContent = localizedReasonLabel(reason);
      const reasonTooltip = localizedSummaryForKey(reason.key);
      if (reasonTooltip) labelSpan.title = reasonTooltip;
      summaryDiv.appendChild(labelSpan);

      const deltaSpan = document.createElement('span');
      deltaSpan.className = `reason-delta ${deltaClass(reason.delta)}`;
      deltaSpan.textContent = formatDelta(reason.delta);
      summaryDiv.appendChild(deltaSpan);

      li.appendChild(summaryDiv);

      const pairs = reasonContextPairs(reason);
      if (pairs.length > 0) {
        const dl = document.createElement('dl');
        dl.className = 'reason-context';
        for (const { key, value } of pairs) {
          const dt = document.createElement('dt');
          dt.textContent = key;
          const dd = document.createElement('dd');
          dd.textContent = value;
          dl.appendChild(dt);
          dl.appendChild(dd);
        }
        li.appendChild(dl);
      }

      ul.appendChild(li);
    }

    details.appendChild(ul);
  }

  container.appendChild(details);
}

/**
 * Render the actions panel with review actions (when in review folder) and an
 * Open Options link for deeper inspection.
 */
function renderActionsPanel(container, context) {
  const { inReviewFolder, message, senderAddress, data } = context;

  const panel = document.createElement('div');
  panel.className = 'actions-panel';

  const statusEl = document.createElement('p');
  statusEl.className = 'review-action-status';
  statusEl.hidden = true;
  panel.appendChild(statusEl);

  if (inReviewFolder && message) {
    // Move to Inbox button
    const moveBtn = document.createElement('button');
    moveBtn.className = 'review-action-btn';
    moveBtn.textContent = getMessage('btn_move_to_inbox');
    moveBtn.addEventListener('click', async () => {
      moveBtn.disabled = true;
      whitelistBtn.disabled = true;
      try {
        const inboxId = await findInboxId(message.folder?.accountId);
        if (!inboxId) {
          showStatus(statusEl, getMessage('popup_inbox_not_found'), 'error');
          moveBtn.disabled = false;
          whitelistBtn.disabled = false;
          return;
        }
        // Attempt to clear junk flag before moving; ignore errors.
        try { await browser.messages.update(message.id, { junk: false }); } catch { /* ignore */ }
        await browser.messages.move([message.id], inboxId);
        showStatus(statusEl, getMessage('popup_moved_to_inbox'), 'success');
      } catch {
        showStatus(statusEl, getMessage('popup_move_failed'), 'error');
        moveBtn.disabled = false;
        whitelistBtn.disabled = false;
      }
    });
    panel.appendChild(moveBtn);

    // Whitelist Sender button
    const whitelistBtn = document.createElement('button');
    whitelistBtn.className = 'review-action-btn';
    whitelistBtn.textContent = getMessage('btn_whitelist_sender');

    const whitelistEntry = buildWhitelistEntry(senderAddress);
    if (!whitelistEntry) {
      whitelistBtn.disabled = true;
      whitelistBtn.title = getMessage('popup_no_sender_address');
    } else {
      const existing = (data?.manualWhitelist ?? [])
        .some(e => e.matchType === 'exact' && e.value === whitelistEntry.value);

      if (existing) {
        whitelistBtn.disabled = true;
        whitelistBtn.title = getMessage('popup_already_whitelisted_title');
        whitelistBtn.textContent = getMessage('btn_already_whitelisted');
      } else {
        whitelistBtn.addEventListener('click', () => {
          renderWhitelistConfirm(panel, moveBtn, whitelistBtn, statusEl, whitelistEntry, data);
        });
      }
    }
    panel.appendChild(whitelistBtn);
  }

  // Open Options / Logs — always available for deeper inspection
  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'review-action-btn options-btn';
  optionsBtn.textContent = getMessage('btn_open_options');
  optionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
  panel.appendChild(optionsBtn);

  container.appendChild(panel);
}

/**
 * Replace the whitelist button with an inline confirmation row.
 */
function renderWhitelistConfirm(section, moveBtn, whitelistBtn, statusEl, entry, data) {
  whitelistBtn.hidden = true;

  const confirmDiv = document.createElement('div');
  confirmDiv.className = 'whitelist-confirm';

  const msg = document.createElement('p');
  msg.className = 'whitelist-confirm-msg';
  msg.textContent = getMessage('popup_whitelist_confirm', [entry.value]);
  confirmDiv.appendChild(msg);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'review-action-btn confirm-btn';
  confirmBtn.textContent = getMessage('btn_confirm');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    moveBtn.disabled = true;
    try {
      await updateStorage(d => {
        const current = d.manualWhitelist ?? [];
        const alreadyIn = current.some(e => e.matchType === 'exact' && e.value === entry.value);
        if (alreadyIn) return d;
        if (current.length >= MAX_WHITELIST_ENTRIES) throw new Error('full');
        return { ...d, manualWhitelist: [...current, entry] };
      });
      confirmDiv.remove();
      moveBtn.disabled = false;
      showStatus(statusEl, getMessage('popup_whitelist_added', [entry.value]), 'success');
    } catch (err) {
      const msg = err?.message === 'full'
        ? getMessage('popup_whitelist_full', [String(MAX_WHITELIST_ENTRIES)])
        : getMessage('popup_whitelist_save_failed');
      showStatus(statusEl, msg, 'error');
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      moveBtn.disabled = false;
    }
  });
  confirmDiv.appendChild(confirmBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'review-action-btn cancel-btn';
  cancelBtn.textContent = getMessage('btn_cancel');
  cancelBtn.addEventListener('click', () => {
    confirmDiv.remove();
    whitelistBtn.hidden = false;
  });
  confirmDiv.appendChild(cancelBtn);

  section.appendChild(confirmDiv);
}

function showStatus(el, text, type) {
  el.textContent = text;
  el.className = `review-action-status ${type}`;
  el.hidden = false;
}

/** Find the Inbox folder id for the given account. Returns null if not found. */
async function findInboxId(accountId) {
  if (!accountId) return null;
  try {
    const accounts = await browser.accounts.list();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return null;
    const inbox = findFolderByType(account.folders, 'inbox');
    return inbox?.id ?? null;
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

function updatePopupHeight() {
  const main = document.querySelector('main');
  if (!main) return;
  const h = Math.min(main.scrollHeight, 600);
  document.documentElement.style.setProperty('--popup-height', `${h}px`);
}

function deltaClass(delta) {
  if (delta > 0) return 'positive';
  if (delta < 0) return 'negative';
  return 'zero';
}

// toggle doesn't bubble, so use capture phase to catch <details> open/close
document.addEventListener('toggle', updatePopupHeight, true);

// Recalculate height after any action-panel mutation (status messages, confirm block, etc.)
const _mainEl = document.querySelector('main');
if (_mainEl) {
  new MutationObserver(updatePopupHeight).observe(_mainEl, { subtree: true, childList: true, attributes: true, characterData: true });
}

init().then(updatePopupHeight).catch(err => {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'no-entry';
    p.textContent = getMessage('popup_error', [err.message]);
    content.appendChild(p);
  }
});
