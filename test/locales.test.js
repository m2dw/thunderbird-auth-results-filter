/**
 * Shared validation for src/_locales/<code>/messages.json.
 *
 * Runs for every locale directory, so a newly added translation is checked
 * for key coverage, placeholder consistency and untranslated values without
 * writing new tests.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { REGISTRY, tooltipForKey } from '../src/core/ruleRegistry.js';
import {
  FALLBACK_EN,
  localizedActionLabel,
  localizedClassification,
  localizedMatchType,
  localizedReasonLabel,
  localizedTitleForKey,
} from '../src/modules/i18n.js';

const SRC_DIR = new URL('../src/', import.meta.url);
const LOCALES_DIR = new URL('_locales/', SRC_DIR);

const readLocaleText = code => readFileSync(new URL(`${code}/messages.json`, LOCALES_DIR), 'utf8');

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();
const en = JSON.parse(readLocaleText('en'));
const nonEnglishLocales = locales.filter(code => code !== 'en');

// Values that intentionally stay identical to English: product name, code
// snippets, identifiers and header/field names.
const INTENTIONALLY_UNTRANSLATED = {
  de: [
    'page_title',
    'classification_normal',
    'score_col_signal',
    'col_domain',
    'popup_identity_message_id',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'custom_formula_field_id',
    'custom_formula_expr_placeholder',
    'formula_chips_group_from',
    'formula_chips_group_message_id',
    'rule_template_auth_title',
  ],
  es: [
    'page_title',
    'classification_normal',
    'log_col_original',
    'popup_identity_message_id',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'custom_formula_field_id',
    'formula_diag_col_error',
    'custom_formula_expr_placeholder',
    'formula_chips_group_from',
    'formula_chips_group_message_id',
    'formula_chips_group_general',
    'rule_template_auth_title',
  ],
  fr: [
    'page_title',
    'classification_normal',
    'score_col_signal',
    'score_col_score',
    'log_col_action',
    'popup_identity_message_id',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'custom_formula_field_id',
    'custom_formula_field_expression',
    'custom_formula_field_mode',
    'formula_diag_col_mode',
    'custom_formula_expr_placeholder',
    'formula_chips_group_message_id',
    'rule_template_auth_title',
  ],
  ja: [
    'page_title',
    'custom_formula_field_id',
    'custom_formula_expr_placeholder',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'formula_chips_group_from',
    'formula_chips_group_message_id',
    'popup_identity_message_id',
  ],
  zh_CN: [
    'page_title',
    'popup_identity_message_id',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'custom_formula_field_id',
    'custom_formula_expr_placeholder',
    'formula_chips_group_from',
    'formula_chips_group_message_id',
    'rule_template_auth_title',
  ],
  zh_TW: [
    'page_title',
    'popup_identity_message_id',
    'key_reference_btn_insert_has',
    'key_reference_btn_insert_scoreof',
    'custom_formula_field_id',
    'custom_formula_expr_placeholder',
    'formula_chips_group_from',
    'formula_chips_group_message_id',
    'rule_template_auth_title',
  ],
};

// English-only grammar helpers that other locales may leave unused.
const OPTIONAL_PLACEHOLDERS = new Set(['plural']);

const NAMED_PLACEHOLDER_RE = /\$([A-Za-z0-9_@]+)\$/g;

function usedPlaceholders(message) {
  return new Set([...message.matchAll(NAMED_PLACEHOLDER_RE)].map(m => m[1].toLowerCase()));
}

function definedPlaceholders(entry) {
  const out = new Map();
  for (const [name, def] of Object.entries(entry?.placeholders ?? {})) {
    out.set(name.toLowerCase(), def?.content);
  }
  return out;
}

function topLevelKeys(text) {
  return [...text.matchAll(/^ {2}"([^"]+)"\s*:/gm)].map(m => m[1]);
}

function listSourceFiles(dirUrl) {
  const files = [];
  for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === '_locales') continue;
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dirUrl);
    if (entry.isDirectory()) files.push(...listSourceFiles(url));
    else if (/\.(js|html)$/.test(entry.name)) files.push(url);
  }
  return files;
}

describe.each(locales)('locale %s', code => {
  const text = readLocaleText(code);
  const messages = JSON.parse(text);

  test('has no duplicate keys', () => {
    const keys = topLevelKeys(text);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates).toEqual([]);
    expect(keys.length).toBe(Object.keys(messages).length);
  });

  test('every entry has a non-empty message', () => {
    const empty = Object.entries(messages)
      .filter(([, entry]) => typeof entry?.message !== 'string' || entry.message.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  test('has exactly the English key set', () => {
    const missing = Object.keys(en).filter(k => !(k in messages));
    const extra = Object.keys(messages).filter(k => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  test('placeholders match English', () => {
    const problems = [];
    for (const [key, enEntry] of Object.entries(en)) {
      const entry = messages[key];
      if (!entry || typeof entry.message !== 'string') continue;

      const enDefs = definedPlaceholders(enEntry);
      const defs = definedPlaceholders(entry);
      for (const [name, content] of enDefs) {
        if (defs.get(name) !== content) problems.push(`${key}: placeholder ${name} must map to ${content}`);
      }
      for (const name of defs.keys()) {
        if (!enDefs.has(name)) problems.push(`${key}: unknown placeholder ${name}`);
      }

      const used = usedPlaceholders(entry.message);
      for (const name of used) {
        if (!defs.has(name)) problems.push(`${key}: $${name}$ is not defined`);
      }
      for (const name of usedPlaceholders(enEntry.message)) {
        if (!used.has(name) && !OPTIONAL_PLACEHOLDERS.has(name)) {
          problems.push(`${key}: $${name}$ is missing from the message`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe.each(nonEnglishLocales)('locale %s translation', code => {
  const messages = JSON.parse(readLocaleText(code));
  const allowed = new Set(INTENTIONALLY_UNTRANSLATED[code] ?? []);

  test('has no values left identical to English unless allowlisted', () => {
    const untranslated = Object.keys(en)
      .filter(k => messages[k]?.message === en[k].message && !allowed.has(k));
    expect(untranslated).toEqual([]);
  });
});

describe('Japanese reason labels', () => {
  const ja = JSON.parse(readLocaleText('ja'));

  // Minimal browser.i18n.getMessage: resolves named placeholders to $n substitutions.
  function getMessage(name, substitutions) {
    const entry = ja[name];
    if (!entry) return '';
    const subs = substitutions == null ? [] : [].concat(substitutions);
    const defs = definedPlaceholders(entry);
    return entry.message
      .replace(NAMED_PLACEHOLDER_RE, (_, p) => defs.get(p.toLowerCase()) ?? '')
      .replace(/\$(\d)/g, (_, n) => String(subs[Number(n) - 1] ?? ''));
  }

  beforeEach(() => {
    globalThis.browser = { i18n: { getMessage } };
  });
  afterEach(() => {
    delete globalThis.browser;
  });

  test('auth.<method>.<result> reasons use the localized template, not the stored English label', () => {
    const expected = '認証結果: fail';
    expect(localizedReasonLabel({ key: 'auth.dmarc.fail', label: 'DMARC fail' })).toBe(`DMARC ${expected}`);
    expect(localizedTitleForKey('auth.spf.fail')).toBe(`SPF ${expected}`);
  });

  test('registry reasons use their localized rule title', () => {
    const entry = REGISTRY[0];
    const msgKey = 'rule_' + entry.key.replace(/\./g, '_') + '_title';
    expect(localizedReasonLabel({ key: entry.key, label: entry.title })).toBe(ja[msgKey].message);
  });
});

describe('English locale consistency', () => {
  test('rule titles and summaries match the rule registry', () => {
    const mismatches = [];
    for (const entry of REGISTRY) {
      const base = 'rule_' + entry.key.replace(/\./g, '_');
      if (en[`${base}_title`]?.message !== entry.title) mismatches.push(`${base}_title`);
      if (en[`${base}_summary`]?.message !== entry.summary) mismatches.push(`${base}_summary`);
    }
    expect(mismatches).toEqual([]);
  });

  test('composite rule tooltips match the rule registry', () => {
    const mismatches = REGISTRY
      .filter(entry => entry.key.startsWith('composite.'))
      .map(entry => [`rule_${entry.key.replace(/\./g, '_')}_tooltip`, tooltipForKey(entry.key)])
      .filter(([msgKey, tooltip]) => en[msgKey]?.message !== tooltip)
      .map(([msgKey]) => msgKey);
    expect(mismatches).toEqual([]);
  });

  test('FALLBACK_EN keys exist in en', () => {
    expect(Object.keys(FALLBACK_EN).filter(k => !en[k])).toEqual([]);
  });

  test('message keys referenced from source exist in en', () => {
    const missing = new Set();
    for (const url of listSourceFiles(SRC_DIR)) {
      const source = readFileSync(url, 'utf8');
      const re = url.pathname.endsWith('.html')
        ? /__MSG_([A-Za-z0-9_]+)__/g
        : /\b(?:getMessage|browserMessage)\(\s*'([A-Za-z0-9_]+)'/g;
      for (const m of source.matchAll(re)) {
        if (!en[m[1]]) missing.add(`${url.pathname.split('/src/')[1]}: ${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test('display helpers map every known value to an en message', () => {
    for (const [value, key] of [
      ['normal', 'classification_normal'],
      ['review', 'classification_review'],
      ['high-risk', 'classification_high_risk'],
    ]) {
      expect(localizedClassification(value)).toBe(en[key].message);
    }
    expect(localizedClassification(undefined)).toBe(en.classification_unknown.message);

    for (const [value, key] of [
      ['classified-normal', 'action_classified_normal'],
      ['classified-review', 'action_classified_review'],
      ['classified-high-risk', 'action_classified_high_risk'],
      ['moved-review', 'action_moved_review'],
      ['moved-junk', 'action_moved_junk'],
      ['moved-junk-mark-failed', 'action_moved_junk_mark_failed'],
      ['move-review-failed', 'action_move_review_failed'],
      ['move-junk-failed', 'action_move_junk_failed'],
      ['no-review-folder-configured', 'action_no_review_folder'],
    ]) {
      expect(localizedActionLabel(value)).toBe(en[key].message);
    }
    expect(localizedActionLabel('moved-junk-mark-failed')).not.toBe(localizedActionLabel('moved-junk'));
    expect(localizedActionLabel('something-new')).toBe('something-new');

    expect(localizedMatchType('exact')).toBe(en.match_type_exact.message);
    expect(localizedMatchType('domain')).toBe(en.match_type_domain.message);
  });
});
