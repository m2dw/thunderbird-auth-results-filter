import { readFileSync, readdirSync } from 'node:fs';
import { FALLBACK_EN } from '../src/modules/i18n.js';

// Locales that must fully mirror the English UI strings. Adding a locale here
// enforces key parity, placeholder integrity, and __MSG_ coverage against en.
const FULL_LOCALES = ['es', 'zh_CN', 'zh_TW', 'de'];

const load = code =>
  JSON.parse(readFileSync(new URL(`../src/_locales/${code}/messages.json`, import.meta.url), 'utf8'));

const en = load('en');

// Named placeholders referenced in a message, e.g. "$count$" -> "count".
const referencedPlaceholders = message =>
  [...message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map(m => m[1].toLowerCase());

// Placeholders that only carry an English plural suffix ("s" / "") and may be
// omitted by translations that phrase counts differently.
const OPTIONAL_PLACEHOLDERS = new Set(['plural']);

describe.each(FULL_LOCALES)('locale %s messages', code => {
  const messages = load(code);

  test('has exactly the same keys as en', () => {
    const missing = Object.keys(en).filter(k => !(k in messages));
    const extra = Object.keys(messages).filter(k => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  test.each(Object.keys(en))('%s is a non-empty string', key => {
    expect(typeof messages[key]?.message).toBe('string');
    expect(messages[key].message.trim()).not.toBe('');
  });

  test.each(Object.keys(en))('%s keeps the en placeholder definitions', key => {
    const enPh = en[key].placeholders ?? {};
    const ph = messages[key]?.placeholders ?? {};
    const contents = obj => Object.fromEntries(
      Object.entries(obj).map(([name, def]) => [name.toLowerCase(), def.content]),
    );
    expect(contents(ph)).toEqual(contents(enPh));
  });

  test.each(Object.keys(en))('%s references only defined placeholders and drops none', key => {
    const message = messages[key]?.message ?? '';
    const defined = Object.keys(messages[key]?.placeholders ?? {}).map(n => n.toLowerCase());
    const used = referencedPlaceholders(message);
    expect(used.filter(n => !defined.includes(n))).toEqual([]);

    const enUsed = new Set(referencedPlaceholders(en[key].message));
    const dropped = [...enUsed].filter(n => !OPTIONAL_PLACEHOLDERS.has(n) && !used.includes(n));
    expect(dropped).toEqual([]);

    // Positional "$1" style substitutions must not appear bare in the message;
    // they belong in placeholder definitions.
    expect(message.replace(/\$[A-Za-z0-9_@]+\$/g, '')).not.toMatch(/\$\d/);
  });

  test('covers every __MSG_ key used in manifest.json and options.html', () => {
    const files = ['../src/manifest.json', '../src/options/options.html'];
    const keys = files.flatMap(f =>
      [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter(k => !messages[k]?.message)).toEqual([]);
  });

  test('covers every literal getMessage() key and English fallback key', () => {
    const srcRoot = new URL('../src/', import.meta.url);
    const jsFiles = readdirSync(srcRoot, { recursive: true })
      .filter(f => f.endsWith('.js') && !f.includes('vendor'));
    const used = jsFiles.flatMap(f =>
      [...readFileSync(new URL(f, srcRoot), 'utf8').matchAll(/getMessage\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]),
    );
    const fallbackKeys = Object.keys(FALLBACK_EN);
    expect(used.length).toBeGreaterThan(0);
    expect(fallbackKeys.length).toBeGreaterThan(0);
    expect([...new Set([...used, ...fallbackKeys])].filter(k => !messages[k]?.message)).toEqual([]);
  });
});
