/**
 * Rule match report tab.
 *
 * Opened from the folder pane ("Analyze this folder") or message list
 * ("Analyze selected messages") context menu. The background passes the
 * targeted scope by an opaque token; this page resolves folder messages for the
 * chosen sent-date range and limit, runs the read-only analysis over the
 * rule-match-report port, and renders a sortable, filterable L1–L5 table with
 * a paginated per-rule drill-down.
 *
 * Nothing here moves, flags, or stores messages. The report lives in memory
 * for the lifetime of the tab only.
 */

import {
  getMessage,
  localizeDocument,
  localizedClassification,
  localizedTitleForKey,
} from '../modules/i18n.js';
import { formatDelta } from '../modules/logFormat.js';
import { MAX_RULE_MATCH_BATCH, RULE_MATCH_HARD_LIMIT, RULE_MATCH_REPORT_PORT } from '../modules/ruleMatchAnalysis.js';
import {
  RULE_MATCH_SCOPE_CANCEL_MESSAGE,
  RULE_MATCH_SCOPE_MESSAGE,
  collectFolderMessageIds,
  parseAnalysisLimit,
  parseSentDateRange,
} from '../modules/ruleMatchScope.js';
import { RULE_LAYERS } from '../core/ruleMatchReport.js';
import {
  ALL_LAYERS,
  DEFAULT_SORT,
  filterRuleRows,
  findRule,
  matchShare,
  pageItems,
  reportState,
  settleCollectedScope,
  sortRuleRows,
  toggleSort,
  withScopeExclusions,
} from '../core/ruleMatchReportView.js';

localizeDocument();

const DRILLDOWN_READ_CONCURRENCY = 4;
const SELECTION_POLL_MS = 250;

const $ = id => document.getElementById(id);

const uiLanguage = typeof browser !== 'undefined' && browser?.i18n?.getUILanguage
  ? browser.i18n.getUILanguage()
  : undefined;
const percentFormat = new Intl.NumberFormat(uiLanguage, { style: 'percent', maximumFractionDigits: 1 });
const numberFormat = new Intl.NumberFormat(uiLanguage);
const fmt = n => numberFormat.format(n ?? 0);

const state = {
  scope: null,
  scopeLabel: '',
  running: false,
  cancelRequested: false,
  port: null,
  collectAbort: null,
  collectingToken: null, // set while the background collects a selection
  report: null,
  run: null,          // { label, truncated, excluded, limit, generatedAt }
  sort: { ...DEFAULT_SORT },
  layer: ALL_LAYERS,
  includeDiagnostic: true,
  openRuleKey: null,
  drilldownPage: 0,
  drilldownGeneration: 0,
};

function setScopeMessage(text, kind = '') {
  const el = $('scope-message');
  el.textContent = text;
  el.className = `status ${kind}`.trim();
  el.hidden = !text;
}

function rangeLabel(fromDate, toDate) {
  const day = date => date.toLocaleDateString(uiLanguage);
  if (fromDate && toDate) return getMessage('report_range_between', [day(fromDate), day(toDate)]);
  if (fromDate) return getMessage('report_range_from', [day(fromDate)]);
  if (toDate) return getMessage('report_range_through', [day(toDate)]);
  return getMessage('report_range_any');
}

const FOLDER_OPTION_ERRORS = {
  'invalid-from': 'report_error_invalid_from',
  'invalid-through': 'report_error_invalid_through',
  inverted: 'report_error_inverted_range',
  'invalid-limit': 'report_error_invalid_limit',
};

/**
 * Validate the folder date range and limit inputs, update the limit note and
 * Run button, and return the parsed options (null while any input is invalid).
 * A native date input reports an incomplete or impossible date as '' with
 * validity.badInput, so that case is rejected rather than treated as blank.
 */
function readFolderOptions() {
  const fromInput = $('sent-from');
  const throughInput = $('sent-through');
  const noLimit = $('no-limit-toggle').checked;
  $('limit-input').disabled = noLimit || state.running;
  let error = null;
  let range = null;
  let limit = null;
  if (fromInput.validity?.badInput) error = 'invalid-from';
  else if (throughInput.validity?.badInput) error = 'invalid-through';
  else {
    range = parseSentDateRange(fromInput.value, throughInput.value);
    if (range.error) error = range.error;
  }
  if (!error) {
    limit = parseAnalysisLimit($('limit-input').value, noLimit);
    if (limit.error) error = limit.error;
  }
  if (error) {
    $('limit-note').textContent = '';
    setScopeMessage(getMessage(FOLDER_OPTION_ERRORS[error], [fmt(RULE_MATCH_HARD_LIMIT)]), 'error');
    $('run-btn').disabled = true;
    return null;
  }
  $('limit-note').textContent = noLimit
    ? getMessage('report_limit_note_no_user_limit', [fmt(RULE_MATCH_HARD_LIMIT)])
    : getMessage('report_limit_note', [fmt(limit.effective)]);
  if ($('scope-message').classList.contains('error')) setScopeMessage('');
  $('run-btn').disabled = state.running;
  return { fromDate: range.fromDate, toDate: range.toDate, limit: limit.limit, effective: limit.effective };
}

async function accountName(accountId) {
  if (!accountId) return '';
  try {
    const account = await browser.accounts.get(accountId);
    return account?.name ?? accountId;
  } catch {
    return accountId;
  }
}

async function describeScope(scope) {
  if (scope.kind === 'folder') {
    return getMessage('report_scope_folder', [scope.folder.name ?? scope.folder.path, await accountName(scope.folder.accountId)]);
  }
  const count = fmt(scope.messageIds.length + (scope.excluded ?? 0));
  if (scope.folders.length === 1) {
    return getMessage('report_scope_selection_one_folder', [count, scope.folders[0].name ?? scope.folders[0].path]);
  }
  return getMessage('report_scope_selection_many_folders', [count, fmt(scope.folders.length)]);
}

async function init() {
  $('limit-note').textContent = getMessage('report_limit_note', [fmt(MAX_RULE_MATCH_BATCH)]);

  $('cancel-btn').addEventListener('click', cancelRun);

  const token = new URLSearchParams(location.search).get('scope');
  let scope = await fetchScope(token);
  if (scope?.kind === 'selection' && scope.collecting) {
    // A Cancel that lands after collection finished must not start analysis.
    scope = settleCollectedScope(await waitForSelection(token, scope), {
      cancelRequested: state.cancelRequested,
    });
  }
  if (!scope || scope.kind === 'error' || scope.cancelled) {
    $('scope-label').hidden = true;
    $('limit-note').hidden = true;
    $('run-btn').hidden = true;
    if (scope?.cancelled) {
      setScopeMessage(getMessage('report_status_cancelled_before_start'), 'cancelled');
    } else {
      setScopeMessage(scope
        ? getMessage('report_status_error', [scope.error])
        : getMessage('report_scope_missing'), 'error');
    }
    return;
  }

  state.scope = scope;
  state.scopeLabel = await describeScope(scope);
  $('scope-label').textContent = state.scopeLabel;

  if (scope.kind === 'folder') {
    const limitInput = $('limit-input');
    limitInput.max = String(RULE_MATCH_HARD_LIMIT);
    limitInput.value = String(MAX_RULE_MATCH_BATCH);
    for (const id of ['sent-from', 'sent-through', 'limit-input', 'no-limit-toggle']) {
      $(id).addEventListener('input', readFolderOptions);
      $(id).addEventListener('change', readFolderOptions);
    }
    $('folder-options').hidden = false;
  } else if (scope.truncated) {
    setScopeMessage(getMessage('report_limit_reached', [fmt(MAX_RULE_MATCH_BATCH)]), 'partial');
  }

  const layerSelect = $('layer-filter');
  for (const value of [ALL_LAYERS, ...RULE_LAYERS]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === ALL_LAYERS ? getMessage('report_filter_all_layers') : value;
    layerSelect.append(option);
  }
  layerSelect.addEventListener('change', () => {
    state.layer = layerSelect.value;
    renderRuleTable();
  });
  $('diagnostic-toggle').addEventListener('change', e => {
    state.includeDiagnostic = e.target.checked;
    renderRuleTable();
  });
  for (const btn of document.querySelectorAll('.sort-btn')) {
    btn.addEventListener('click', () => {
      state.sort = toggleSort(state.sort, btn.dataset.sortKey);
      renderRuleTable();
    });
  }
  $('run-btn').addEventListener('click', () => { startRun().catch(showRunError); });
  $('drilldown-close').addEventListener('click', closeDrilldown);
  $('drilldown-prev').addEventListener('click', () => showDrilldownPage(state.drilldownPage - 1));
  $('drilldown-next').addEventListener('click', () => showDrilldownPage(state.drilldownPage + 1));

  $('run-btn').disabled = false;
  if (scope.kind === 'folder') readFolderOptions();
  // A selection is fixed at click time, so analyze it right away; a folder
  // waits for the user to choose a date range and limit.
  if (scope.kind === 'selection') startRun().catch(showRunError);
}

async function fetchScope(token) {
  try {
    return token ? await browser.runtime.sendMessage({ type: RULE_MATCH_SCOPE_MESSAGE, token }) : null;
  } catch {
    return null;
  }
}

/**
 * Show progress while the background pages through a large selection, and
 * let Cancel stop it. Resolves with the settled scope (or null if it is gone).
 */
async function waitForSelection(token, scope) {
  state.collectingToken = token;
  setRunning(true);
  $('progress-bar').removeAttribute('value');
  try {
    while (scope?.kind === 'selection' && scope.collecting) {
      $('progress-text').textContent = getMessage('report_collecting_count', [fmt(scope.collected)]);
      await new Promise(resolve => setTimeout(resolve, SELECTION_POLL_MS));
      scope = await fetchScope(token);
    }
  } finally {
    state.collectingToken = null;
    setRunning(false);
  }
  return scope;
}

// ── Running ───────────────────────────────────────────────────────────────────

function setRunning(running) {
  state.running = running;
  $('run-btn').disabled = running;
  for (const id of ['sent-from', 'sent-through', 'no-limit-toggle']) $(id).disabled = running;
  $('limit-input').disabled = running || $('no-limit-toggle').checked;
  $('progress-section').hidden = !running;
  $('cancel-btn').disabled = false;
}

async function resolveMessageIds(options) {
  const scope = state.scope;
  if (scope.kind === 'folder') {
    // Cancel aborts collection: pagination stops and the list is released.
    const controller = new AbortController();
    state.collectAbort = controller;
    const collectStart = performance.now();
    try {
      const collected = await collectFolderMessageIds(browser, scope.folder, {
        fromDate: options.fromDate,
        toDate: options.toDate,
        limit: options.limit,
        signal: controller.signal,
        onProgress: ({ collected: count }) => {
          $('progress-text').textContent = getMessage('report_collecting_folder_count', [fmt(count)]);
        },
      });
      return {
        ...collected,
        maxMessages: options.limit,
        limit: options.effective,
        collectMs: performance.now() - collectStart,
        label: [
          state.scopeLabel,
          rangeLabel(options.fromDate, options.toDate),
          getMessage('report_limit_short', [fmt(options.effective)]),
        ].join(' · '),
      };
    } finally {
      state.collectAbort = null;
    }
  }
  return {
    messageIds: scope.messageIds,
    accountIds: scope.accountIds,
    excluded: scope.excluded ?? 0,
    truncated: scope.truncated,
    maxMessages: MAX_RULE_MATCH_BATCH,
    limit: MAX_RULE_MATCH_BATCH,
    // The selection was enumerated by the background at menu-click time.
    collectMs: scope.collectMs,
    label: state.scopeLabel,
  };
}

async function startRun() {
  if (state.running) return;
  // Inputs are validated again here, not only when they change.
  const options = state.scope.kind === 'folder' ? readFolderOptions() : null;
  if (state.scope.kind === 'folder' && !options) return;
  state.cancelRequested = false;
  setScopeMessage(state.scope.kind === 'selection' && state.scope.truncated
    ? getMessage('report_limit_reached', [fmt(MAX_RULE_MATCH_BATCH)])
    : '', 'partial');
  closeDrilldown();
  $('result-section').hidden = true;
  setRunning(true);
  $('progress-bar').removeAttribute('value');
  $('progress-text').textContent = getMessage('report_collecting');

  let resolved;
  try {
    resolved = await resolveMessageIds(options);
  } catch (error) {
    showRunError(error);
    return;
  }
  if (state.cancelRequested || resolved.cancelled) {
    setRunning(false);
    setScopeMessage(getMessage('report_status_cancelled_before_start'), 'cancelled');
    return;
  }

  const run = {
    label: resolved.label,
    truncated: resolved.truncated,
    excluded: resolved.excluded ?? 0,
    limit: resolved.limit,
    generatedAt: null,
  };
  updateProgress({ completed: 0, total: resolved.messageIds.length });

  const port = browser.runtime.connect({ name: RULE_MATCH_REPORT_PORT });
  state.port = port;
  let settled = false;
  port.onMessage.addListener(msg => {
    if (msg?.type === 'progress') {
      updateProgress(msg.progress);
    } else if (msg?.type === 'result') {
      settled = true;
      state.port = null;
      port.disconnect();
      run.generatedAt = new Date();
      state.run = run;
      // Totals describe the whole scope, including messages over the limit.
      state.report = withScopeExclusions(msg.report, run.excluded);
      setRunning(false);
      const renderStart = performance.now();
      renderReport();
      logRunTimings(msg.report, resolved.collectMs, performance.now() - renderStart);
    } else if (msg?.type === 'error') {
      settled = true;
      state.port = null;
      port.disconnect();
      showRunError(msg.error);
    }
  });
  port.onDisconnect.addListener(() => {
    if (settled) return;
    state.port = null;
    showRunError(browser.runtime.lastError?.message ?? 'disconnected');
  });
  port.postMessage({
    type: 'start',
    messageIds: resolved.messageIds,
    accountIds: resolved.accountIds,
    maxMessages: resolved.maxMessages,
  });
}

// Local performance diagnostics in the report tab's console: phase durations
// and counts only, never message data. Nothing is stored or sent anywhere.
function logRunTimings(report, collectMs, renderMs) {
  const ms = value => Math.round(Number(value) || 0);
  console.debug('[rule-match-report] timings (ms)', {
    scope: state.scope?.kind,
    collect: ms(collectMs),
    analysis: ms(report?.timings?.elapsedMs),
    readTotal: ms(report?.timings?.readMs),
    assessTotal: ms(report?.timings?.assessMs),
    render: ms(renderMs),
    analyzed: report?.analyzed,
    failed: report?.failed,
    skipped: report?.skipped,
    overLimit: report?.overLimit,
  });
}

function updateProgress({ completed = 0, total = 0 } = {}) {
  const bar = $('progress-bar');
  bar.max = Math.max(total, 1);
  bar.value = completed;
  $('progress-text').textContent = getMessage('report_progress', [fmt(completed), fmt(total)]);
}

function cancelRun() {
  state.cancelRequested = true;
  $('cancel-btn').disabled = true;
  state.collectAbort?.abort();
  if (state.collectingToken) {
    // Stops the background from paging further through the selection.
    browser.runtime.sendMessage({ type: RULE_MATCH_SCOPE_CANCEL_MESSAGE, token: state.collectingToken })
      .catch(() => {});
  }
  // Messages already being read finish; the rest are reported as cancelled.
  try { state.port?.postMessage({ type: 'cancel' }); } catch { /* port closed */ }
}

function showRunError(error) {
  setRunning(false);
  setScopeMessage(getMessage('report_status_error', [String(error?.message ?? error)]), 'error');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderReport() {
  const { report, run } = state;
  $('run-btn').textContent = getMessage('report_run_again');
  $('result-section').hidden = false;
  $('result-scope').textContent = run.label;

  const status = $('result-status');
  const kind = reportState(report, run);
  status.className = `status ${kind}`;
  if (kind === 'cancelled') {
    status.textContent = getMessage('report_status_cancelled', [fmt(report.analyzed), fmt(report.requested)]);
  } else if (kind === 'empty') {
    status.textContent = getMessage('report_status_empty');
  } else if (kind === 'partial') {
    status.textContent = getMessage('report_status_partial', [fmt(report.analyzed), fmt(report.requested)]);
  } else {
    status.textContent = getMessage('report_status_complete', [fmt(report.requested)]);
  }

  const limit = $('result-limit');
  limit.hidden = !run.truncated;
  limit.textContent = run.truncated ? getMessage('report_limit_reached', [fmt(run.limit)]) : '';

  $('count-requested').textContent = fmt(report.requested);
  $('count-analyzed').textContent = fmt(report.analyzed);
  $('count-failed').textContent = fmt(report.failed);
  $('count-skipped').textContent = fmt(report.skipped);
  $('count-over-limit').textContent = fmt(report.overLimit);
  $('result-generated').textContent = getMessage('report_generated_at', [run.generatedAt.toLocaleString(uiLanguage)]);

  renderRuleTable();
}

function renderSortState() {
  const { key, direction } = state.sort;
  for (const [id, sortKey] of [['th-rule', 'rule'], ['th-matches', 'matches']]) {
    const th = $(id);
    const active = key === sortKey;
    th.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = th.querySelector('.sort-btn');
    btn.classList.toggle('active', active);
    btn.querySelector('.sort-indicator').textContent = active ? (direction === 'asc' ? '▲' : '▼') : '';
  }
  $('sort-state').textContent = getMessage('report_sorted_by', [
    getMessage(key === 'rule' ? 'report_sort_by_rule' : 'report_sort_by_matches'),
    getMessage(direction === 'asc' ? 'report_sort_ascending' : 'report_sort_descending'),
  ]);
}

function ruleTitle(rule) {
  return localizedTitleForKey(rule.key) || rule.label || rule.key;
}

function renderRuleTable() {
  const report = state.report;
  if (!report) return;
  renderSortState();

  const rows = sortRuleRows(
    filterRuleRows(report.rules, { layer: state.layer, includeDiagnostic: state.includeDiagnostic }),
    state.sort,
  );
  const tbody = $('rule-rows');
  tbody.replaceChildren();
  for (const rule of rows) {
    const tr = document.createElement('tr');
    tr.classList.toggle('selected', rule.key === state.openRuleKey);

    const ruleCell = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent = ruleTitle(rule);
    btn.title = rule.key;
    btn.addEventListener('click', () => openDrilldown(rule.key));
    ruleCell.append(btn);
    if (rule.diagnostic) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = getMessage('report_diagnostic_tag');
      ruleCell.append(tag);
    }

    const layerCell = document.createElement('td');
    layerCell.textContent = rule.layer ?? '—';

    const matchCell = document.createElement('td');
    matchCell.className = 'num';
    matchCell.textContent = getMessage('report_matches_of', [fmt(rule.matchCount), fmt(report.analyzed)]);

    const shareCell = document.createElement('td');
    shareCell.className = 'num';
    const share = matchShare(rule.matchCount, report.analyzed);
    shareCell.textContent = share == null ? '—' : percentFormat.format(share);

    tr.append(ruleCell, layerCell, matchCell, shareCell);
    tbody.append(tr);
  }

  const empty = $('rule-empty');
  $('rule-table').hidden = rows.length === 0;
  if (rows.length > 0) {
    empty.hidden = true;
  } else {
    empty.hidden = report.analyzed === 0;
    empty.textContent = report.rules.length === 0
      ? getMessage('report_no_matches')
      : getMessage('report_no_rows_for_filter');
  }
}

// ── Drill-down ────────────────────────────────────────────────────────────────

function closeDrilldown() {
  state.openRuleKey = null;
  state.drilldownGeneration++;
  $('drilldown-section').hidden = true;
  for (const tr of $('rule-rows').querySelectorAll('tr.selected')) tr.classList.remove('selected');
}

function openDrilldown(key) {
  const report = state.report;
  const rule = findRule(report, key);
  if (!rule) return;
  state.openRuleKey = key;
  renderRuleTable();

  $('drilldown-heading').textContent = getMessage('report_drilldown_heading', [ruleTitle(rule)]);
  $('drilldown-count').textContent = getMessage('report_matches_of', [fmt(rule.matchCount), fmt(report.analyzed)]);
  showDrilldownPage(0);

  const section = $('drilldown-section');
  section.hidden = false;
  section.scrollIntoView({ block: 'start' });
}

// Render one page of the open rule's matching messages. Only the rows on the
// page are built and only their display headers are read, so a rule matching
// thousands of messages stays responsive.
function showDrilldownPage(page) {
  const rule = findRule(state.report, state.openRuleKey);
  if (!rule) return;
  const generation = ++state.drilldownGeneration;
  const view = pageItems(rule.messages, page);
  state.drilldownPage = view.page;
  $('drilldown-pager').hidden = view.pageCount <= 1;
  $('drilldown-prev').disabled = view.page === 0;
  $('drilldown-next').disabled = view.page >= view.pageCount - 1;
  $('drilldown-page-status').textContent = getMessage('report_page_status', [fmt(view.start), fmt(view.end), fmt(view.total)]);

  const tbody = $('drilldown-rows');
  tbody.replaceChildren();
  const pending = [];
  for (const match of view.items) {
    const tr = document.createElement('tr');
    const dateCell = document.createElement('td');
    const fromCell = document.createElement('td');
    const subjectCell = document.createElement('td');
    const deltaCell = document.createElement('td');
    const scoreCell = document.createElement('td');
    const classCell = document.createElement('td');
    dateCell.textContent = '…';
    deltaCell.className = 'num';
    deltaCell.textContent = formatDelta(match.delta);
    scoreCell.className = 'num';
    scoreCell.textContent = String(match.score);
    classCell.textContent = localizedClassification(match.classification);
    tr.append(dateCell, fromCell, subjectCell, deltaCell, scoreCell, classCell);
    tbody.append(tr);
    pending.push({ messageId: match.messageId, dateCell, fromCell, subjectCell });
  }
  fillMessageDetails(pending, generation);
}

// Read display headers for the matching messages with bounded concurrency.
async function fillMessageDetails(pending, generation) {
  let next = 0;
  const worker = async () => {
    while (next < pending.length && generation === state.drilldownGeneration) {
      const item = pending[next++];
      let header = null;
      try { header = await browser.messages.get(item.messageId); } catch { header = null; }
      if (generation !== state.drilldownGeneration) return;
      renderMessageDetails(item, header);
    }
  };
  await Promise.all(Array.from({ length: DRILLDOWN_READ_CONCURRENCY }, worker));
}

function renderMessageDetails({ messageId, dateCell, fromCell, subjectCell }, header) {
  if (!header) {
    dateCell.textContent = '';
    subjectCell.textContent = getMessage('report_message_unavailable');
    return;
  }
  const date = header.date ? new Date(header.date) : null;
  dateCell.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(uiLanguage) : '';
  fromCell.textContent = header.author ?? '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = header.subject || getMessage('notification_no_subject');
  // Opens the message for reading; the message stays in its folder.
  btn.addEventListener('click', () => {
    browser.messageDisplay.open({ messageId, location: 'tab' }).catch(() => {});
  });
  subjectCell.replaceChildren(btn);
}

init().catch(error => setScopeMessage(getMessage('report_status_error', [String(error?.message ?? error)]), 'error'));
