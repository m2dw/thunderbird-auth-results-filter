import { readFileSync } from 'node:fs';

// Regression for the report stylesheet overriding the HTML `hidden` attribute.
// No CSS-aware DOM is available in the test environment, so this resolves the
// computed `display` of elements in the real report.html against the real
// report.css with a minimal cascade: any matching author rule beats the UA
// `[hidden] { display: none }` rule regardless of specificity; among author
// rules the highest specificity wins, then the later rule.

const HTML = readFileSync(new URL('../src/report/report.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/report/report.css', import.meta.url), 'utf8');

const VOID_TAGS = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);

function parseHtml(html) {
  const root = { tag: '#root', attrs: new Map(), parent: null };
  const byId = new Map();
  let current = root;
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
  for (const [, closing, tag, rawAttrs] of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const name = tag.toLowerCase();
    if (closing) {
      while (current !== root && current.tag !== name) current = current.parent;
      if (current !== root) current = current.parent;
      continue;
    }
    const attrs = new Map();
    for (const [, key, , v1, v2] of rawAttrs.matchAll(/([a-zA-Z-]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      attrs.set(key.toLowerCase(), v1 ?? v2 ?? '');
    }
    const el = { tag: name, attrs, parent: current };
    if (attrs.has('id')) byId.set(attrs.get('id'), el);
    if (!VOID_TAGS.has(name)) current = el;
  }
  return byId;
}

function parseCompound(text) {
  const parts = { tag: null, ids: [], classes: [], attrs: [] };
  const re = /^([a-zA-Z][a-zA-Z0-9]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)\]/y;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m || (m[1] && pos !== 0)) throw new Error(`Unsupported selector in report.css: ${text}`);
    if (m[1]) parts.tag = m[1].toLowerCase();
    if (m[2]) parts.ids.push(m[2]);
    if (m[3]) parts.classes.push(m[3]);
    if (m[4]) parts.attrs.push(m[4].toLowerCase());
    pos = re.lastIndex;
    re.lastIndex = 0;
  }
  return parts;
}

function compoundMatches(c, el) {
  if (!el || el.tag === '#root') return false;
  if (c.tag && c.tag !== el.tag) return false;
  if (c.ids.some(id => el.attrs.get('id') !== id)) return false;
  const classes = (el.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
  if (c.classes.some(cls => !classes.includes(cls))) return false;
  return c.attrs.every(a => el.attrs.has(a));
}

function selectorMatches(compounds, el) {
  if (!compoundMatches(compounds.at(-1), el)) return false;
  let ancestor = el.parent;
  for (let i = compounds.length - 2; i >= 0; i--) {
    while (ancestor && !compoundMatches(compounds[i], ancestor)) ancestor = ancestor.parent;
    if (!ancestor) return false;
    ancestor = ancestor.parent;
  }
  return true;
}

function specificity(compounds) {
  return compounds.reduce(
    ([a, b, c], x) => [a + x.ids.length, b + x.classes.length + x.attrs.length, c + (x.tag ? 1 : 0)],
    [0, 0, 0],
  );
}

function parseDisplayRules(css) {
  const rules = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectorText, body] of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = body.match(/(?:^|;)\s*display\s*:\s*([^;]+)/);
    if (!decl) continue;
    for (const selector of selectorText.split(',')) {
      const compounds = selector.trim().split(/\s+/).map(parseCompound);
      rules.push({ compounds, specificity: specificity(compounds), value: decl[1].trim(), order: rules.length });
    }
  }
  return rules;
}

function computedDisplay(el, css = CSS) {
  const matching = parseDisplayRules(css).filter(r => selectorMatches(r.compounds, el));
  if (matching.length === 0) return el.attrs.has('hidden') ? 'none' : 'ua-default';
  matching.sort((x, y) => {
    for (let i = 0; i < 3; i++) if (x.specificity[i] !== y.specificity[i]) return x.specificity[i] - y.specificity[i];
    return x.order - y.order;
  });
  return matching.at(-1).value;
}

// Mirrors `element.hidden = value` from report.js.
function setHidden(el, hidden) {
  if (hidden) el.attrs.set('hidden', '');
  else el.attrs.delete('hidden');
}

describe('report stylesheet respects the hidden attribute', () => {
  let byId;
  beforeEach(() => { byId = parseHtml(HTML); });

  test('the evaluator sees .row override [hidden] without the fix', () => {
    const withoutFix = CSS.replace(/\.row\[hidden\]\s*\{[^}]*\}/, '');
    expect(withoutFix).not.toBe(CSS);
    expect(computedDisplay(byId.get('drilldown-pager'), withoutFix)).toBe('flex');
    expect(computedDisplay(byId.get('progress-section'), withoutFix)).toBe('flex');
  });

  test('selection scope keeps the folder date range and limit options hidden', () => {
    const options = byId.get('folder-options');
    expect(options.attrs.has('hidden')).toBe(true);
    expect(computedDisplay(options)).toBe('none');
    setHidden(options, false); // folder scope
    expect(computedDisplay(options)).not.toBe('none');
  });

  test('the drill-down pager stays hidden for a single page and keeps its flex layout otherwise', () => {
    const pager = byId.get('drilldown-pager');
    expect(computedDisplay(pager)).toBe('none');
    setHidden(pager, false);
    expect(computedDisplay(pager)).toBe('flex');
  });

  // Completion, cancellation, and errors all end the run via setRunning(false).
  test('progress is hidden initially, visible while running, and hidden after the run ends', () => {
    const progress = byId.get('progress-section');
    expect(computedDisplay(progress)).toBe('none');
    setHidden(progress, false); // setRunning(true)
    expect(computedDisplay(progress)).toBe('flex');
    setHidden(progress, true); // setRunning(false)
    expect(computedDisplay(progress)).toBe('none');
  });
});
