/**
 * i18n — thin wrapper around browser.i18n.getMessage with English fallbacks.
 *
 * ## How to add a new locale
 *
 *   1. Create src/_locales/<code>/messages.json
 *      Use src/_locales/en/messages.json as the template and translate every
 *      key. Missing keys fall back to English via default_locale, but
 *      test/locales.test.js requires every locale to match the English key set
 *      and placeholders.
 *
 *   2. Rule titles (rule_*_title), summaries (rule_*_summary) and composite
 *      tooltips (rule_composite_*_tooltip) are included; the English values
 *      must stay identical to src/core/ruleRegistry.js.
 *
 *   3. Keep technical protocol names (DMARC, SPF, DKIM, Message-ID) unchanged
 *      unless your locale explicitly needs surrounding explanation. Values that
 *      intentionally match English must be listed in test/locales.test.js.
 *
 *   4. Test by switching Thunderbird to your locale and opening the add-on options.
 */

import { titleForKey, summaryForKey, tooltipForKey } from '../core/ruleRegistry.js';

/**
 * English fallback strings used when browser.i18n is unavailable (e.g. in tests).
 * Keys must match those in src/_locales/en/messages.json.
 * Substitution placeholders use $1, $2, … (positional).
 */
export const FALLBACK_EN = {
  // ── Tabs ──────────────────────────────────────────────────────────────────
  tab_basic: 'Basic',
  tab_advanced: 'Advanced',
  tab_diagnostics: 'Diagnostics',

  // ── Page title ────────────────────────────────────────────────────────────
  page_title: 'Auth Results Filter',

  // ── Section headings ──────────────────────────────────────────────────────
  section_protection_status: 'Protection Status',
  section_trusted_servers: 'Trusted Authentication Servers',
  section_suggested_servers: 'Suggested Servers',
  section_mail_handling: 'Mail Handling',
  section_recent_activity: 'Recent Activity',
  section_score_settings: 'Score Settings',
  section_sender_rules: 'Sender Domain Rules',
  section_manual_whitelist: 'Manual Whitelist',
  section_address_book_whitelist: 'Address Book Whitelist',
  section_diagnostics: 'Diagnostics',
  section_decision_log: 'Decision Log',

  // ── Protection status messages ────────────────────────────────────────────
  status_no_trusted_servers:
    'No trusted authentication servers configured. '
    + 'DMARC, SPF, and DKIM scoring is disabled until you confirm a trusted server.',
  status_overall_all_active: 'Authentication scoring is active for all $1 account$2.',
  status_overall_partial:
    'Authentication scoring is not active for $1 of $2 account$3. '
    + 'Protection is partial until setup is complete.',
  status_state_active: 'Authentication scoring active',
  status_state_not_configured: 'Trusted authentication server not configured',
  status_state_awaiting_mail: 'Configured — waiting for new mail to verify',
  status_state_needs_confirmation: 'Setup requires confirmation',
  status_state_no_usable_ar: 'Provider does not appear to supply usable authentication results',
  btn_setup_start: 'Set up',
  btn_setup_change: 'Review / change',
  btn_start_guided_setup: 'Start guided setup',
  popup_status_inactive: 'Authentication scoring is not active for this account.',
  popup_btn_open_setup: 'Open setup',

  // ── Recent activity ───────────────────────────────────────────────────────
  activity_no_messages: 'No messages assessed yet.',
  activity_counts: '$1 message$2 assessed — $3 normal, $4 review, $5 high-risk.',
  activity_most_recent: 'Most recent:',
  activity_unknown_domain: '(unknown)',

  // ── Classification labels ─────────────────────────────────────────────────
  classification_normal: 'normal',
  classification_review: 'review',
  classification_high_risk: 'high-risk',
  classification_unknown: 'unknown',

  // ── Setup assistant ───────────────────────────────────────────────────────
  setup_hints_summary: 'Setup hints from account domains',
  setup_use_dns: 'Use DNS lookup for MX setup hints',
  setup_dns_resolver_label: 'DNS resolver:',
  setup_no_accounts: 'No account email domains found.',
  setup_unable_load_accounts: 'Unable to load account information.',
  setup_no_mx_records: 'No MX records found.',

  // ── Trusted domain list ───────────────────────────────────────────────────
  no_trusted_msg: 'No trusted domains configured.',
  trust_exact_match_label: '$1 (exact match)',
  trust_domain_label: '$1 (and subdomains)',
  trust_promote_btn: 'Trust domain ($1 and subdomains)',
  trust_promote_title:
    'Add $1 as a registrable-domain trust entry. '
    + 'This will trust all subdomains of $1, not just $2.',
  add_trusted_hint_exact: 'Trusts only this specific host. Subdomains are not trusted.',
  add_trusted_hint_domain:
    'Trusts this domain and all its subdomains. '
    + 'Use with care — this is broader than exact-host trust.',
  trusted_error_empty: 'Value cannot be empty.',
  trusted_error_invalid_host: 'Invalid hostname: use letters, digits, hyphens, and dots only.',
  trusted_error_public_suffix: 'This value is a public suffix and cannot be used for domain trust.',
  trusted_error_not_registrable:
    'For registrable-domain trust, enter the registrable domain itself (e.g. $1, not $2).',
  trusted_error_duplicate: 'This entry already exists in the trusted list.',
  match_type_exact: 'exact',
  match_type_domain: 'domain',

  // ── Candidate list ────────────────────────────────────────────────────────
  candidates_none: 'No untrusted candidates seen yet.',
  candidate_trust_domain: 'Trust $1 and all subdomains',
  candidate_exact_match: '$1 (exact match)',

  // ── Review folder ─────────────────────────────────────────────────────────
  review_folder_no_accounts: 'No accounts found.',
  review_folder_unable_load: 'Unable to load accounts.',
  review_folder_select_placeholder: 'Select a folder…',

  // ── Mail handling settings ────────────────────────────────────────────────
  setting_move_to_review: 'Move suspicious mail to the review folder',
  setting_move_junk: 'Move high-risk mail directly to the Junk folder',
  setting_notify: 'Notify for messages that pass assessment (score at or below threshold)',
  setting_enable_diagnostics: 'Enable Diagnostics tab',
  setting_enable_address_book: 'Enable address book whitelist mitigation',

  // ── Score settings ────────────────────────────────────────────────────────
  score_col_result: 'Result',
  score_col_signal: 'Signal',
  score_col_rule: 'Rule',
  score_col_score: 'Score',
  score_col_default: 'Default',
  score_mitigation_badge: 'mitigation',
  score_layer3_cap_warning:
    'Warning: the Layer 3 cap is at or above the Review threshold (50). '
    + 'Layer 3 heuristics alone could push a message into Review — '
    + 'this is outside the intended low-pass design.',

  // ── Buttons ───────────────────────────────────────────────────────────────
  btn_add: 'Add',
  btn_remove: 'Remove',
  btn_use: 'Use',
  btn_clear_log: 'Clear log',
  btn_export_logs: 'Export logs',
  btn_exporting: 'Exporting…',
  btn_reset_all_scores: 'Reset all scores to defaults',
  btn_reset_layer2: 'Reset Layer 2 to defaults',
  btn_reset_layer3: 'Reset Layer 3 to defaults',
  btn_reset_layer4: 'Reset Layer 4 to defaults',
  btn_move_to_inbox: 'Move to Inbox',
  btn_whitelist_sender: 'Whitelist Sender',
  btn_already_whitelisted: 'Already Whitelisted',
  btn_open_options: 'Open Options / Logs',
  btn_confirm: 'Confirm',
  btn_cancel: 'Cancel',
  btn_show_older: 'Show $1 older entries',

  // ── Whitelist ─────────────────────────────────────────────────────────────
  whitelist_none: 'No whitelist entries configured.',
  whitelist_email_invalid: 'Enter a valid email address (e.g. user@example.com).',
  whitelist_already_exists: 'This address is already in the whitelist.',
  whitelist_full: 'Whitelist is full (max $1 entries). Remove an entry before adding a new one.',
  whitelist_ab_permission_note:
    'Enabling this feature will request access to your Thunderbird address books.',

  // ── Alignment metrics ─────────────────────────────────────────────────────
  metrics_alignment_summary: 'Alignment metrics',
  metrics_heuristic_summary: 'Heuristic metrics',

  // ── Decision log ─────────────────────────────────────────────────────────
  log_count_all: 'Stored entries: $1 / 1000',
  log_count_showing: 'Stored entries: $1 / 1000 — showing $2 most recent',
  log_no_reasons: 'No reason details available.',
  log_no_reasons_label: 'No reasons',
  log_reasons_one: '$1 reason',
  log_reasons_many: '$1 reasons',

  // ── Popup ─────────────────────────────────────────────────────────────────
  popup_no_message: 'No message is currently displayed.',
  popup_no_entry:
    'No score details found for this message. '
    + 'The add-on scores messages when they arrive; '
    + 'this message may have been received before the add-on was installed, '
    + 'or its Message-ID could not be matched.',
  popup_score: 'Score: $1',
  popup_score_details: 'Score details',
  popup_all_reasons: 'All score reasons',
  popup_inbox_not_found: 'Inbox folder not found.',
  popup_moved_to_inbox: 'Moved to Inbox.',
  popup_move_failed: 'Move failed. Please try again.',
  popup_whitelist_confirm:
    'Add "$1" to the manual whitelist? '
    + 'Future messages from this address will receive a score reduction.',
  popup_whitelist_added: '"$1" added to the manual whitelist.',
  popup_whitelist_full:
    'Whitelist is full (max $1 entries). Remove an entry before adding a new one.',
  popup_whitelist_save_failed: 'Failed to save whitelist entry. Please try again.',
  popup_no_sender_address: 'Sender address could not be determined.',
  popup_already_whitelisted_title: 'This sender is already in the manual whitelist.',
  popup_error: 'Error loading score details: $1',

  // ── Action labels (popup) ─────────────────────────────────────────────────
  action_classified_normal: 'Left in inbox',
  action_classified_review: 'Scored review (no action)',
  action_classified_high_risk: 'Scored high-risk (no action)',
  action_moved_review: 'Moved to review folder',
  action_moved_junk: 'Moved to Junk',
  action_moved_junk_mark_failed: 'Moved to Junk (marking as junk failed)',
  action_move_review_failed: 'Move to review failed',
  action_move_junk_failed: 'Move to Junk failed',
  action_no_review_folder: 'No review folder configured',

  // ── Custom formulas (Layer 5) ─────────────────────────────────────────────
  section_custom_formulas: 'Custom Scoring Formulas (Layer 5)',
  custom_formula_intro:
    'Advanced feature for power users. Formulas are evaluated after all other '
    + 'scoring layers and can observe or adjust message scores.',
  custom_formula_safety:
    'Formulas are local-only and never sent externally. '
    + 'Use observe mode to test a formula without changing scoring. '
    + 'Add mode adds the clamped result (−100 to +100) to the message score. '
    + 'Regex matching via match() is available in observe mode only. '
    + 'Errors in individual formulas are caught and ignored per message.',
  custom_formula_none: 'No custom formulas configured.',
  custom_formula_add_title: 'Add formula',
  custom_formula_edit_title: 'Edit formula',
  custom_formula_field_id: 'ID',
  custom_formula_field_name: 'Name',
  custom_formula_field_expression: 'Expression',
  custom_formula_field_mode: 'Mode',
  custom_formula_id_hint:
    'Stable identifier used in score keys (custom.formula.<id>). '
    + 'Letters, digits, hyphens, and underscores only. Cannot be changed after saving.',
  custom_formula_mode_hint:
    'observe: evaluate and record but do not change score. '
    + 'add: add result to score. '
    + 'disabled: skip formula entirely.',
  custom_formula_count_all: 'Formulas: $1 / 20',
  btn_add_formula: 'Add formula',
  btn_edit_formula: 'Edit',
  btn_delete_formula: 'Delete',
  btn_save_formula: 'Save',
  custom_formula_error_id_required: 'ID is required.',
  custom_formula_error_id_too_long: 'ID is too long (max $1 characters).',
  custom_formula_error_id_invalid:
    'ID must contain only letters, digits, hyphens, and underscores.',
  custom_formula_error_id_duplicate: 'A formula with this ID already exists.',
  custom_formula_error_name_too_long: 'Name is too long (max $1 characters).',
  custom_formula_error_expression_required: 'Expression is required.',
  custom_formula_error_expression_too_long: 'Expression is too long (max $1 characters).',
  custom_formula_error_parse: 'Parse error: $1',
  custom_formula_error_invalid_mode: 'Invalid mode.',
  custom_formula_diag_summary: 'Formula diagnostics',
  custom_formula_list_full:
    'Formula limit reached ($1). Remove a formula before adding a new one.',
  custom_formula_template_label: 'Template',
  custom_formula_template_choose: '— choose a template —',
  btn_insert_template: 'Insert',
  custom_formula_tpl_boost_rule: 'Boost when a rule fired',
  custom_formula_tpl_deep_subdomain: 'Deep random subdomain',
  custom_formula_tpl_msgid_mismatch: 'Message-ID mismatch',
  custom_formula_tpl_dkim_mitigate: 'Mitigate on DKIM aligned',
  custom_formula_expr_placeholder: 'has("composite.authAlignedRandomDomain") ? 30 : 0',
  custom_formula_help_summary: 'Formula reference',
  custom_formula_help_returns:
    'Formulas return a number; non-numeric results are ignored.',
  custom_formula_help_observe:
    'observe mode records the result but does not change the message score.',
  custom_formula_help_add:
    'add mode adds the clamped result (−100 to +100) to the message score.',
  custom_formula_help_clamped:
    'Output is clamped to [−100, +100] before being applied.',
  custom_formula_help_errors:
    'Errors in a formula are caught per message and shown in the diagnostics column; a bad formula does not block others.',
  custom_formula_help_no_regex:
    'Regex matching (match()) is not supported in add mode (v1).',
  custom_formula_help_fields_title: 'Available fields and functions',

  // ── Formula insertion chips ───────────────────────────────────────────────
  formula_chips_label: 'Insert field / function:',
  formula_chip_insert_title: 'Insert at cursor',
  formula_chips_group_functions: 'Functions',
  formula_chips_group_from: 'From',
  formula_chips_group_alignment: 'Alignment',
  formula_chips_group_message_id: 'Message-ID',
  formula_chips_group_headers: 'Headers',
  formula_chips_group_general: 'General',
  formula_chips_ref_note:
    'These are the supported fields and functions for the v1 formula DSL. '
    + 'Click a chip to insert it at the cursor position.',

  // ── Notification strings ──────────────────────────────────────────────────
  notification_single_account:  '$1: 1 new message',
  notification_single_fallback: '$1: 1 new message',
  notification_multi_title:     'New Messages',
  notification_multi_body:      'There are $1 new messages.',
  notification_more_messages:   '+$1 more messages',
  notification_no_subject:      '(no subject)',

  // ── DNS error messages ────────────────────────────────────────────────────
  dns_error_invalid_resolver: 'DNS resolver address is missing or invalid.',
  dns_error_timeout: 'DNS lookup timed out.',
  dns_error_network: 'DNS lookup failed (network error).',
  dns_error_http: 'DNS lookup failed (server error).',
  dns_error_dns: 'DNS server returned an error.',
  dns_error_generic: 'DNS lookup failed.',
};

/**
 * Get a localized message string.
 *
 * In a browser extension context, delegates to browser.i18n.getMessage.
 * Falls back to the English strings in FALLBACK_EN when browser.i18n is
 * unavailable (e.g. in Node.js tests) or returns an empty string.
 *
 * @param {string}                name          Message key.
 * @param {string|string[]} [substitutions]     Positional substitution values.
 * @returns {string}
 */
export function getMessage(name, substitutions) {
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    const result = browser.i18n.getMessage(name, substitutions);
    if (result) return result;
  }
  let s = FALLBACK_EN[name] ?? name;
  if (substitutions) {
    const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
    for (let i = 0; i < arr.length; i++) {
      s = s.split(`$${i + 1}`).join(String(arr[i] ?? ''));
    }
  }
  return s;
}

/**
 * Look up a message via browser.i18n only; returns '' when unavailable or
 * missing so callers can fall back to the English rule registry.
 */
function browserMessage(name, substitutions) {
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    return browser.i18n.getMessage(name, substitutions) || '';
  }
  return '';
}

const CLASSIFICATION_MSG_KEYS = {
  normal: 'classification_normal',
  review: 'classification_review',
  'high-risk': 'classification_high_risk',
};

/**
 * Localized label for a classification value ('normal' | 'review' | 'high-risk').
 *
 * @param {string|null|undefined} classification
 * @returns {string}
 */
export function localizedClassification(classification) {
  const msgKey = CLASSIFICATION_MSG_KEYS[classification];
  if (msgKey) return getMessage(msgKey);
  return classification ? String(classification) : getMessage('classification_unknown');
}

const ACTION_MSG_KEYS = {
  'classified-normal': 'action_classified_normal',
  'classified-review': 'action_classified_review',
  'classified-high-risk': 'action_classified_high_risk',
  'moved-review': 'action_moved_review',
  'moved-junk': 'action_moved_junk',
  'moved-junk-mark-failed': 'action_moved_junk_mark_failed',
  'move-review-failed': 'action_move_review_failed',
  'move-junk-failed': 'action_move_junk_failed',
  'no-review-folder-configured': 'action_no_review_folder',
};

/**
 * Localized label for a decision-log action value. Unknown actions are
 * returned unchanged.
 *
 * @param {string|null|undefined} action
 * @returns {string}
 */
export function localizedActionLabel(action) {
  const msgKey = ACTION_MSG_KEYS[action];
  return msgKey ? getMessage(msgKey) : (action ?? '');
}

/**
 * Localized label for a rule/whitelist matchType ('exact' | 'domain').
 * Unknown values are returned unchanged.
 *
 * @param {string|null|undefined} matchType
 * @returns {string}
 */
export function localizedMatchType(matchType) {
  if (matchType === 'exact') return getMessage('match_type_exact');
  if (matchType === 'domain') return getMessage('match_type_domain');
  return matchType ?? '';
}

/**
 * Replace __MSG_key__ placeholders in static extension HTML.
 *
 * WebExtension i18n resolves __MSG_...__ in manifest.json, but extension pages
 * need their own replacement pass. This keeps options.html readable while
 * avoiding a large amount of one-off DOM setup code.
 *
 * @param {ParentNode} root
 */
export function localizeDocument(root = document) {
  if (typeof browser !== 'undefined' && browser?.i18n?.getUILanguage) {
    // Lets the engine pick locale-appropriate fonts and line breaking.
    document.documentElement.lang = browser.i18n.getUILanguage();
  }

  const replace = value => value.replace(/__MSG_([A-Za-z0-9_]+)__/g, (_, key) => getMessage(key));

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes('__MSG_')) {
      node.nodeValue = replace(node.nodeValue);
    }
  }

  const attrs = ['title', 'aria-label', 'placeholder'];
  for (const el of root.querySelectorAll(attrs.map(attr => `[${attr}*="__MSG_"]`).join(','))) {
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (value && value.includes('__MSG_')) {
        el.setAttribute(attr, replace(value));
      }
    }
  }
}

/**
 * Convert a score-reason key to a locale message base name.
 * e.g. 'composite.authAlignedRandomDomain' → 'rule_composite_authAlignedRandomDomain'
 *
 * @param {string} key
 * @returns {string}
 */
function scoreKeyToMsgBase(key) {
  return 'rule_' + key.replace(/\./g, '_');
}

/**
 * Localized title for an 'auth.<method>.<result>' key, or '' when the key is
 * not an auth key or no locale message is available.
 *
 * @param {string|null|undefined} key
 * @returns {string}
 */
function localizedAuthTitle(key) {
  const auth = key?.match(/^auth\.(\w+)\.(\w+)$/);
  if (!auth) return '';
  return browserMessage('rule_template_auth_title', [auth[1].toUpperCase(), auth[2]]);
}

/**
 * Return a localized title for a score-reason key.
 *
 * Tries browser.i18n first (rule_<key>_title), then falls back to the
 * English rule registry. Protocol-name keys like 'auth.dmarc.fail' fall
 * back to the synthesized registry title ('DMARC fail').
 *
 * @param {string} key  Stable score-reason key.
 * @returns {string}
 */
export function localizedTitleForKey(key) {
  const result = browserMessage(scoreKeyToMsgBase(key) + '_title');
  if (result) return result;
  const authTitle = localizedAuthTitle(key);
  if (authTitle) return authTitle;
  const cf = key?.match(/^custom\.formula\.(.+)$/);
  if (cf) {
    const formulaTitle = browserMessage('rule_template_custom_formula_title', [cf[1]]);
    if (formulaTitle) return formulaTitle;
  }
  return titleForKey(key);
}

/**
 * Return the display label for a stored score reason.
 *
 * Reasons store an English label at scoring time; prefer the localized rule
 * title (or the auth.<method>.<result> template) when one exists, otherwise
 * keep the stored label.
 *
 * @param {{ key: string, label?: string }} reason
 * @returns {string}
 */
export function localizedReasonLabel(reason) {
  const key = reason?.key;
  const result = browserMessage(scoreKeyToMsgBase(key ?? '') + '_title');
  if (result) return result;
  const authTitle = localizedAuthTitle(key);
  if (authTitle) return authTitle;
  if (reason?.label) return reason.label;
  return key ? localizedTitleForKey(key) : '';
}

/**
 * Return a localized summary string for a score-reason key, or null when none.
 *
 * Tries browser.i18n first (rule_<key>_summary), then falls back to the
 * English rule registry.
 *
 * @param {string} key  Stable score-reason key.
 * @returns {string|null}
 */
export function localizedSummaryForKey(key) {
  const result = browserMessage(scoreKeyToMsgBase(key) + '_summary');
  if (result) return result;
  const auth = key?.match(/^auth\.(\w+)\.(\w+)$/);
  if (auth) {
    const authSummary = browserMessage('rule_template_auth_summary', [auth[1].toUpperCase(), auth[2]]);
    if (authSummary) return authSummary;
  }
  if (/^custom\.formula\./.test(key ?? '')) {
    const formulaSummary = browserMessage('rule_template_custom_formula_summary');
    if (formulaSummary) return formulaSummary;
  }
  return summaryForKey(key);
}

/**
 * Return a localized tooltip string for a score-reason key, or null when none.
 *
 * Tries browser.i18n first (rule_<key>_tooltip, then rule_<key>_summary),
 * then falls back to the English why+caveat text from the rule registry.
 *
 * @param {string} key  Stable score-reason key.
 * @returns {string|null}
 */
export function localizedTooltipForKey(key) {
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    const base = scoreKeyToMsgBase(key);
    const tooltip = browser.i18n.getMessage(base + '_tooltip');
    if (tooltip) return tooltip;
  }
  const registryTooltip = tooltipForKey(key);
  if (registryTooltip) return registryTooltip;
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    const base = scoreKeyToMsgBase(key);
    const summary = browser.i18n.getMessage(base + '_summary');
    if (summary) return summary;
  }
  return null;
}
