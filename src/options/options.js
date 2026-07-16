import { getStorage, updateStorage, SCORE_DEFAULTS_VERSION } from '../modules/storage.js';
import { validateFormulaFields, buildLastFormulaDiagnostics } from './formulaValidation.js';
import { CHIP_GROUPS } from './formulaChips.js';
import { MAX_CUSTOM_FORMULAS } from '../core/customFormulas.js';
import { validateTrustedEntry, getPromotableRegistrableDomain } from './trustedEntryValidation.js';
import { isTrustedAuthservId } from '../core/trust.js';
import { generateSuggestionsFromEmails, generateMxSuggestionsFromHosts } from '../modules/setupSuggestions.js';
import { lookupMxHosts } from '../modules/mxLookup.js';
import {
  classifyScore,
  recalculateScoreReasons,
  sumCurrentDeltas,
  DEFAULT_AUTH_SCORES,
  DEFAULT_LAYER2_SCORES,
  DEFAULT_COMPOSITE_SCORES,
  DEFAULT_WHITELIST_MITIGATION,
  DEFAULT_ADDRESS_BOOK_MITIGATION,
} from '../core/scoring.js';
import { DEFAULT_HEURISTIC_SCORES } from '../core/heuristics.js';
import {
  deriveExportVerdict,
  buildUnknownExportState,
  buildExportPayload,
  buildHeaderMessageIdQueryValues,
  chooseBestMessageQueryResult,
} from '../modules/logExport.js';
import { formatDelta, buildTopReasonsSummary, sliceRecentLog, logHasMore } from '../modules/logFormat.js';
import { MAX_WHITELIST_ENTRIES } from '../core/whitelist.js';
import { getMessage, localizedTitleForKey, localizedSummaryForKey, localizedTooltipForKey, localizeDocument } from '../modules/i18n.js';
import { REGISTRY, getRuleMeta } from '../core/ruleRegistry.js';

const $ = id => document.getElementById(id);

localizeDocument();

// Decision log render limits — keeps initial page load fast for large logs.
const LOG_RENDER_LIMIT = 50;
const LOG_RENDER_INCREMENT = 50;

// Tracks how many entries are currently visible; reset when the log is cleared.
let logCurrentLimit = LOG_RENDER_LIMIT;

// Ordered list of all configurable auth-result score fields.
const AUTH_SCORE_FIELDS = [
  { method: 'dmarc', result: 'pass',      label: 'DMARC pass'      },
  { method: 'dmarc', result: 'fail',      label: 'DMARC fail'      },
  { method: 'dmarc', result: 'none',      label: 'DMARC none'      },
  { method: 'dmarc', result: 'policy',    label: 'DMARC policy'    },
  { method: 'spf',   result: 'pass',      label: 'SPF pass'        },
  { method: 'spf',   result: 'fail',      label: 'SPF fail'        },
  { method: 'spf',   result: 'none',      label: 'SPF none'        },
  { method: 'spf',   result: 'softfail',  label: 'SPF softfail'    },
  { method: 'spf',   result: 'neutral',   label: 'SPF neutral'     },
  { method: 'spf',   result: 'temperror', label: 'SPF temperror'   },
  { method: 'spf',   result: 'permerror', label: 'SPF permerror'   },
  { method: 'dkim',  result: 'pass',      label: 'DKIM pass'       },
  { method: 'dkim',  result: 'fail',      label: 'DKIM fail'       },
  { method: 'dkim',  result: 'none',      label: 'DKIM none'       },
  { method: 'dkim',  result: 'temperror', label: 'DKIM temperror'  },
  { method: 'dkim',  result: 'permerror', label: 'DKIM permerror'  },
];

const scoreInputId = (method, result) => `score-${method}-${result}`;

// Layer 2 identity alignment score fields.
const LAYER2_SCORE_FIELDS = [
  { key: 'spfMailFromMismatch',          label: 'SPF MAIL FROM differs from From',       id: 'score-l2-spf-mailfrom-mismatch'  },
  { key: 'dkimDomainMismatch',           label: 'DKIM signing domain differs from From',  id: 'score-l2-dkim-domain-mismatch'   },
  { key: 'dmarcNoneWithThirdPartyAuth',  label: 'DMARC none with only third-party auth',  id: 'score-l2-dmarc-none-thirdparty'  },
];

// Layer 3 heuristic score fields.
const HEURISTIC_SCORE_FIELDS = [
  { key: 'randomFromDomainLabel', label: 'Random-looking From domain label', id: 'score-heuristic-domain-label' },
  { key: 'randomFromLocalPart',   label: 'Random-looking From local part',   id: 'score-heuristic-local-part'  },
  { key: 'layer3Cap',             label: 'Layer 3 total cap',                id: 'score-heuristic-layer3-cap'  },
];

// Layer 4 composite rule score fields (implemented rules only).
const COMPOSITE_SCORE_FIELDS = [
  { key: 'spfAlignedDkimUnalignedRandomLocal',       label: 'SPF aligned, DKIM unaligned, random local part',             id: 'score-c4-spf-aligned-dkim-unaligned'         },
  { key: 'authAlignedRandomDomain',                  label: 'Auth-aligned sender with random-looking domain',              id: 'score-c4-auth-aligned-random-domain'         },
  { key: 'thirdPartyAuthRandomLocal',                label: 'Third-party auth pass with random local part, no alignment',  id: 'score-c4-third-party-auth-random-local'      },
  { key: 'messageIdMismatchWithUnalignedAuth',       label: 'Message-ID domain mismatch with unaligned authentication',   id: 'score-c4-msg-id-mismatch'                    },
  { key: 'messageIdUnregistrableMismatch',          label: 'Message-ID domain unregistrable, mismatches From',           id: 'score-c4-msg-id-unregistrable-mismatch'      },
  { key: 'fromSenderMismatchWithUnalignedAuth',      label: 'From/Sender mismatch with unaligned authentication',          id: 'score-c4-from-sender-mismatch'               },
  { key: 'deepRandomFromSubdomain',                  label: 'Deep random-looking From subdomain',                          id: 'score-c4-deep-random-from-subdomain'         },
  { key: 'unsecuredDeepSubdomain',                   label: 'DMARC-none deep subdomain (no DMARC enforcement, deep subdomain structure)', id: 'score-c4-unsecured-deep-subdomain' },
  { key: 'spfPassDkimFailRandomLocal',               label: 'SPF pass, DKIM fail, random local part',                      id: 'score-c4-spf-pass-dkim-fail-random-local'    },
  { key: 'delegatedDkimAlignedRouteConsistent',      label: 'Delegated newsletter: DKIM-aligned, route-consistent',  id: 'score-c4-delegated-dkim-aligned', min: -500, mitigation: true },
  { key: 'dkimAlignedLexicalMitigation',             label: 'DKIM-aligned lexical false-positive mitigation',         id: 'score-c4-dkim-aligned-lexical',   min: -500, mitigation: true },
  { key: 'ownDomainAuthFail',                        label: 'Own account domain with failed authentication',                      id: 'score-c4-own-domain-auth-fail'               },
  { key: 'unparseableFromWithInfrastructureMismatch', label: 'Unparseable From with infrastructure mismatch',                      id: 'score-c4-unparseable-from-infra-mismatch'    },
  { key: 'dmarcFailDkimAlignedListMitigation',        label: 'DMARC fail mitigated: DKIM-aligned + List headers',             id: 'score-c4-dmarc-fail-dkim-list-mitigation', min: -500, mitigation: true },
  { key: 'geoTokenCompoundDomain',                   label: 'Geo/token compound registrable domain (disposable-domain spam)',      id: 'score-c4-geo-token-compound-domain'          },
  { key: 'deepServiceWordSubdomain',                 label: 'Deep service-word subdomain (disposable-domain spam)',                id: 'score-c4-deep-service-word-subdomain'        },
  { key: 'dkimFailWithAlignedPass',                  label: 'DKIM fail with aligned DKIM pass (sloppy double-signature)',           id: 'score-c4-dkim-fail-with-aligned-pass'        },
  { key: 'brandDivergencePhishing',                  label: 'Display-name brand divergence phishing (brand in display name, unrelated From domain)', id: 'score-c4-brand-divergence-phishing' },
  // mail-auth-signal composite signal scores
  { key: 'unauthenticatedFromSpoof',                 label: 'Unauthenticated From with sender inconsistency (mail-auth-signal)',                        id: 'score-c4-unauthenticated-from-spoof'          },
  { key: 'authenticatedDisplayNameSpoof',            label: 'Authenticated sender: display name embeds different domain (mail-auth-signal)',             id: 'score-c4-authenticated-display-name-spoof'   },
  { key: 'publicDomainSpoofing',                     label: 'Public mailbox provider domain with failed authentication (mail-auth-signal)',             id: 'score-c4-public-domain-spoofing'             },
];

async function load() {
  const data = await getStorage();
  const settings = data.settings;

  $('move-to-review').checked = settings.moveToReview ?? true;
  $('move-high-risk-to-junk').checked = settings.moveHighRiskToJunk ?? false;
  $('notify-after-assessment').checked = settings.notifyAfterAssessment ?? false;
  $('notification-max-score').value = settings.notificationMaxScore ?? 49;
  $('notification-min-interval').value = settings.notificationMinIntervalMs ?? 4000;
  updateNotificationOptionsDisabled(settings.notifyAfterAssessment ?? false);

  const diagnosticsEnabled = settings.diagnosticsMode ?? false;
  $('diagnostics-mode-enabled').checked = diagnosticsEnabled;
  updateDiagnosticsTabVisibility(diagnosticsEnabled);

  await renderReviewFolderSettings(settings.reviewFolders ?? {});
  renderTrustedDomains(data.trustedDomains);
  renderCandidates(data.candidates);
  renderProtectionStatus(data.trustedDomains, data.decisionLog);
  renderActivitySummary(data.decisionLog);
  renderScoreSettings(settings);
  renderSenderRules(data.senderDomainRules);
  renderWhitelistEntries(data.manualWhitelist ?? []);
  $('whitelist-mitigation-score').value = settings.whitelistMitigationScore ?? DEFAULT_WHITELIST_MITIGATION;
  await loadAddressBookWhitelistSettings(settings);
  renderDecisionLog(data.decisionLog, settings);
  renderCustomFormulas(data.customFormulas ?? [], buildLastFormulaDiagnostics(data.decisionLog));
  renderScoreReasonKeyReference();
  renderSetupAssistant();
}

/**
 * Compute a summary of recent mail activity from the decision log.
 * Pure function — no DOM access.
 *
 * @param {Array} log - Decision log entries.
 * @returns {{ total: number, counts: {normal: number, review: number, 'high-risk': number} }}
 */
export function buildActivitySummary(log) {
  const counts = { normal: 0, review: 0, 'high-risk': 0 };
  for (const entry of log) {
    const cls = entry.classification ?? classifyScore(entry.score ?? 0);
    if (cls === 'normal') counts.normal++;
    else if (cls === 'review') counts.review++;
    else if (cls === 'high-risk') counts['high-risk']++;
  }
  return { total: log.length, counts };
}

/**
 * Determine protection configuration status from stored trusted domains.
 * Pure function — no DOM access.
 *
 * @param {Array} trustedDomains
 * @returns {{ configured: boolean, count: number }}
 */
export function buildProtectionStatus(trustedDomains) {
  const valid = (trustedDomains ?? []).filter(
    d => d && typeof d === 'object' && typeof d.value === 'string'
      && (d.matchType === 'exact' || d.matchType === 'domain'),
  );
  return { configured: valid.length > 0, count: valid.length };
}

/**
 * Render the protection status section in the Basic tab.
 * Shows a warning when no trusted servers are configured.
 */
function renderProtectionStatus(trustedDomains, decisionLog) {
  const container = $('protection-status-content');
  container.innerHTML = '';
  const status = buildProtectionStatus(trustedDomains);

  if (!status.configured) {
    const warning = document.createElement('p');
    warning.className = 'status-warning';
    warning.textContent = getMessage('status_no_trusted_servers');
    container.append(warning);

    const callout = document.createElement('p');
    callout.className = 'firstrun-callout';
    callout.textContent = getMessage('firstrun_callout');
    container.append(callout);
    return;
  }

  const ok = document.createElement('p');
  ok.className = 'status-ok';
  ok.textContent = getMessage('status_protection_active', [
    String(status.count),
    status.count !== 1 ? 's' : '',
  ]);
  container.append(ok);

  // Warn if recent log entries have no trusted AR results.
  const recentEntries = (decisionLog ?? []).slice(0, 20);
  const noTrustedCount = recentEntries.filter(e =>
    Array.isArray(e.scoreReasons) && e.scoreReasons.length > 0
    && !e.scoreReasons.some(r => r.key && !r.key.startsWith('authserv.untrusted') && r.key.startsWith('auth.')),
  ).length;
  if (recentEntries.length > 0 && noTrustedCount === recentEntries.length) {
    const hint = document.createElement('p');
    hint.className = 'status-hint';
    hint.textContent = getMessage('status_recent_no_trusted_ar');
    container.append(hint);
  }
}

/**
 * Render a simple activity summary (counts only — no raw scores or reasons).
 */
function renderActivitySummary(decisionLog) {
  const container = $('activity-summary-content');
  container.innerHTML = '';
  const summary = buildActivitySummary(decisionLog ?? []);

  if (summary.total === 0) {
    const p = document.createElement('p');
    p.className = 'activity-empty';
    p.textContent = getMessage('activity_no_messages');
    container.append(p);
    return;
  }

  const countEl = document.createElement('p');
  countEl.className = 'activity-counts';
  countEl.textContent = getMessage('activity_counts', [
    String(summary.total),
    summary.total !== 1 ? 's' : '',
    String(summary.counts.normal),
    String(summary.counts.review),
    String(summary.counts['high-risk']),
  ]);
  container.append(countEl);

  // Show last 5 entries as a simple list (no scoreReasons or raw metrics).
  const recent = (decisionLog ?? []).slice(0, 5);
  if (recent.length > 0) {
    const heading = document.createElement('p');
    heading.className = 'activity-recent-heading';
    heading.textContent = getMessage('activity_most_recent');
    container.append(heading);
    const ul = document.createElement('ul');
    ul.className = 'activity-recent-list';
    for (const entry of recent) {
      const li = document.createElement('li');
      const cls = entry.classification ?? classifyScore(entry.score ?? 0);
      li.textContent =
        `${new Date(entry.timestamp).toLocaleString()} — `
        + `${entry.fromDomain || '(unknown)'} — `
        + `${cls} — `
        + `${entry.action ?? ''}`;
      li.className = `activity-entry activity-entry-${cls.replace('-', '')}`;
      ul.append(li);
    }
    container.append(ul);
  }
}

/**
 * Show or hide the Diagnostics tab button based on diagnosticsMode setting.
 */
function updateDiagnosticsTabVisibility(enabled) {
  const btn = $('diagnostics-tab-btn');
  if (btn) btn.classList.toggle('tab-btn-hidden', !enabled);
  // If diagnostics tab is currently active but mode is disabled, switch to basic.
  if (!enabled) {
    const activePanel = document.querySelector('.tab-panel.tab-panel-active');
    if (activePanel && activePanel.id === 'tab-panel-diagnostics') {
      activateTab('basic');
    }
  }
}

/** Map DNS lookup error codes to i18n message keys. */
const DNS_ERROR_MSG_KEYS = {
  invalid_resolver: 'dns_error_invalid_resolver',
  timeout:          'dns_error_timeout',
  network_error:    'dns_error_network',
  http_error:       'dns_error_http',
  dns_error:        'dns_error_dns',
};

/** Incremented on every renderSetupAssistant call to detect stale async renders. */
let renderSetupAssistantGeneration = 0;

/**
 * Render setup hints derived from account email domains.  Suggestions are
 * NOT trusted entries — the user must explicitly fill and submit the
 * add-trusted-form to store any entry.
 *
 * Reads DNS settings from storage to populate controls and optionally run
 * MX lookups.
 */
async function renderSetupAssistant() {
  const generation = ++renderSetupAssistantGeneration;
  const data = await getStorage();
  const setupHints = data.settings?.setupHints ?? {};
  const dnsEnabled = setupHints.dnsLookupEnabled ?? false;
  const dnsResolver = setupHints.dnsResolver ?? '8.8.8.8';
  const dnsTimeoutMs = setupHints.dnsTimeoutMs ?? 5000;

  // Populate DNS settings controls from stored values.
  $('setup-hint-dns-enabled').checked = dnsEnabled;
  $('setup-hint-dns-resolver').value = dnsResolver;
  $('setup-hint-dns-resolver').disabled = !dnsEnabled;

  // Defer MX lookups and suggestion rendering until the user opens the details
  // panel — sending account domains to an external resolver before the user
  // explicitly expands the setup assistant would violate the documented privacy
  // constraint.
  if (!$('setup-assistant').open) return;

  // Read back the select's actual displayed value — handles stored values not present in the list.
  const effectiveDnsResolver = $('setup-hint-dns-resolver').value;

  const list = $('setup-suggestion-list');
  list.innerHTML = '';

  let emails = [];
  try {
    const accounts = await browser.accounts.list();
    for (const account of accounts) {
      for (const identity of account.identities ?? []) {
        if (identity.email) emails.push(identity.email);
      }
    }
  } catch {
    const p = document.createElement('p');
    p.className = 'setup-assistant-note';
    p.textContent = getMessage('setup_unable_load_accounts');
    list.append(p);
    return;
  }

  const heuristicSuggestions = generateSuggestionsFromEmails(emails);

  if (heuristicSuggestions.length === 0) {
    const p = document.createElement('p');
    p.className = 'setup-assistant-note';
    p.textContent = getMessage('setup_no_accounts');
    list.append(p);
    return;
  }

  // Group heuristic suggestions by domain.
  const grouped = new Map();
  for (const s of heuristicSuggestions) {
    if (!grouped.has(s.domain)) grouped.set(s.domain, []);
    grouped.get(s.domain).push(s);
  }

  // Run MX lookups in parallel when DNS is enabled.
  const mxResultsByDomain = new Map();
  if (dnsEnabled) {
    const domains = [...grouped.keys()];
    const results = await Promise.all(
      domains.map(async domain => [domain, await lookupMxHosts(domain, effectiveDnsResolver, dnsTimeoutMs)]),
    );
    if (generation !== renderSetupAssistantGeneration) return;
    for (const [domain, result] of results) {
      mxResultsByDomain.set(domain, result);
    }
  }

  for (const [domain, group] of grouped) {
    const section = document.createElement('div');
    section.className = 'setup-suggestion-group';

    const heading = document.createElement('p');
    heading.className = 'setup-suggestion-domain';
    heading.textContent = domain;
    section.append(heading);

    // If DNS is enabled, show MX lookup status and prepend MX suggestions.
    if (dnsEnabled) {
      const mxResult = mxResultsByDomain.get(domain);
      if (mxResult) {
        if (!mxResult.ok) {
          const statusP = document.createElement('p');
          statusP.className = 'setup-dns-status dns-error';
          statusP.textContent = getMessage(DNS_ERROR_MSG_KEYS[mxResult.error] ?? 'dns_error_generic');
          section.append(statusP);
        } else if (mxResult.hosts.length === 0) {
          const statusP = document.createElement('p');
          statusP.className = 'setup-dns-status';
          statusP.textContent = getMessage('setup_no_mx_records');
          section.append(statusP);
        } else {
          const mxSuggestions = generateMxSuggestionsFromHosts(mxResult.hosts, domain);
          for (const s of mxSuggestions) {
            section.append(buildSuggestionRow(s));
          }
        }
      }
    }

    // Always show heuristic suggestions.
    for (const s of group) {
      section.append(buildSuggestionRow(s));
    }

    list.append(section);
  }
}

/**
 * Build a suggestion row element for a single suggestion.
 *
 * @param {{host: string, source: string, domain: string}} s
 * @returns {HTMLElement}
 */
function buildSuggestionRow(s) {
  const row = document.createElement('div');
  row.className = 'setup-suggestion-row';

  const hostSpan = document.createElement('span');
  hostSpan.className = 'setup-suggestion-host';
  hostSpan.textContent = s.host;

  const sourceSpan = document.createElement('span');
  sourceSpan.className = `setup-suggestion-source${s.source === 'mx' ? ' source-mx' : ''}`;
  sourceSpan.textContent = s.source;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = getMessage('btn_use');
  btn.className = 'setup-suggestion-use-btn';
  btn.addEventListener('click', () => {
    $('add-trusted-value').value = s.host;
    $('add-trusted-matchtype').value = 'exact';
    onAddTrustedMatchTypeChange();
    $('add-trusted-error').hidden = true;
    $('add-trusted-value').focus();
    $('add-trusted-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  row.append(hostSpan, ' ', sourceSpan, ' ', btn);
  return row;
}

async function renderReviewFolderSettings(reviewFolders) {
  const container = $('review-folder-accounts');
  container.innerHTML = '';

  try {
    const accounts = await browser.accounts.list();
    if (accounts.length === 0) {
      const p = document.createElement('p');
      p.textContent = getMessage('review_folder_no_accounts');
      container.append(p);
      return;
    }
    for (const account of accounts) {
      const row = document.createElement('div');
      row.className = 'review-folder-row';
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = account.name + ': ';
      const select = document.createElement('select');
      select.dataset.accountId = account.id;
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = getMessage('review_folder_select_placeholder');
      select.append(defaultOpt);
      appendFolderOptions(select, account.folders, '');
      const saved = reviewFolders[account.id];
      if (saved) select.value = saved;
      select.addEventListener('change', () =>
        saveReviewFolderForAccount(account.id, select.value || null));
      label.append(span, select);
      row.append(label);
      container.append(row);
    }
  } catch {
    const p = document.createElement('p');
    p.textContent = getMessage('review_folder_unable_load');
    container.append(p);
  }
}

function appendFolderOptions(parent, folders, indent) {
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = indent + f.name;
    parent.append(opt);
    if (f.subFolders?.length) appendFolderOptions(parent, f.subFolders, indent + ' ');
  }
}

function renderTrustedDomains(domains) {
  const list = $('trusted-domain-list');
  const noMsg = $('no-trusted-msg');
  // Filter to valid typed entries first; malformed/legacy entries are excluded.
  // Only known matchTypes ('exact' / 'domain') are shown — this guarantees that
  // every visible Remove button can actually remove the entry.
  const validDomains = domains.filter(
    d => d && typeof d === 'object' && typeof d.value === 'string'
      && (d.matchType === 'exact' || d.matchType === 'domain'),
  );
  noMsg.hidden = validDomains.length > 0;
  list.innerHTML = '';
  for (const d of validDomains) {
    const li = document.createElement('li');
    const labelSpan = document.createElement('span');
    labelSpan.textContent = d.matchType === 'exact'
      ? getMessage('trust_exact_match_label', [d.value])
      : getMessage('trust_domain_label', [d.value]);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = getMessage('btn_remove');
    removeBtn.dataset.value = d.value;
    removeBtn.dataset.matchType = d.matchType ?? '';
    removeBtn.addEventListener('click', onRemoveTrustedDomain);
    li.append(labelSpan, ' ', removeBtn);

    if (d.matchType === 'exact') {
      const promotable = getPromotableRegistrableDomain(d.value, validDomains);
      if (promotable) {
        const promoteBtn = document.createElement('button');
        promoteBtn.type = 'button';
        promoteBtn.className = 'trust-promote-btn';
        promoteBtn.textContent = getMessage('trust_promote_btn', [promotable]);
        promoteBtn.dataset.registrableDomain = promotable;
        promoteBtn.title = `Add ${promotable} as a registrable-domain trust entry. This will trust all subdomains of ${promotable}, not just ${d.value}.`;
        promoteBtn.addEventListener('click', onPromoteToDomainTrust);
        li.append(' ', promoteBtn);
      }
    }

    list.append(li);
  }
}

async function onRemoveTrustedDomain(e) {
  const { value, matchType } = e.target.dataset;
  const next = await updateStorage(data => ({
    ...data,
    trustedDomains: data.trustedDomains.filter(
      d => !(d && typeof d === 'object' && d.value === value && d.matchType === matchType),
    ),
  }));
  renderTrustedDomains(next.trustedDomains);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
  // Re-render candidates: previously hidden entries may become visible
  // now that this trusted entry is gone.
  renderCandidates(next.candidates);
}

async function onPromoteToDomainTrust(e) {
  const registrableDomain = e.target.dataset.registrableDomain;
  if (!registrableDomain) return;
  const next = await updateStorage(data => {
    if (data.trustedDomains.some(
      d => d && typeof d === 'object' && d.value === registrableDomain && d.matchType === 'domain',
    )) return data;
    return {
      ...data,
      trustedDomains: [...data.trustedDomains, { value: registrableDomain, matchType: 'domain' }],
      candidates: data.candidates.filter(c => c.registrableDomain !== registrableDomain),
    };
  });
  renderTrustedDomains(next.trustedDomains);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
  renderCandidates(next.candidates);
}

/**
 * Render untrusted candidates grouped by registrable domain. Each group offers:
 *   - A registrable-domain trust option (trusts the domain and all its subdomains).
 *   - Individual exact-host trust checkboxes and Remove buttons per candidate.
 */
function renderCandidates(candidates) {
  const container = $('candidate-list');
  container.innerHTML = '';

  // Filter to well-formed entries to avoid breaking the options page.
  const validCandidates = candidates.filter(
    c => c && typeof c.authservId === 'string',
  );

  if (validCandidates.length === 0) {
    const p = document.createElement('p');
    p.textContent = getMessage('candidates_none');
    container.append(p);
    return;
  }

  const grouped = new Map();
  for (const c of validCandidates) {
    if (!grouped.has(c.registrableDomain)) grouped.set(c.registrableDomain, []);
    grouped.get(c.registrableDomain).push(c);
  }

  for (const [registrableDomain, group] of grouped) {
    const section = document.createElement('div');
    section.className = 'candidate-group';
    const heading = document.createElement('p');
    heading.className = 'candidate-group-domain';
    heading.textContent = registrableDomain;
    section.append(heading);

    // Registrable-domain trust option (one per group).
    if (registrableDomain) {
      const domainRow = document.createElement('div');
      domainRow.className = 'candidate-row candidate-domain-row';
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.registrableDomain = registrableDomain;
      cb.addEventListener('change', onTrustCandidateDomain);
      label.append(cb, ` ${getMessage('candidate_trust_domain', [registrableDomain])}`);
      domainRow.append(label);
      section.append(domainRow);
    }

    for (const candidate of group) {
      const row = document.createElement('div');
      row.className = 'candidate-row';
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.authservId = candidate.authservId;
      cb.addEventListener('change', onTrustCandidateExact);
      label.append(cb, ` ${getMessage('candidate_exact_match', [candidate.authservId])}`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = getMessage('btn_remove');
      btn.dataset.authservId = candidate.authservId;
      btn.addEventListener('click', onRemoveCandidate);
      row.append(label, btn);
      section.append(row);
    }
    container.append(section);
  }
}

/**
 * Render score settings inputs. Builds the auth-score table once on first call,
 * then populates values on subsequent calls (e.g. after reset).
 */
function renderScoreSettings(settings) {
  const container = $('auth-score-inputs');

  // Build the table only once.
  if (!container.querySelector('table')) {
    const table = document.createElement('table');
    table.className = 'score-settings-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [getMessage('score_col_result'), getMessage('score_col_score'), getMessage('score_col_default')].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const { method, result, label } of AUTH_SCORE_FIELDS) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      const tdInput = document.createElement('td');
      const tdDefault = document.createElement('td');
      tdLabel.textContent = label;
      const authTooltip = localizedSummaryForKey(`auth.${method}.${result}`);
      if (authTooltip) tdLabel.title = authTooltip;
      const input = document.createElement('input');
      input.type = 'number';
      input.id = scoreInputId(method, result);
      input.min = -200;
      input.max = 500;
      input.step = 1;
      input.addEventListener('change', saveAuthScores);
      tdInput.append(input);
      tdDefault.className = 'score-default';
      tdDefault.textContent = DEFAULT_AUTH_SCORES[method]?.[result] ?? 0;
      tr.append(tdLabel, tdInput, tdDefault);
      tbody.append(tr);
    }
    table.append(tbody);
    container.append(table);
  }

  // Populate current auth score values.
  for (const { method, result } of AUTH_SCORE_FIELDS) {
    const input = $(scoreInputId(method, result));
    if (input) input.value = settings.authScores?.[method]?.[result] ?? 0;
  }

  // Build the Layer 2 table once.
  const layer2Container = $('layer2-score-inputs');
  if (!layer2Container.querySelector('table')) {
    const table = document.createElement('table');
    table.className = 'score-settings-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [getMessage('score_col_signal'), getMessage('score_col_score'), getMessage('score_col_default')].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const { key, id } of LAYER2_SCORE_FIELDS) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      const tdInput = document.createElement('td');
      const tdDefault = document.createElement('td');
      tdLabel.textContent = localizedTitleForKey(`identity.${key}`);
      const l2Tooltip = localizedSummaryForKey(`identity.${key}`);
      if (l2Tooltip) tdLabel.title = l2Tooltip;
      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.min = 0;
      input.max = 500;
      input.step = 1;
      input.addEventListener('change', saveLayer2Scores);
      tdInput.append(input);
      tdDefault.className = 'score-default';
      tdDefault.textContent = DEFAULT_LAYER2_SCORES[key];
      tr.append(tdLabel, tdInput, tdDefault);
      tbody.append(tr);
    }
    table.append(tbody);
    layer2Container.append(table);
  }

  // Populate current Layer 2 values.
  const l2s = settings.layer2Scores ?? DEFAULT_LAYER2_SCORES;
  for (const { key, id } of LAYER2_SCORE_FIELDS) {
    const input = $(id);
    if (input) input.value = l2s[key] ?? DEFAULT_LAYER2_SCORES[key];
  }

  // Build the Layer 3 table once.
  const heuristicContainer = $('heuristic-score-inputs');
  if (!heuristicContainer.querySelector('table')) {
    const table = document.createElement('table');
    table.className = 'score-settings-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [getMessage('score_col_signal'), getMessage('score_col_score'), getMessage('score_col_default')].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const { key, id } of HEURISTIC_SCORE_FIELDS) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      const tdInput = document.createElement('td');
      const tdDefault = document.createElement('td');
      tdLabel.textContent = localizedTitleForKey(`heuristic.${key}`);
      const heuristicTooltip = localizedSummaryForKey(`heuristic.${key}`);
      if (heuristicTooltip) tdLabel.title = heuristicTooltip;
      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.min = 0;
      input.max = 500;
      input.step = 1;
      input.addEventListener('change', saveHeuristicScores);
      tdInput.append(input);
      tdDefault.className = 'score-default';
      tdDefault.textContent = DEFAULT_HEURISTIC_SCORES[key];
      tr.append(tdLabel, tdInput, tdDefault);
      tbody.append(tr);
    }
    table.append(tbody);
    heuristicContainer.append(table);
  }

  // Populate current Layer 3 values.
  const hs = settings.heuristicScores ?? DEFAULT_HEURISTIC_SCORES;
  for (const { key, id } of HEURISTIC_SCORE_FIELDS) {
    const input = $(id);
    if (input) input.value = hs[key] ?? DEFAULT_HEURISTIC_SCORES[key];
  }

  // Show L3 cap warning when the cap is at or above the Review threshold.
  const capWarning = $('layer3-cap-warning');
  if (capWarning) {
    const capValue = hs.layer3Cap ?? DEFAULT_HEURISTIC_SCORES.layer3Cap;
    capWarning.hidden = capValue < 50;
  }

  // Build the Layer 4 table once.
  const compositeContainer = $('composite-score-inputs');
  if (!compositeContainer.querySelector('table')) {
    const table = document.createElement('table');
    table.className = 'score-settings-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [getMessage('score_col_rule'), getMessage('score_col_score'), getMessage('score_col_default')].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const { key, id, min = 0, mitigation = false } of COMPOSITE_SCORE_FIELDS) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      const tdInput = document.createElement('td');
      const tdDefault = document.createElement('td');
      tdLabel.textContent = localizedTitleForKey(`composite.${key}`);
      const compositeTooltip = localizedTooltipForKey(`composite.${key}`);
      if (compositeTooltip) tdLabel.title = compositeTooltip;
      if (mitigation) {
        const badge = document.createElement('span');
        badge.className = 'score-mitigation-badge';
        badge.textContent = getMessage('score_mitigation_badge');
        tdLabel.append(' ', badge);
      }
      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.min = min;
      input.max = 500;
      input.step = 1;
      input.addEventListener('change', saveCompositeScores);
      tdInput.append(input);
      tdDefault.className = 'score-default';
      tdDefault.textContent = DEFAULT_COMPOSITE_SCORES[key];
      tr.append(tdLabel, tdInput, tdDefault);
      tbody.append(tr);
    }
    table.append(tbody);
    compositeContainer.append(table);
  }

  // Populate current Layer 4 values.
  const cs = settings.compositeScores ?? DEFAULT_COMPOSITE_SCORES;
  for (const { key, id } of COMPOSITE_SCORE_FIELDS) {
    const input = $(id);
    if (input) input.value = cs[key] ?? DEFAULT_COMPOSITE_SCORES[key];
  }
}

function renderSenderRules(rules) {
  const tbody = $('sender-rule-body');
  tbody.innerHTML = '';
  for (const rule of rules) {
    const tr = document.createElement('tr');
    const tdDomain = document.createElement('td');
    const tdMatch = document.createElement('td');
    const tdScore = document.createElement('td');
    const tdAction = document.createElement('td');
    tdDomain.textContent = rule.domain;
    tdMatch.textContent = rule.matchType;
    tdScore.textContent = rule.score;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = getMessage('btn_remove');
    btn.dataset.domain = rule.domain;
    btn.addEventListener('click', onRemoveSenderRule);
    tdAction.append(btn);
    tr.append(tdDomain, tdMatch, tdScore, tdAction);
    tbody.append(tr);
  }
}

/**
 * Render Layer 2 alignment metrics as a collapsed <details> element.
 * Shows From domain, DMARC/SPF/DKIM results with their identity properties,
 * and a summary of whether any auth method aligns with the From domain.
 *
 * @param {object} metrics - The alignmentMetrics object from a log entry.
 * @returns {HTMLElement}
 */
function renderAlignmentMetrics(metrics) {
  const details = document.createElement('details');
  details.className = 'alignment-details';
  const summary = document.createElement('summary');
  summary.textContent = getMessage('metrics_alignment_summary');
  details.append(summary);

  const table = document.createElement('table');
  table.className = 'alignment-table';
  const tbody = document.createElement('tbody');

  // Helper: add a row with a label cell and one or more data cells.
  function addRow(label, ...cells) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    tr.append(th);
    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text ?? '—';
      tr.append(td);
    });
    tbody.append(tr);
  }

  // From domain row.
  const f = metrics.from;
  if (f) {
    const domainInfo = f.registrableDomain && f.registrableDomain !== f.domain
      ? `${f.domain} (${f.registrableDomain})`
      : (f.domain ?? '—');
    addRow('from', domainInfo);
  }

  // DMARC row.
  if (metrics.dmarc) {
    const d = metrics.dmarc;
    const hf = d.headerFrom
      ? (d.headerFromRegistrableDomain && d.headerFromRegistrableDomain !== d.headerFrom
          ? `${d.headerFrom} (${d.headerFromRegistrableDomain})`
          : d.headerFrom)
      : null;
    addRow('dmarc', d.result, hf ? `header.from: ${hf}` : null);
  }

  // SPF row.
  if (metrics.spf) {
    const s = metrics.spf;
    let domainInfo = null;
    if (s.smtpMailFromDomain) {
      domainInfo = s.smtpMailFromRegistrableDomain && s.smtpMailFromRegistrableDomain !== s.smtpMailFromDomain
        ? `smtp.mailfrom: ${s.smtpMailFrom} → ${s.smtpMailFromDomain} (${s.smtpMailFromRegistrableDomain})`
        : `smtp.mailfrom: ${s.smtpMailFrom}`;
    }
    addRow('spf', s.result, domainInfo, `aligned: ${s.alignedWithFrom ? 'yes' : 'no'}`);
  }

  // DKIM rows (one per signature).
  for (const dk of metrics.dkim ?? []) {
    const domainInfo = dk.domain
      ? (dk.registrableDomain && dk.registrableDomain !== dk.domain
          ? `d: ${dk.domain} (${dk.registrableDomain})`
          : `d: ${dk.domain}`)
      : null;
    addRow('dkim', dk.result, domainInfo, `aligned: ${dk.alignedWithFrom ? 'yes' : 'no'}`);
  }

  // Summary row.
  if (metrics.summary) {
    const sm = metrics.summary;
    const parts = [
      `spf: ${sm.spfAligned ? 'yes' : 'no'}`,
      `dkim: ${sm.anyDkimAligned ? 'yes' : 'no'}`,
      `any: ${sm.anyAuthAligned ? 'yes' : 'no'}`,
    ];
    addRow('aligned', parts.join(' · '));
  }

  table.append(tbody);
  details.append(table);
  return details;
}

/**
 * Format a compact summary string for lexical metrics (shown as extra column).
 * Recommended visible fields: digit ratio, normalized entropy, repeated run,
 * unique ratio, letter/digit transitions, hex-like flag.
 *
 * @param {object} lm - lexicalMetrics object
 * @returns {string}
 */
function formatLexicalSummary(lm) {
  const parts = [
    `dig:${lm.digitRatio}`,
    `nH:${lm.normalizedEntropy}`,
    `rep:${lm.maxRepeatedCharRun}`,
    `uniq:${lm.uniqueCharRatio}`,
    `tr:${lm.letterDigitTransitionCount}`,
  ];
  if (lm.hasLongHexLikeRun) parts.push('hex');
  return parts.join(' ');
}

/**
 * Render Layer 3 heuristic metrics as a collapsed <details> element.
 * Displays local-part metrics and per-label domain metrics in a compact table.
 *
 * @param {object} metrics - The heuristicMetrics object from a log entry.
 * @returns {HTMLElement}
 */
function renderHeuristicMetrics(metrics) {
  const details = document.createElement('details');
  details.className = 'metrics-details';
  const summary = document.createElement('summary');
  summary.textContent = getMessage('metrics_heuristic_summary');
  details.append(summary);

  const table = document.createElement('table');
  table.className = 'metrics-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['', 'len', 'entropy', 'vowel%', 'max consonant run', 'extra'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');

  // From domain: PSL decomposition row.
  if (metrics.fromDomain) {
    const fd = metrics.fromDomain;
    const dp = fd.domainParts;
    const tr = document.createElement('tr');
    const cells = [
      `domain: ${fd.value}`,
      `reg: ${dp.registrableDomain ?? '—'}`,
      `suffix: ${dp.publicSuffix ?? '—'}`,
      `sub: ${dp.subdomain ?? '—'} (depth ${dp.subdomainDepth})`,
      [dp.isIcann ? 'icann' : null, dp.isPrivate ? 'private' : null].filter(Boolean).join(' ') || '—',
      '', // extra column — no lexical metrics for the PSL decomposition row
    ];
    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    });
    tbody.append(tr);
  }

  // Local part row.
  if (metrics.fromLocalPart) {
    const m = metrics.fromLocalPart;
    const tr = document.createElement('tr');
    const cells = [
      `local: ${m.value}`,
      m.length,
      m.entropy,
      m.vowelRatio,
      m.maxConsonantRun,
    ];
    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    });
    if (m.lexicalMetrics) {
      const td = document.createElement('td');
      td.textContent = formatLexicalSummary(m.lexicalMetrics);
      tr.append(td);
    }
    tbody.append(tr);
  }

  // Domain label rows.
  for (const m of metrics.fromDomainLabels ?? []) {
    const tr = document.createElement('tr');
    const cells = [
      `label: ${m.label}`,
      m.length,
      m.entropy,
      m.vowelRatio,
      m.maxConsonantRun,
    ];
    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    });
    if (m.lexicalMetrics) {
      const td = document.createElement('td');
      td.textContent = formatLexicalSummary(m.lexicalMetrics);
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(tbody);
  details.append(table);
  return details;
}

/**
 * Build the two TR elements (main row + reason detail row) for one decision log
 * entry. Kept pure so it can be called incrementally when the user expands the
 * visible batch without re-rendering already-visible rows.
 *
 * @param {object} entry
 * @param {object} scoreParams  Pre-resolved score settings object.
 * @returns {[HTMLTableRowElement, HTMLTableRowElement]}
 */
function createLogEntryRows(entry, scoreParams) {
  const { authScores, heuristicScores, layer2Scores, compositeScores, whitelistMitigationScore, addressBookMitigationScore } = scoreParams;

  // — Main row —
  const tr = document.createElement('tr');
  const tdTime = document.createElement('td');
  const tdDomain = document.createElement('td');
  const tdOriginal = document.createElement('td');
  const tdCurrent = document.createElement('td');
  const tdAction = document.createElement('td');

  tdTime.textContent = new Date(entry.timestamp).toLocaleString();
  tdDomain.textContent = entry.fromDomain;
  tdAction.textContent = entry.action;

  const originalClass = entry.classification ?? classifyScore(entry.score);
  tdOriginal.textContent = `${entry.score} (${originalClass})`;

  let reasons = null;
  if (Array.isArray(entry.scoreReasons)) {
    reasons = recalculateScoreReasons(entry, { authScores, heuristicScores, layer2Scores, compositeScores, whitelistMitigationScore, addressBookMitigationScore });
    const currentScore = sumCurrentDeltas(reasons, heuristicScores);
    const currentClass = classifyScore(currentScore);
    tdCurrent.textContent = `${currentScore} (${currentClass})`;
    if (originalClass !== currentClass) tr.className = 'classification-changed';
  } else {
    tdCurrent.textContent = '—';
  }

  tr.append(tdTime, tdDomain, tdOriginal, tdCurrent, tdAction);

  // — Reason detail row (always present; spans all columns) —
  const reasonTr = document.createElement('tr');
  reasonTr.className = 'reason-row';
  const reasonTd = document.createElement('td');
  reasonTd.colSpan = 5;

  if (reasons === null) {
    const p = document.createElement('p');
    p.className = 'reason-empty';
    p.textContent = getMessage('log_no_reasons');
    reasonTd.append(p);
  } else {
    const topSummary = buildTopReasonsSummary(reasons);
    if (topSummary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'reason-top-summary';
      summaryP.textContent = topSummary;
      reasonTd.append(summaryP);
    }

    const details = document.createElement('details');
    details.className = 'reason-details';
    const summary = document.createElement('summary');
    summary.textContent = reasons.length === 0
      ? getMessage('log_no_reasons_label')
      : (reasons.length === 1
          ? getMessage('log_reasons_one', [String(reasons.length)])
          : getMessage('log_reasons_many', [String(reasons.length)]));
    details.append(summary);

    if (reasons.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'reason-list';
      for (const r of reasons) {
        const li = document.createElement('li');
        li.className = `reason-item${r.deltaChanged ? ' delta-changed' : ''}`;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'reason-label';
        labelSpan.textContent = r.label ?? r.key;

        const keyCode = document.createElement('code');
        keyCode.className = 'reason-key';
        keyCode.textContent = r.key;

        const deltaSpan = document.createElement('span');
        deltaSpan.className = 'reason-delta';
        deltaSpan.textContent = `${formatDelta(r.delta)} → ${formatDelta(r.currentDelta)}`;

        li.append(labelSpan, ' ', keyCode, ' ', deltaSpan);

        // Optional context: varies by reason key.
        //   AR reasons        → authservId
        //   sender.rule       → domain (matchType)
        //   heuristic.random* → matched label + domain
        const ctxParts = [];
        if (r.authservId) ctxParts.push(r.authservId);
        if (r.key === 'heuristic.randomFromDomainLabel') {
          if (r.matchedLabel) ctxParts.push(`matched label: ${r.matchedLabel}`);
          if (r.domain) ctxParts.push(`domain: ${r.domain}`);
        } else if (r.domain) {
          ctxParts.push(`${r.domain} (${r.matchType ?? 'exact'})`);
        }
        if (ctxParts.length > 0) {
          const ctxSpan = document.createElement('span');
          ctxSpan.className = 'reason-context';
          ctxSpan.textContent = ' · ' + ctxParts.join(' · ');
          li.append(ctxSpan);
        }

        ul.append(li);
      }
      details.append(ul);
    }
    reasonTd.append(details);
  }

  // — Heuristic metrics (collapsed, secondary) —
  if (entry.heuristicMetrics) {
    reasonTd.append(renderHeuristicMetrics(entry.heuristicMetrics));
  }

  // — Alignment metrics (collapsed, secondary) —
  if (entry.alignmentMetrics) {
    reasonTd.append(renderAlignmentMetrics(entry.alignmentMetrics));
  }

  // — Formula diagnostics (collapsed, secondary) —
  if (Array.isArray(entry.formulaDiagnostics) && entry.formulaDiagnostics.length > 0) {
    reasonTd.append(renderFormulaDiagnostics(entry.formulaDiagnostics));
  }

  reasonTr.append(reasonTd);
  return [tr, reasonTr];
}

/**
 * Build a "Show older entries" TR and attach a click handler that appends only
 * the next batch of rows without re-rendering the already-visible rows.
 *
 * @param {Array}            log
 * @param {object}           scoreParams
 * @param {HTMLElement|null} countEl
 * @param {HTMLElement}      tbody
 * @returns {HTMLTableRowElement}
 */
function createShowOlderRow(log, scoreParams, countEl, tbody) {
  const batchSize = Math.min(LOG_RENDER_INCREMENT, log.length - logCurrentLimit);

  const olderTr = document.createElement('tr');
  olderTr.className = 'log-show-more-row';
  const olderTd = document.createElement('td');
  olderTd.colSpan = 5;
  const olderBtn = document.createElement('button');
  olderBtn.type = 'button';
  olderBtn.textContent = getMessage('btn_show_older', [String(batchSize)]);
  olderBtn.addEventListener('click', () => {
    const prevLimit = logCurrentLimit;
    logCurrentLimit += LOG_RENDER_INCREMENT;
    olderTr.remove();
    for (const entry of log.slice(prevLimit, logCurrentLimit)) {
      tbody.append(...createLogEntryRows(entry, scoreParams));
    }
    const shownCount = Math.min(logCurrentLimit, log.length);
    const newHasMore = logHasMore(log.length, shownCount);
    if (countEl) {
      countEl.textContent = newHasMore
        ? getMessage('log_count_showing', [String(log.length), String(shownCount)])
        : getMessage('log_count_all', [String(log.length)]);
    }
    if (newHasMore) {
      tbody.append(createShowOlderRow(log, scoreParams, countEl, tbody));
    }
  });
  olderTd.append(olderBtn);
  olderTr.append(olderTd);
  return olderTr;
}

/**
 * Render the decision log with original/current scores and expandable reason details.
 *
 * Each log entry renders as two <tr> elements:
 *   1. Main row   — Time | From domain | Original | Current | Action
 *   2. Detail row — <details> with per-reason deltas (original → current)
 *
 * Rows where the recalculated classification differs are highlighted with
 * .classification-changed. Reasons whose delta changed are marked .delta-changed.
 * Legacy entries without scoreReasons show "No reason details available."
 *
 * Only the most recent `logCurrentLimit` entries are rendered initially. Clicking
 * "Show older entries" appends only the next batch without re-rendering existing rows.
 *
 * @param {Array}  log
 * @param {object} [settings]
 */
function renderDecisionLog(log, settings = {}) {
  const countEl = $('log-count');
  const visibleEntries = sliceRecentLog(log, logCurrentLimit);
  const hasMore = logHasMore(log.length, visibleEntries.length);
  if (countEl) {
    countEl.textContent = hasMore
      ? getMessage('log_count_showing', [String(log.length), String(visibleEntries.length)])
      : getMessage('log_count_all', [String(log.length)]);
  }

  const tbody = $('log-body');
  tbody.innerHTML = '';

  const scoreParams = {
    authScores: settings.authScores ?? DEFAULT_AUTH_SCORES,
    heuristicScores: settings.heuristicScores,
    layer2Scores: settings.layer2Scores ?? DEFAULT_LAYER2_SCORES,
    compositeScores: settings.compositeScores ?? DEFAULT_COMPOSITE_SCORES,
    whitelistMitigationScore: settings.whitelistMitigationScore ?? DEFAULT_WHITELIST_MITIGATION,
    addressBookMitigationScore: settings.addressBookMitigationScore ?? DEFAULT_ADDRESS_BOOK_MITIGATION,
  };

  for (const entry of visibleEntries) {
    tbody.append(...createLogEntryRows(entry, scoreParams));
  }

  // "Show older entries" row — appended after entries so expansion grows downward.
  if (hasMore) {
    tbody.append(createShowOlderRow(log, scoreParams, countEl, tbody));
  }
}

async function onRemoveCandidate(e) {
  const authservId = e.target.dataset.authservId;
  const next = await updateStorage(data => ({
    ...data,
    candidates: data.candidates.filter(
      c => !(c && c.authservId === authservId),
    ),
  }));
  renderCandidates(next.candidates);
}

async function onTrustCandidateExact(e) {
  const authservId = e.target.dataset.authservId;
  if (!authservId || !e.target.checked) return;
  const next = await updateStorage(data => {
    const trustedDomains = [...data.trustedDomains];
    if (!trustedDomains.some(d => d?.value === authservId && d?.matchType === 'exact')) {
      trustedDomains.push({ value: authservId, matchType: 'exact' });
    }
    // Remove this specific candidate; others in the same registrable domain remain.
    const candidates = data.candidates.filter(c => c.authservId !== authservId);
    return { ...data, trustedDomains, candidates };
  });
  renderTrustedDomains(next.trustedDomains);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
  renderCandidates(next.candidates);
}

async function onTrustCandidateDomain(e) {
  const registrableDomain = e.target.dataset.registrableDomain;
  if (!registrableDomain || !e.target.checked) return;
  const next = await updateStorage(data => {
    const trustedDomains = [...data.trustedDomains];
    if (!trustedDomains.some(d => d?.value === registrableDomain && d?.matchType === 'domain')) {
      trustedDomains.push({ value: registrableDomain, matchType: 'domain' });
    }
    // Remove all candidates covered by this registrable-domain trust.
    const candidates = data.candidates.filter(c => c.registrableDomain !== registrableDomain);
    return { ...data, trustedDomains, candidates };
  });
  renderTrustedDomains(next.trustedDomains);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
  renderCandidates(next.candidates);
}

async function onRemoveSenderRule(e) {
  const domain = e.target.dataset.domain;
  const next = await updateStorage(data => ({
    ...data,
    senderDomainRules: data.senderDomainRules.filter(r => r.domain !== domain),
  }));
  renderSenderRules(next.senderDomainRules);
}

function renderWhitelistEntries(entries) {
  const noMsg = $('no-whitelist-msg');
  const table = $('whitelist-table');
  const tbody = $('whitelist-body');
  tbody.innerHTML = '';
  const valid = entries.filter(e => e && typeof e.value === 'string' && e.matchType === 'exact');
  noMsg.hidden = valid.length > 0;
  table.hidden = valid.length === 0;
  for (const entry of valid) {
    const tr = document.createElement('tr');
    const tdAddr = document.createElement('td');
    const tdMatch = document.createElement('td');
    const tdAction = document.createElement('td');
    tdAddr.textContent = entry.value;
    tdMatch.textContent = entry.matchType;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = getMessage('btn_remove');
    btn.dataset.value = entry.value;
    btn.addEventListener('click', onRemoveWhitelistEntry);
    tdAction.append(btn);
    tr.append(tdAddr, tdMatch, tdAction);
    tbody.append(tr);
  }
}

async function onRemoveWhitelistEntry(e) {
  const value = e.target.dataset.value;
  const next = await updateStorage(data => ({
    ...data,
    manualWhitelist: (data.manualWhitelist ?? []).filter(
      entry => !(entry && entry.value === value && entry.matchType === 'exact'),
    ),
  }));
  renderWhitelistEntries(next.manualWhitelist ?? []);
}

async function saveWhitelistMitigationScore() {
  const raw = Number($('whitelist-mitigation-score').value);
  const bounded = Math.max(-100, Math.min(0, raw));
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, whitelistMitigationScore: bounded },
  }));
  // Re-render the log immediately so the user sees recalculated scores while tuning.
  renderDecisionLog(next.decisionLog, next.settings);
}

async function onAddWhitelistFormSubmit(e) {
  e.preventDefault();
  const raw = $('add-whitelist-address').value.trim().toLowerCase();
  const errorEl = $('add-whitelist-error');

  if (!raw || !raw.includes('@') || raw.startsWith('@') || raw.endsWith('@')) {
    errorEl.textContent = getMessage('whitelist_email_invalid');
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  let addError = null;
  const next = await updateStorage(d => {
    const list = d.manualWhitelist ?? [];
    if (list.length >= MAX_WHITELIST_ENTRIES) {
      addError = getMessage('whitelist_full', [String(MAX_WHITELIST_ENTRIES)]);
      return d;
    }
    if (list.some(entry => entry && entry.value === raw && entry.matchType === 'exact')) {
      addError = getMessage('whitelist_already_exists');
      return d;
    }
    return { ...d, manualWhitelist: [...list, { value: raw, matchType: 'exact' }] };
  });
  if (addError) {
    errorEl.textContent = addError;
    errorEl.hidden = false;
    return;
  }
  $('add-whitelist-address').value = '';
  renderWhitelistEntries(next.manualWhitelist ?? []);
}

function updateNotificationOptionsDisabled(enabled) {
  const container = $('notification-options');
  const inputs = container.querySelectorAll('input');
  inputs.forEach(input => { input.disabled = !enabled; });
}

async function saveSettings() {
  const notifyEnabled = $('notify-after-assessment').checked;
  updateNotificationOptionsDisabled(notifyEnabled);
  await updateStorage(data => ({
    ...data,
    settings: {
      ...data.settings,
      moveToReview: $('move-to-review').checked,
      moveHighRiskToJunk: $('move-high-risk-to-junk').checked,
      notifyAfterAssessment: notifyEnabled,
      notificationMaxScore: Number($('notification-max-score').value),
      notificationMinIntervalMs: Number($('notification-min-interval').value),
    },
  }));
}

async function saveNotificationOptions() {
  await updateStorage(data => ({
    ...data,
    settings: {
      ...data.settings,
      notificationMaxScore: Number($('notification-max-score').value),
      notificationMinIntervalMs: Number($('notification-min-interval').value),
    },
  }));
}

async function saveReviewFolderForAccount(accountId, folderId) {
  await updateStorage(data => {
    const reviewFolders = { ...(data.settings?.reviewFolders ?? {}) };
    if (folderId) {
      reviewFolders[accountId] = folderId;
    } else {
      delete reviewFolders[accountId];
    }
    return { ...data, settings: { ...data.settings, reviewFolders } };
  });
}

async function saveAuthScores() {
  const authScores = {};
  for (const { method, result } of AUTH_SCORE_FIELDS) {
    if (!authScores[method]) authScores[method] = {};
    const input = $(scoreInputId(method, result));
    authScores[method][result] = input ? Number(input.value) : 0;
  }
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, authScores },
  }));
  // Re-render the log immediately so the user sees recalculated scores while tuning.
  renderDecisionLog(next.decisionLog, next.settings);
}

async function saveHeuristicScores() {
  const heuristicScores = {};
  for (const { key, id } of HEURISTIC_SCORE_FIELDS) {
    const input = $(id);
    heuristicScores[key] = input ? Number(input.value) : DEFAULT_HEURISTIC_SCORES[key];
  }
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, heuristicScores },
  }));
  // Update L3 cap warning live as the user edits.
  const capWarning = $('layer3-cap-warning');
  if (capWarning) capWarning.hidden = (heuristicScores.layer3Cap ?? DEFAULT_HEURISTIC_SCORES.layer3Cap) < 50;
  // Re-render the log immediately so the user sees recalculated scores while tuning.
  renderDecisionLog(next.decisionLog, next.settings);
}

async function saveLayer2Scores() {
  const layer2Scores = {};
  for (const { key, id } of LAYER2_SCORE_FIELDS) {
    const input = $(id);
    layer2Scores[key] = input ? Number(input.value) : DEFAULT_LAYER2_SCORES[key];
  }
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, layer2Scores },
  }));
  renderDecisionLog(next.decisionLog, next.settings);
}

async function saveCompositeScores() {
  const compositeScores = {};
  for (const { key, id } of COMPOSITE_SCORE_FIELDS) {
    const input = $(id);
    compositeScores[key] = input ? Number(input.value) : DEFAULT_COMPOSITE_SCORES[key];
  }
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, compositeScores },
  }));
  renderDecisionLog(next.decisionLog, next.settings);
}

async function loadAddressBookWhitelistSettings(settings) {
  const enabled = settings.addressBookWhitelistEnabled ?? false;
  $('address-book-whitelist-enabled').checked = enabled;
  $('address-book-mitigation-score').value = settings.addressBookMitigationScore ?? DEFAULT_ADDRESS_BOOK_MITIGATION;
  updateAddressBookWhitelistOptionsDisabled(enabled);
}

function updateAddressBookWhitelistOptionsDisabled(enabled) {
  $('address-book-whitelist-options').querySelectorAll('input').forEach(input => {
    input.disabled = !enabled;
  });
}

async function saveAddressBookWhitelistEnabled() {
  const enabled = $('address-book-whitelist-enabled').checked;
  if (enabled) {
    let granted = false;
    try {
      granted = await browser.permissions.request({ permissions: ['addressBooks'] });
    } catch {
      granted = false;
    }
    if (!granted) {
      $('address-book-whitelist-enabled').checked = false;
      return;
    }
  }
  if (!enabled) {
    try {
      await browser.permissions.remove({ permissions: ['addressBooks'] });
    } catch {
      // ignore — permission may already be absent
    }
  }
  updateAddressBookWhitelistOptionsDisabled(enabled);
  await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, addressBookWhitelistEnabled: enabled },
  }));
}

async function saveAddressBookMitigationScore() {
  const raw = Number($('address-book-mitigation-score').value);
  const bounded = Math.max(-100, Math.min(0, raw));
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, addressBookMitigationScore: bounded },
  }));
  renderDecisionLog(next.decisionLog, next.settings);
}

async function saveDiagnosticsMode() {
  const enabled = $('diagnostics-mode-enabled').checked;
  updateDiagnosticsTabVisibility(enabled);
  await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, diagnosticsMode: enabled },
  }));
}

async function resetAuthScores() {
  const next = await updateStorage(data => ({
    ...data,
    settings: {
      ...data.settings,
      authScores: DEFAULT_AUTH_SCORES,
      heuristicScores: DEFAULT_HEURISTIC_SCORES,
      layer2Scores: DEFAULT_LAYER2_SCORES,
      compositeScores: DEFAULT_COMPOSITE_SCORES,
      scoreDefaultsVersion: SCORE_DEFAULTS_VERSION,
    },
  }));
  renderScoreSettings(next.settings);
  renderDecisionLog(next.decisionLog, next.settings);
}

async function resetLayer2Scores() {
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, layer2Scores: DEFAULT_LAYER2_SCORES },
  }));
  renderScoreSettings(next.settings);
  renderDecisionLog(next.decisionLog, next.settings);
}

async function resetLayer3Scores() {
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, heuristicScores: DEFAULT_HEURISTIC_SCORES },
  }));
  renderScoreSettings(next.settings);
  renderDecisionLog(next.decisionLog, next.settings);
}

async function resetLayer4Scores() {
  const next = await updateStorage(data => ({
    ...data,
    settings: { ...data.settings, compositeScores: DEFAULT_COMPOSITE_SCORES },
  }));
  renderScoreSettings(next.settings);
  renderDecisionLog(next.decisionLog, next.settings);
}

async function saveDnsSettings() {
  const dnsEnabled = $('setup-hint-dns-enabled').checked;
  $('setup-hint-dns-resolver').disabled = !dnsEnabled;
  await updateStorage(data => ({
    ...data,
    settings: {
      ...data.settings,
      setupHints: {
        ...(data.settings?.setupHints ?? {}),
        dnsLookupEnabled: dnsEnabled,
        dnsResolver: $('setup-hint-dns-resolver').value || '8.8.8.8',
      },
    },
  }));
  renderSetupAssistant();
}

async function clearLog() {
  logCurrentLimit = LOG_RENDER_LIMIT;
  const next = await updateStorage(data => ({ ...data, decisionLog: [] }));
  renderDecisionLog(next.decisionLog, next.settings);
  renderActivitySummary(next.decisionLog);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
}

/**
 * Resolve a single log entry's current folder at export time.
 * Looks up the RFC Message-ID via browser.messages.query (offline, local only).
 * Always resolves — never rejects — so a single lookup failure does not abort
 * the entire export.
 *
 * @param {object}      entry           - Decision log entry (may lack messageIdentity).
 * @param {Set<string>} reviewFolderIds - Configured review folder IDs from settings.
 * @returns {Promise<object>} entry with exportState appended.
 */
async function resolveExportState(entry, reviewFolderIds) {
  const rfcMessageId = entry.messageIdentity?.rfcMessageId ?? null;

  if (!rfcMessageId) {
    return { ...entry, exportState: buildUnknownExportState('no_message_id') };
  }

  const queryValues = buildHeaderMessageIdQueryValues(rfcMessageId);
  const initialAccountId = entry.messageIdentity?.initialAccountId ?? null;

  const seenIds = new Set();
  const allMessages = [];
  let anyQuerySucceeded = false;

  for (const headerMessageId of queryValues) {
    try {
      const result = await browser.messages.query({ headerMessageId });
      anyQuerySucceeded = true;
      for (const msg of result?.messages ?? []) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          allMessages.push(msg);
        }
      }
    } catch {
      // per-variant failure; continue with remaining variants
    }
  }

  if (allMessages.length === 0) {
    const reason = anyQuerySucceeded ? 'not_found_by_message_id' : 'lookup_error';
    return { ...entry, exportState: buildUnknownExportState(reason) };
  }

  const best = chooseBestMessageQueryResult(allMessages, initialAccountId);
  const folder = best.folder ?? null;
  const junk = typeof best.junk === 'boolean' ? best.junk : null;
  const exportState = {
    found: true,
    currentAccountId: folder?.accountId ?? null,
    currentFolderId:   folder?.id        ?? null,
    currentFolderName: folder?.name      ?? null,
    currentFolderPath: folder?.path      ?? null,
    currentFolderType: folder?.type      ?? null,
    currentJunk: junk,
    exportVerdict: deriveExportVerdict(folder, reviewFolderIds, junk),
  };

  if (allMessages.length > 1) {
    exportState.ambiguous = true;
    exportState.matchCount = allMessages.length;
  }

  return { ...entry, exportState };
}

/** Trigger a JSON file download in the options tab. */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Format a Date as YYYYMMDD-HHMMSS (local time). */
function formatTimestamp(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
       + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

async function exportLog() {
  const btn = $('export-log');
  btn.disabled = true;
  btn.textContent = getMessage('btn_exporting');
  try {
    const data = await getStorage();
    const addonVersion = browser.runtime.getManifest().version;

    // Build the set of all configured review folder IDs (across all accounts)
    // so resolveExportState can correctly label them as 'undecided'.
    const reviewFolderIds = new Set(Object.values(data.settings?.reviewFolders ?? {}));

    const entriesWithState = await Promise.all(
      data.decisionLog.map(entry => resolveExportState(entry, reviewFolderIds)),
    );

    const payload = buildExportPayload(data, entriesWithState, addonVersion);
    const filename = `auth-results-filter-log-${formatTimestamp(new Date())}.json`;
    downloadJson(payload, filename);
  } finally {
    btn.disabled = false;
    btn.textContent = getMessage('btn_export_logs');
  }
}

// ─── Score reason key reference ───────────────────────────────────────────────

/**
 * Insert a snippet into the formula expression textarea.
 * If the form is hidden, open it first (new-formula mode).
 */
function insertKeySnippet(snippet) {
  const formWrap = $('custom-formula-form-wrap');
  if (formWrap && formWrap.hidden) {
    openFormulaForm(null);
  }
  const textarea = $('formula-expression');
  if (textarea) {
    textarea.setRangeText(snippet, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.focus();
    textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Layer group definitions for the key reference table. */
const KEY_REF_GROUPS = [
  {
    labelKey: 'key_reference_layer_auth',
    keys: AUTH_SCORE_FIELDS.map(({ method, result }) => `auth.${method}.${result}`),
  },
  {
    labelKey: 'key_reference_layer_identity',
    keys: REGISTRY.filter(e => e.key.startsWith('identity.')).map(e => e.key),
  },
  {
    labelKey: 'key_reference_layer_heuristic',
    keys: REGISTRY.filter(e => e.key.startsWith('heuristic.')).map(e => e.key),
  },
  {
    labelKey: 'key_reference_layer_composite',
    keys: REGISTRY.filter(e => e.key.startsWith('composite.')).map(e => e.key),
  },
  {
    labelKey: 'key_reference_layer_l5',
    keys: REGISTRY.filter(e =>
      e.key.startsWith('whitelist.') || e.key.startsWith('sender.') || e.key.startsWith('authserv.')
    ).map(e => e.key),
  },
];

/**
 * Render the score reason key reference table grouped by layer.
 * Generated from the rule metadata registry.
 */
function renderScoreReasonKeyReference() {
  const container = $('key-reference-container');
  if (!container) return;
  container.innerHTML = '';

  for (const group of KEY_REF_GROUPS) {
    const details = document.createElement('details');
    details.className = 'key-ref-group';

    const summary = document.createElement('summary');
    summary.className = 'key-ref-group-summary';
    summary.textContent = getMessage(group.labelKey);
    details.append(summary);

    const table = document.createElement('table');
    table.className = 'key-ref-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [
      getMessage('key_reference_col_title'),
      getMessage('key_reference_col_key'),
      getMessage('key_reference_col_default'),
      '',
    ].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const key of group.keys) {
      const meta = getRuleMeta(key);
      if (!meta) continue;

      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      tdTitle.textContent = meta.title;
      if (meta.summary) tdTitle.title = meta.summary;

      const tdKey = document.createElement('td');
      const keyCode = document.createElement('code');
      keyCode.className = 'key-ref-key';
      keyCode.textContent = key;
      if (meta.summary) keyCode.title = meta.summary;
      tdKey.append(keyCode);
      if (meta.type === 'mitigation') {
        const badge = document.createElement('span');
        badge.className = 'score-mitigation-badge key-ref-badge';
        badge.textContent = getMessage('score_mitigation_badge');
        tdKey.append(' ', badge);
      }

      const tdDefault = document.createElement('td');
      tdDefault.className = 'key-ref-default';
      if (typeof meta.defaultScore === 'number') {
        tdDefault.textContent = meta.defaultScore > 0 ? `+${meta.defaultScore}` : String(meta.defaultScore);
      } else {
        tdDefault.textContent = '—';
      }

      const tdInsert = document.createElement('td');
      tdInsert.className = 'key-ref-insert-col';

      const hasBtn = document.createElement('button');
      hasBtn.type = 'button';
      hasBtn.className = 'key-ref-insert-btn';
      hasBtn.textContent = getMessage('key_reference_btn_insert_has');
      hasBtn.title = `has("${key}")`;
      hasBtn.addEventListener('click', () => insertKeySnippet(`has("${key}")`));

      const scoreOfBtn = document.createElement('button');
      scoreOfBtn.type = 'button';
      scoreOfBtn.className = 'key-ref-insert-btn';
      scoreOfBtn.textContent = getMessage('key_reference_btn_insert_scoreof');
      scoreOfBtn.title = `scoreOf("${key}")`;
      scoreOfBtn.addEventListener('click', () => insertKeySnippet(`scoreOf("${key}")`));

      tdInsert.append(hasBtn, ' ', scoreOfBtn);

      tr.append(tdTitle, tdKey, tdDefault, tdInsert);
      tbody.append(tr);
    }
    table.append(tbody);
    details.append(table);
    container.append(details);
  }
}

// ─── Custom formula rendering and management ──────────────────────────────────

/** Starter templates available in the formula editor. */
const FORMULA_TEMPLATES = [
  {
    value: 'boost-auth-aligned-random-domain',
    nameKey: 'custom_formula_tpl_boost_rule',
    defaultId: 'boost-auth-aligned-random-domain',
    expression: 'has("composite.authAlignedRandomDomain") ? 30 : 0',
  },
  {
    value: 'deep-random-subdomain',
    nameKey: 'custom_formula_tpl_deep_subdomain',
    defaultId: 'deep-random-subdomain',
    expression: 'from.subdomainDepth >= 2 && from.leftLabelEntropy > 2.4 ? 40 : 0',
  },
  {
    value: 'msgid-mismatch',
    nameKey: 'custom_formula_tpl_msgid_mismatch',
    defaultId: 'msgid-mismatch',
    expression: 'messageId.matchesFromDomain == false && !alignment.anyDkimAligned ? 30 : 0',
  },
  {
    value: 'dkim-aligned-mitigate',
    nameKey: 'custom_formula_tpl_dkim_mitigate',
    defaultId: 'dkim-aligned-mitigate',
    expression: 'alignment.anyDkimAligned ? -20 : 0',
  },
];

/** Populate the template <select> with localized option labels. */
function initFormulaTemplateSelect() {
  const sel = $('formula-template');
  if (!sel) return;
  for (const tpl of FORMULA_TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = tpl.value;
    opt.textContent = getMessage(tpl.nameKey);
    sel.append(opt);
  }
}

/** Insert the selected template into the formula form fields. */
function onInsertTemplate() {
  const sel = $('formula-template');
  if (!sel || !sel.value) return;
  const tpl = FORMULA_TEMPLATES.find(t => t.value === sel.value);
  if (!tpl) return;

  const exprArea = $('formula-expression');
  if (exprArea) exprArea.value = tpl.expression;

  const modeSelect = $('formula-mode');
  if (modeSelect) modeSelect.value = 'observe';

  const idInput = $('formula-id');
  if (idInput && !idInput.disabled && !idInput.value.trim()) idInput.value = tpl.defaultId;

  const nameInput = $('formula-name');
  if (nameInput && !nameInput.value.trim()) nameInput.value = getMessage(tpl.nameKey);

  sel.value = '';
}

/** ID of the formula currently being edited; null when adding a new one. */
let formulaEditingId = null;

/**
 * Render the formula diagnostics table as a collapsed <details> element.
 * Displayed in the decision log for entries that have formulaDiagnostics.
 *
 * @param {Array} diagnostics - formulaDiagnostics from a decision log entry.
 * @returns {HTMLElement}
 */
function renderFormulaDiagnostics(diagnostics) {
  const details = document.createElement('details');
  details.className = 'formula-diag-details';
  const summary = document.createElement('summary');
  summary.textContent = getMessage('custom_formula_diag_summary');
  details.append(summary);

  const table = document.createElement('table');
  table.className = 'formula-diag-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Name', 'Mode', 'Value', 'Applied', 'Would-change score', 'Would-change verdict', 'Error'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const diag of diagnostics) {
    const tr = document.createElement('tr');
    const hasError = Boolean(diag.error);
    const cells = [
      { text: diag.name || diag.id },
      { text: diag.mode },
      { text: hasError ? '—' : String(diag.value ?? '—') },
      {
        text: hasError ? '—' : String(diag.applied),
        cls: hasError ? '' : (diag.applied ? 'formula-diag-applied-yes' : 'formula-diag-applied-no'),
      },
      { text: hasError ? '—' : String(diag.wouldChangeScore ?? '—') },
      { text: hasError ? '—' : (diag.wouldChangeVerdict ?? '—') },
      { text: diag.error ?? '', cls: diag.error ? 'formula-diag-error' : '' },
    ];
    cells.forEach(({ text, cls }) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  details.append(table);
  return details;
}

/**
 * Render the custom formula list and count.
 *
 * @param {Array}          formulas              - Stored formula array from customFormulas.
 * @param {Map<string, object>} lastDiagnostics  - Per-formula most-recent diagnostic result.
 */
function renderCustomFormulas(formulas, lastDiagnostics = new Map()) {
  const container = $('custom-formula-list');
  container.innerHTML = '';

  const countEl = $('custom-formula-count');
  if (countEl) {
    if (formulas.length > 0) {
      countEl.textContent = getMessage('custom_formula_count_all', [String(formulas.length)]);
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }

  if (formulas.length === 0) {
    const p = document.createElement('p');
    p.textContent = getMessage('custom_formula_none');
    container.append(p);
    return;
  }

  for (const formula of formulas) {
    const row = document.createElement('div');
    row.className = 'formula-row';

    const info = document.createElement('div');
    info.className = 'formula-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'formula-name';
    nameSpan.textContent = formula.name || formula.id;

    const modeBadge = document.createElement('span');
    modeBadge.className = `formula-mode-badge formula-mode-${formula.mode}`;
    modeBadge.textContent = formula.mode;

    const exprPreview = document.createElement('code');
    exprPreview.className = 'formula-expr-preview';
    const expr = formula.expression ?? '';
    exprPreview.textContent = expr.length > 80 ? expr.slice(0, 77) + '…' : expr;
    exprPreview.title = expr;

    info.append(nameSpan, ' ', modeBadge, document.createElement('br'), exprPreview);

    // Last diagnostic summary when available.
    const diag = lastDiagnostics.get(formula.id);
    if (diag) {
      const diagNote = document.createElement('p');
      diagNote.className = 'formula-last-diag';
      if (diag.error) {
        diagNote.textContent = `Last result: error — ${diag.error}`;
      } else {
        const parts = [`Last result: ${diag.value}`];
        if (diag.applied) parts.push('applied');
        if (diag.wouldChangeVerdict) parts.push(`→ ${diag.wouldChangeVerdict}`);
        diagNote.textContent = parts.join(' · ');
      }
      info.append(diagNote);
    }

    const actions = document.createElement('div');
    actions.className = 'formula-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = getMessage('btn_edit_formula');
    editBtn.addEventListener('click', () => openFormulaForm(formula));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = getMessage('btn_delete_formula');
    deleteBtn.addEventListener('click', () => onDeleteFormula(formula.id));

    actions.append(editBtn, deleteBtn);
    row.append(info, actions);
    container.append(row);
  }
}

/** Open the add/edit form. Pass null to open in "add" mode. */
/**
 * Build and render insertion chip groups inside #formula-chips-wrap.
 * Clicking a chip inserts its snippet at the current cursor position
 * (or replaces the current selection) in the expression textarea,
 * then returns focus to the textarea.
 *
 * @param {HTMLTextAreaElement} textarea
 */
function renderFormulaChipsWidget(textarea) {
  const wrap = $('formula-chips-wrap');
  if (!wrap || !textarea) return;
  wrap.textContent = '';

  const header = document.createElement('p');
  header.className = 'formula-chips-header';
  header.textContent = getMessage('formula_chips_label');
  wrap.appendChild(header);

  for (const group of CHIP_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'formula-chips-group';

    const groupLabel = document.createElement('span');
    groupLabel.className = 'formula-chips-group-label';
    groupLabel.textContent = getMessage(group.labelKey);
    groupEl.appendChild(groupLabel);

    for (const chip of group.chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'formula-chip';
      btn.textContent = chip.snippet;
      btn.title = getMessage('formula_chip_insert_title');
      btn.addEventListener('click', () => {
        textarea.setRangeText(chip.snippet, textarea.selectionStart, textarea.selectionEnd, 'end');
        textarea.focus();
      });
      groupEl.appendChild(btn);
    }

    wrap.appendChild(groupEl);
  }

  const note = document.createElement('p');
  note.className = 'formula-chips-ref-note';
  note.textContent = getMessage('formula_chips_ref_note');
  wrap.appendChild(note);
}

function openFormulaForm(formula = null) {
  formulaEditingId = formula ? formula.id : null;

  const titleEl = $('custom-formula-form-title');
  if (titleEl) {
    titleEl.textContent = formula
      ? getMessage('custom_formula_edit_title')
      : getMessage('custom_formula_add_title');
  }

  const idInput = $('formula-id');
  if (idInput) {
    idInput.value = formula ? formula.id : '';
    // Stable ID must not be changed after creation.
    idInput.disabled = formula !== null;
  }
  const nameInput = $('formula-name');
  if (nameInput) nameInput.value = formula ? (formula.name ?? '') : '';
  const modeSelect = $('formula-mode');
  if (modeSelect) modeSelect.value = formula ? (formula.mode ?? 'observe') : 'observe';
  const exprArea = $('formula-expression');
  if (exprArea) exprArea.value = formula ? (formula.expression ?? '') : '';
  renderFormulaChipsWidget(exprArea);

  const errorEl = $('custom-formula-error');
  if (errorEl) errorEl.hidden = true;

  $('custom-formula-form-wrap').hidden = false;
  $('custom-formula-add-btn').hidden = true;
}

function closeFormulaForm() {
  formulaEditingId = null;
  $('custom-formula-form-wrap').hidden = true;
  $('custom-formula-add-btn').hidden = false;
  const errorEl = $('custom-formula-error');
  if (errorEl) errorEl.hidden = true;
}

async function onFormulaFormSubmit(e) {
  e.preventDefault();

  const rawId = ($('formula-id').value ?? '').trim();
  const effectiveId = formulaEditingId ?? rawId;
  const name = ($('formula-name').value ?? '').trim();
  const expression = ($('formula-expression').value ?? '').trim();
  const mode = $('formula-mode').value;

  const errorEl = $('custom-formula-error');

  const data = await getStorage();
  const existingFormulas = data.customFormulas ?? [];

  // Check formula list capacity when adding (not when editing).
  if (!formulaEditingId && existingFormulas.length >= MAX_CUSTOM_FORMULAS) {
    errorEl.textContent = getMessage('custom_formula_list_full', [String(MAX_CUSTOM_FORMULAS)]);
    errorEl.hidden = false;
    return;
  }

  const error = validateFormulaFields(effectiveId, name, expression, mode, existingFormulas, formulaEditingId);
  if (error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  const newFormula = { id: effectiveId, name, expression, mode };

  const next = await updateStorage(d => {
    let formulas = d.customFormulas ?? [];
    if (formulaEditingId) {
      formulas = formulas.map(f => f.id === formulaEditingId ? newFormula : f);
    } else {
      formulas = [...formulas, newFormula];
    }
    return { ...d, customFormulas: formulas };
  });

  closeFormulaForm();
  renderCustomFormulas(next.customFormulas ?? [], buildLastFormulaDiagnostics(next.decisionLog));
}

async function onDeleteFormula(id) {
  if (formulaEditingId === id) closeFormulaForm();
  const next = await updateStorage(d => ({
    ...d,
    customFormulas: (d.customFormulas ?? []).filter(f => f.id !== id),
  }));
  renderCustomFormulas(next.customFormulas ?? [], buildLastFormulaDiagnostics(next.decisionLog));
}

// ─── End custom formula management ───────────────────────────────────────────

const ADD_TRUSTED_HINTS = {
  exact: 'Trusts only this specific host. Subdomains are not trusted.',
  domain: 'Trusts this domain and all its subdomains. Use with care — this is broader than exact-host trust.',
};

function onAddTrustedMatchTypeChange() {
  const matchType = $('add-trusted-matchtype').value;
  $('add-trusted-hint').textContent = ADD_TRUSTED_HINTS[matchType] ?? '';
  $('add-trusted-form').dataset.matchtype = matchType;
  $('add-trusted-error').hidden = true;
}

async function onAddTrustedFormSubmit(e) {
  e.preventDefault();
  const value = $('add-trusted-value').value;
  const matchType = $('add-trusted-matchtype').value;
  const errorEl = $('add-trusted-error');

  const data = await getStorage();
  const error = validateTrustedEntry(value, matchType, data.trustedDomains);
  if (error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  const trimmed = value.trim().toLowerCase();
  const newEntry = { value: trimmed, matchType };
  const next = await updateStorage(d => {
    const trustedDomains = [...d.trustedDomains, newEntry];
    const candidates = d.candidates.filter(
      c => !(c && typeof c.authservId === 'string' && isTrustedAuthservId(c.authservId, [newEntry])),
    );
    return { ...d, trustedDomains, candidates };
  });
  $('add-trusted-value').value = '';
  renderTrustedDomains(next.trustedDomains);
  renderProtectionStatus(next.trustedDomains, next.decisionLog);
  renderCandidates(next.candidates);
}

// Tab navigation
const TAB_IDS = ['basic', 'advanced', 'customformulas', 'diagnostics'];

function activateTab(tabId) {
  const safeId = TAB_IDS.includes(tabId) ? tabId : TAB_IDS[0];
  for (const id of TAB_IDS) {
    const panel = document.getElementById(`tab-panel-${id}`);
    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    const active = id === safeId;
    if (panel) panel.classList.toggle('tab-panel-active', active);
    if (btn) btn.setAttribute('aria-selected', String(active));
  }
  try { location.hash = safeId; } catch { /* ignore */ }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

activateTab(TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TAB_IDS[0]);

$('setup-hint-dns-enabled').addEventListener('change', saveDnsSettings);
$('setup-hint-dns-resolver').addEventListener('change', saveDnsSettings);
$('setup-assistant').addEventListener('toggle', () => {
  if ($('setup-assistant').open) renderSetupAssistant();
});

$('add-trusted-matchtype').addEventListener('change', onAddTrustedMatchTypeChange);
$('add-trusted-form').addEventListener('submit', onAddTrustedFormSubmit);

$('move-to-review').addEventListener('change', saveSettings);
$('move-high-risk-to-junk').addEventListener('change', saveSettings);
$('notify-after-assessment').addEventListener('change', saveSettings);
$('notification-max-score').addEventListener('change', saveNotificationOptions);
$('notification-min-interval').addEventListener('change', saveNotificationOptions);
$('reset-auth-scores').addEventListener('click', resetAuthScores);
$('reset-layer2-scores').addEventListener('click', resetLayer2Scores);
$('reset-layer3-scores').addEventListener('click', resetLayer3Scores);
$('reset-layer4-scores').addEventListener('click', resetLayer4Scores);
$('clear-log').addEventListener('click', clearLog);
$('export-log').addEventListener('click', exportLog);
$('whitelist-mitigation-score').addEventListener('change', saveWhitelistMitigationScore);
$('add-whitelist-form').addEventListener('submit', onAddWhitelistFormSubmit);
$('address-book-whitelist-enabled').addEventListener('change', saveAddressBookWhitelistEnabled);
$('address-book-mitigation-score').addEventListener('change', saveAddressBookMitigationScore);
$('diagnostics-mode-enabled').addEventListener('change', saveDiagnosticsMode);

$('custom-formula-add-btn').addEventListener('click', () => openFormulaForm(null));
$('custom-formula-cancel-btn').addEventListener('click', closeFormulaForm);
$('custom-formula-form').addEventListener('submit', onFormulaFormSubmit);
$('formula-insert-template-btn').addEventListener('click', onInsertTemplate);

initFormulaTemplateSelect();
load();
