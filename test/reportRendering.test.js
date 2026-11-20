/**
 * Renders a Rule Match Report at the 10,000-message product ceiling through
 * the real report.js and checks that the rule table and the paginated per-rule
 * drill-down stay bounded and usable while changing pages.
 *
 * No DOM library is available in the test environment, so a minimal fake DOM
 * covers the element APIs report.js uses.
 */

import { jest } from '@jest/globals';
import { aggregateRuleMatches } from '../src/core/ruleMatchReport.js';
import { DRILLDOWN_PAGE_SIZE } from '../src/core/ruleMatchReportView.js';
import { RULE_MATCH_HARD_LIMIT, RULE_MATCH_REPORT_PORT } from '../src/modules/ruleMatchAnalysis.js';
import { RULE_MATCH_SCOPE_MESSAGE } from '../src/modules/ruleMatchScope.js';

class FakeClassList {
  constructor(el) { this.el = el; }
  get names() { return this.el.className.split(/\s+/).filter(Boolean); }
  contains(name) { return this.names.includes(name); }
  add(name) { if (!this.contains(name)) this.el.className = [...this.names, name].join(' '); }
  remove(name) { this.el.className = this.names.filter(n => n !== name).join(' '); }
  toggle(name, force = !this.contains(name)) {
    if (force) this.add(name); else this.remove(name);
    return force;
  }
}

class FakeElement {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = '';
    this.children = [];
    this.text = '';
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.validity = { badInput: false };
    this.classList = new FakeClassList(this);
  }

  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.children = []; this.text = String(value); }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') this.text += node;
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatch(type) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this });
  }

  click() { this.dispatch('click'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  scrollIntoView() {}

  matches(selector) {
    const m = /^([a-z]*)((?:\.[\w-]+)*)$/i.exec(selector);
    if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    return m[2].split('.').filter(Boolean).every(name => this.classList.contains(name));
  }

  * descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    return [...this.descendants()].filter(el => el.matches(selector));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function createDocument() {
  const byId = new Map();
  const sortButtons = [];
  for (const [id, key] of [['th-rule', 'rule'], ['th-matches', 'matches']]) {
    const th = new FakeElement('th', id);
    const btn = new FakeElement('button');
    btn.className = 'sort-btn';
    btn.dataset.sortKey = key;
    const indicator = new FakeElement('span');
    indicator.className = 'sort-indicator';
    btn.append(indicator);
    th.append(btn);
    byId.set(id, th);
    sortButtons.push(btn);
  }
  return {
    documentElement: {},
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeElement('div', id));
      return byId.get(id);
    },
    createElement: tag => new FakeElement(tag),
    createTreeWalker: () => ({ nextNode: () => null }),
    querySelectorAll: selector => (selector === '.sort-btn' ? sortButtons : []),
  };
}

const FOLDER = { accountId: 'account1', path: '/INBOX', name: 'Inbox' };
// More messages than the ceiling, so the hard limit is what bounds the run.
const FOLDER_SIZE = RULE_MATCH_HARD_LIMIT + 250;
const FAILED = 25;

// Every analyzed message matches the L1 rule; every other one also matches a
// second rule, so both drill-downs span many pages.
function syntheticReport(messageIds) {
  const analyzedIds = messageIds.slice(0, messageIds.length - FAILED);
  const rules = aggregateRuleMatches(analyzedIds.map((messageId, i) => ({
    messageId,
    score: i % 2 === 0 ? 60 : 0,
    classification: i % 2 === 0 ? 'review' : 'normal',
    scoreReasons: [
      { key: 'authserv.untrusted', delta: 0 },
      ...(i % 2 === 0 ? [{ key: 'heuristic.randomLocalPart', delta: 60 }] : []),
    ],
  })));
  return {
    requested: messageIds.length,
    analyzed: analyzedIds.length,
    failed: FAILED,
    skipped: 0,
    overLimit: 0,
    cancelled: false,
    rules,
  };
}

function installEnvironment() {
  const document = createDocument();
  const posted = [];
  const browser = {
    runtime: {
      sendMessage: async msg => (msg?.type === RULE_MATCH_SCOPE_MESSAGE
        ? { kind: 'folder', folder: FOLDER }
        : undefined),
      connect: jest.fn(({ name }) => {
        const listeners = [];
        return {
          name,
          onMessage: { addListener: fn => listeners.push(fn) },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: msg => {
            posted.push(msg);
            if (msg.type !== 'start') return;
            const report = syntheticReport(msg.messageIds);
            setTimeout(() => { for (const fn of listeners) fn({ type: 'result', report }); }, 0);
          },
        };
      }),
    },
    accounts: { get: async () => ({ name: 'Account' }) },
    messages: {
      list: jest.fn(async () => ({
        id: null,
        messages: Array.from({ length: FOLDER_SIZE }, (_, i) => ({ id: i + 1, folder: FOLDER })),
      })),
      query: jest.fn(),
      continueList: jest.fn(),
      get: jest.fn(async id => ({ date: new Date(2026, 10, 1), author: `sender${id}@example.test`, subject: `Subject ${id}` })),
    },
    messageDisplay: { open: jest.fn(async () => {}) },
  };
  Object.assign(globalThis, {
    document,
    browser,
    location: { search: '?scope=token-1' },
    NodeFilter: { SHOW_TEXT: 4 },
  });
  return { document, browser, posted };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await flush();
  expect(predicate()).toBe(true);
}

const subjects = tbody => tbody.children.map(tr => tr.children[2].textContent);

describe('report rendering at the product ceiling', () => {
  let env;
  let $;

  beforeAll(async () => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    env = installEnvironment();
    $ = id => env.document.getElementById(id);
    await import('../src/report/report.js');
    await until(() => !$('folder-options').hidden);
  });

  afterAll(() => {
    for (const key of ['document', 'browser', 'location', 'NodeFilter']) delete globalThis[key];
    jest.restoreAllMocks();
  });

  test('a No user limit run analyzes and renders 10,000 messages', async () => {
    $('no-limit-toggle').checked = true;
    $('no-limit-toggle').dispatch('change');
    expect($('limit-note').textContent).toContain('10');
    expect($('run-btn').disabled).toBe(false);

    $('run-btn').click();
    await until(() => !$('result-section').hidden);

    const start = env.posted.find(m => m.type === 'start');
    expect(start.messageIds).toHaveLength(RULE_MATCH_HARD_LIMIT);
    expect(start.maxMessages).toBeNull();
    // Rendering the report reads no message headers; only drill-down pages do.
    expect(env.browser.messages.get).not.toHaveBeenCalled();

    expect($('count-requested').textContent).toBe((FOLDER_SIZE).toLocaleString());
    expect($('count-analyzed').textContent).toBe((RULE_MATCH_HARD_LIMIT - FAILED).toLocaleString());
    expect($('count-failed').textContent).toBe(String(FAILED));
    expect($('count-over-limit').textContent).toBe('250');
    expect($('result-limit').hidden).toBe(false);

    const rows = $('rule-rows').children;
    expect(rows).toHaveLength(2);
    expect(rows.map(tr => tr.children[0].children[0].title)).toEqual(['authserv.untrusted', 'heuristic.randomLocalPart']);
    expect(rows[0].children[2].textContent).toContain((RULE_MATCH_HARD_LIMIT - FAILED).toLocaleString());
  });

  test('the drill-down renders one bounded page and reads only its headers', async () => {
    const ruleButton = $('rule-rows').children[0].children[0].children[0];
    ruleButton.click();
    await until(() => env.browser.messages.get.mock.calls.length === DRILLDOWN_PAGE_SIZE);
    await flush();

    expect($('drilldown-section').hidden).toBe(false);
    expect($('drilldown-pager').hidden).toBe(false);
    expect($('drilldown-prev').disabled).toBe(true);
    expect($('drilldown-next').disabled).toBe(false);
    expect($('drilldown-rows').children).toHaveLength(DRILLDOWN_PAGE_SIZE);
    expect(subjects($('drilldown-rows'))[0]).toBe('Subject 1');
    expect($('drilldown-page-status').textContent).toBe(`1–100 of ${(RULE_MATCH_HARD_LIMIT - FAILED).toLocaleString()}`);
    expect(env.browser.messages.get.mock.calls.map(([id]) => id))
      .toEqual(Array.from({ length: DRILLDOWN_PAGE_SIZE }, (_, i) => i + 1));
  });

  test('changing pages replaces the rows and keeps header reads per page', async () => {
    env.browser.messages.get.mockClear();
    $('drilldown-next').click();
    await until(() => env.browser.messages.get.mock.calls.length === DRILLDOWN_PAGE_SIZE);
    await flush();
    expect($('drilldown-rows').children).toHaveLength(DRILLDOWN_PAGE_SIZE);
    expect(subjects($('drilldown-rows'))[0]).toBe('Subject 101');
    expect($('drilldown-prev').disabled).toBe(false);

    // Step to the last page: the final partial page and Next is disabled.
    env.browser.messages.get.mockClear();
    const total = RULE_MATCH_HARD_LIMIT - FAILED;
    const pageCount = Math.ceil(total / DRILLDOWN_PAGE_SIZE);
    for (let page = 1; page < pageCount; page++) $('drilldown-next').click();
    await until(() => subjects($('drilldown-rows'))[0] === `Subject ${(pageCount - 1) * DRILLDOWN_PAGE_SIZE + 1}`);
    expect($('drilldown-rows').children).toHaveLength(total - (pageCount - 1) * DRILLDOWN_PAGE_SIZE);
    expect($('drilldown-next').disabled).toBe(true);
    expect($('drilldown-page-status').textContent).toBe(`${((pageCount - 1) * DRILLDOWN_PAGE_SIZE + 1).toLocaleString()}–${total.toLocaleString()} of ${total.toLocaleString()}`);
    // Superseded pages stop reading headers, so rapid paging stays bounded.
    expect(env.browser.messages.get.mock.calls.length).toBeLessThan(pageCount * 4 + DRILLDOWN_PAGE_SIZE);

    // Next past the end clamps to the last page.
    $('drilldown-next').click();
    expect($('drilldown-next').disabled).toBe(true);
    expect($('drilldown-rows').children).toHaveLength(total - (pageCount - 1) * DRILLDOWN_PAGE_SIZE);
  });

  test('another rule opens at its first page and the table marks it selected', async () => {
    const secondRule = $('rule-rows').children[1].children[0].children[0];
    secondRule.click();
    await flush();
    expect($('rule-rows').children[1].classList.contains('selected')).toBe(true);
    expect($('rule-rows').children[0].classList.contains('selected')).toBe(false);
    expect($('drilldown-prev').disabled).toBe(true);
    const matches = Math.ceil((RULE_MATCH_HARD_LIMIT - FAILED) / 2);
    expect($('drilldown-page-status').textContent).toBe(`1–100 of ${matches.toLocaleString()}`);
    expect(subjects($('drilldown-rows')).slice(0, 2)).toEqual(['Subject 1', 'Subject 3']);

    $('drilldown-close').click();
    expect($('drilldown-section').hidden).toBe(true);
    expect($('rule-rows').querySelectorAll('tr.selected')).toHaveLength(0);
  });
});
