/**
 * i18n — thin wrapper around browser.i18n.getMessage with English fallbacks.
 *
 * ## How to add a new locale
 *
 *   1. Create src/_locales/<code>/messages.json
 *      Use src/_locales/en/messages.json as the template.
 *      Translate only the "message" values you need; keys without translations
 *      fall back to English automatically via the default_locale in manifest.json.
 *
 *   2. Rule titles (rule_*_title) and summaries (rule_*_summary) are optional
 *      — they fall back to the English rule registry when missing.
 *
 *   3. Keep technical protocol names (DMARC, SPF, DKIM, Message-ID) unchanged
 *      unless your locale explicitly needs surrounding explanation.
 *
 *   4. Test by switching Thunderbird to your locale and opening the add-on options.
 *
 * See also: docs/localization.md
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
    + 'DMARC, SPF, and DKIM scoring is disabled until you add a trusted server above.',
  status_protection_active: 'Protection active — $1 trusted server$2 configured.',
  status_recent_no_trusted_ar:
    'Recent messages had no scoring from trusted authentication results. '
    + 'Verify that your trusted server names match the Authentication-Results headers in your mail.',

  // ── Recent activity ───────────────────────────────────────────────────────
  activity_no_messages: 'No messages assessed yet.',
  activity_counts: '$1 message$2 assessed — $3 normal, $4 review, $5 high-risk.',
  activity_most_recent: 'Most recent:',

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
      s = s.replace(`$${i + 1}`, String(arr[i] ?? ''));
    }
  }
  return s;
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
  const msgName = scoreKeyToMsgBase(key) + '_title';
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    const result = browser.i18n.getMessage(msgName);
    if (result) return result;
  }
  return titleForKey(key);
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
  const msgName = scoreKeyToMsgBase(key) + '_summary';
  if (typeof browser !== 'undefined' && browser?.i18n?.getMessage) {
    const result = browser.i18n.getMessage(msgName);
    if (result) return result;
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
