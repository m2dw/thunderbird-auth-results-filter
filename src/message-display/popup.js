import { getStorage, updateStorage } from '../modules/storage.js';
import { findLogEntryByRfcMessageId, reasonContextPairs, isInReviewFolder, buildWhitelistEntry, primaryReasons, buildProtectiveFacts } from '../modules/popupHelpers.js';
import { formatDelta } from '../modules/logFormat.js';
import { parseMailboxAddress } from '../core/messageIdentity.js';
import { MAX_WHITELIST_ENTRIES } from '../core/whitelist.js';
import { getMessage, localizedSummaryForKey } from '../modules/i18n.js';
import { summaryForKey, titleForKey } from '../core/ruleRegistry.js';

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
    return;
  }

  renderEntry(content, entry, { inReviewFolder, message, senderAddress, data });
}

function renderEntry(container, entry, context = {}) {
  container.innerHTML = '';

  // 1. Compact summary: classification, score, action taken
  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'summary-panel';

  const classEl = document.createElement('span');
  classEl.className = `classification ${entry.classification ?? ''}`;
  classEl.textContent = entry.classification ?? 'unknown';
  summaryPanel.appendChild(classEl);

  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'score-badge';
  scoreBadge.textContent = getMessage('popup_score', [String(entry.score ?? 0)]);
  summaryPanel.appendChild(scoreBadge);

  if (entry.action) {
    const actionEl = document.createElement('span');
    actionEl.className = 'action-label';
    actionEl.textContent = formatActionLabel(entry.action);
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
      labelSpan.textContent = reason.label ?? reason.key;
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
    pfHeading.textContent = 'Protective factors';
    pfSection.appendChild(pfHeading);

    const pfList = document.createElement('ul');
    pfList.className = 'protective-facts-list';

    for (const fact of protectiveFacts) {
      const li = document.createElement('li');
      li.className = 'protective-fact-item';

      if (fact.factKey === 'mitigation') {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'protective-fact-name';
        nameSpan.textContent = titleForKey(fact.scoreKey);
        const tip = summaryForKey(fact.scoreKey);
        if (tip) nameSpan.title = tip;
        li.appendChild(nameSpan);
      } else if (fact.factKey === 'dkimAligned') {
        li.textContent = 'DKIM signature aligned with From domain';
      } else if (fact.factKey === 'noTrustedAuth') {
        li.textContent = 'No trusted Authentication-Results headers found';
      } else if (fact.factKey === 'belowThreshold') {
        li.textContent =
          `Score (${fact.score}) is below the ${fact.thresholdName} threshold (${fact.threshold})`;
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
  detailsSummary.textContent = 'Score details';
  details.appendChild(detailsSummary);

  // Identity fields
  const id = entry.messageIdentity ?? {};
  const identityRows = [
    { label: 'From', value: id.from },
    { label: 'Subject', value: id.subject },
    { label: 'From domain', value: entry.fromDomain },
    { label: 'Message-ID', value: id.rfcMessageId },
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
    h3.textContent = 'All score reasons';
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
      labelSpan.textContent = reason.label ?? reason.key;
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
    moveBtn.textContent = 'Move to Inbox';
    moveBtn.addEventListener('click', async () => {
      moveBtn.disabled = true;
      whitelistBtn.disabled = true;
      try {
        const inboxId = await findInboxId(message.folder?.accountId);
        if (!inboxId) {
          showStatus(statusEl, 'Inbox folder not found.', 'error');
          moveBtn.disabled = false;
          whitelistBtn.disabled = false;
          return;
        }
        // Attempt to clear junk flag before moving; ignore errors.
        try { await browser.messages.update(message.id, { junk: false }); } catch { /* ignore */ }
        await browser.messages.move([message.id], inboxId);
        showStatus(statusEl, 'Moved to Inbox.', 'success');
      } catch {
        showStatus(statusEl, 'Move failed. Please try again.', 'error');
        moveBtn.disabled = false;
        whitelistBtn.disabled = false;
      }
    });
    panel.appendChild(moveBtn);

    // Whitelist Sender button
    const whitelistBtn = document.createElement('button');
    whitelistBtn.className = 'review-action-btn';
    whitelistBtn.textContent = 'Whitelist Sender';

    const whitelistEntry = buildWhitelistEntry(senderAddress);
    if (!whitelistEntry) {
      whitelistBtn.disabled = true;
      whitelistBtn.title = 'Sender address could not be determined.';
    } else {
      const existing = (data?.manualWhitelist ?? [])
        .some(e => e.matchType === 'exact' && e.value === whitelistEntry.value);

      if (existing) {
        whitelistBtn.disabled = true;
        whitelistBtn.title = 'This sender is already in the manual whitelist.';
        whitelistBtn.textContent = 'Already Whitelisted';
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
  optionsBtn.textContent = 'Open Options / Logs';
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
  msg.textContent = `Add "${entry.value}" to the manual whitelist? Future messages from this address will receive a score reduction.`;
  confirmDiv.appendChild(msg);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'review-action-btn confirm-btn';
  confirmBtn.textContent = 'Confirm';
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
      showStatus(statusEl, `"${entry.value}" added to the manual whitelist.`, 'success');
    } catch (err) {
      const msg = err?.message === 'full'
        ? `Whitelist is full (max ${MAX_WHITELIST_ENTRIES} entries). Remove an entry before adding a new one.`
        : 'Failed to save whitelist entry. Please try again.';
      showStatus(statusEl, msg, 'error');
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      moveBtn.disabled = false;
    }
  });
  confirmDiv.appendChild(confirmBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'review-action-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';
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

function formatActionLabel(action) {
  const map = {
    'classified-normal': 'Left in inbox',
    'classified-review': 'Scored review (no action)',
    'classified-high-risk': 'Scored high-risk (no action)',
    'moved-review': 'Moved to review folder',
    'moved-junk': 'Moved to Junk',
    'moved-junk-mark-failed': 'Moved to Junk',
    'move-review-failed': 'Move to review failed',
    'move-junk-failed': 'Move to Junk failed',
    'no-review-folder-configured': 'No review folder configured',
  };
  return map[action] ?? action;
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
    p.textContent = `Error loading score details: ${err.message}`;
    content.appendChild(p);
  }
});
