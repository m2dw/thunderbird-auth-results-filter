// Exercises the real background.js wiring for the rule match report so that
// the snapshot loader it passes is the one under test, not a stub.

import { jest } from '@jest/globals';
import { RULE_MATCH_REPORT_PORT } from '../src/modules/ruleMatchAnalysis.js';

const LEGACY_STORED = {
  settings: {
    heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 10, layer3Cap: 40 },
    layer2Scores: { spfMailFromMismatch: 15, dkimDomainMismatch: 10, dmarcNoneWithThirdPartyAuth: 20 },
    authScores: {
      dmarc: { pass: 0, fail: 20, none: 15, policy: 0 },
      spf: { pass: 0, fail: 60, none: 5, softfail: 15, neutral: 5, temperror: 10, permerror: 20 },
      dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
    },
  },
};

function makeEvent() {
  const listeners = [];
  return { listeners, addListener: fn => { listeners.push(fn); } };
}

function makeBrowser(stored) {
  const calls = { storageSet: [], move: [], update: [], notify: [], createFolder: [], menus: [], tabs: [] };
  const pages = new Map();
  const browser = {
    storage: {
      local: {
        get: async () => ({ authResultsFilter: structuredClone(stored) }),
        set: async v => { calls.storageSet.push(v); },
      },
    },
    notifications: {
      onClicked: makeEvent(),
      create: async (...a) => { calls.notify.push(a); },
      clear: async () => {},
    },
    runtime: {
      onInstalled: makeEvent(),
      onConnect: makeEvent(),
      onMessage: makeEvent(),
      getURL: p => p,
    },
    menus: {
      create: props => { calls.menus.push(props); },
      onClicked: makeEvent(),
    },
    messages: {
      onNewMailReceived: makeEvent(),
      get: async id => ({ id, folder: { accountId: 'acct1' } }),
      getFull: async () => ({
        headers: {
          from: ['Sender <user@example.com>'],
          'authentication-results': ['mx.example.net; spf=fail smtp.mailfrom=example.com'],
        },
      }),
      move: async (...a) => { calls.move.push(a); },
      update: async (...a) => { calls.update.push(a); },
      continueList: async id => pages.get(id),
    },
    folders: { create: async (...a) => { calls.createFolder.push(a); } },
    accounts: { get: async () => ({ identities: [] }), list: async () => [] },
    addressBooks: { list: async () => [] },
    contacts: { list: async () => [] },
    messageDisplay: { open: async () => {} },
    tabs: { create: async props => { calls.tabs.push(props); } },
  };
  return { browser, calls, pages };
}

async function clickMenu(browser, info) {
  for (const l of browser.menus.onClicked.listeners) l(info);
  // Let the async click handler resolve the scope and open the tab.
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function scopeForLastTab(env) {
  const url = env.calls.tabs.at(-1).url;
  const token = new URL(url, 'moz-extension://x/').searchParams.get('scope');
  const responses = env.browser.runtime.onMessage.listeners
    .map(l => l({ type: 'rule-match-report-scope', token }))
    .filter(r => r !== undefined);
  expect(responses).toHaveLength(1);
  return responses[0];
}

function connectReportPort(browser, messageIds) {
  const onMessage = makeEvent();
  const onDisconnect = makeEvent();
  return new Promise((resolve, reject) => {
    const port = {
      name: RULE_MATCH_REPORT_PORT,
      onMessage,
      onDisconnect,
      postMessage: msg => {
        if (msg.type === 'result') resolve(msg.report);
        if (msg.type === 'error') reject(new Error(msg.error));
      },
    };
    for (const l of browser.runtime.onConnect.listeners) l(port);
    for (const l of onMessage.listeners) l({ type: 'start', messageIds });
  });
}

let sharedEnv;

describe('background rule match report wiring — read-only', () => {
  let env;

  beforeAll(async () => {
    env = makeBrowser(LEGACY_STORED);
    sharedEnv = env;
    globalThis.browser = env.browser;
    await import('../src/background/background.js');
  });

  afterAll(() => {
    delete globalThis.browser;
  });

  test('a report over legacy settings never writes storage or touches messages', async () => {
    expect(env.browser.runtime.onConnect.listeners).toHaveLength(1);
    const report = await connectReportPort(env.browser, [1, 2]);
    expect(report.requested).toBe(2);
    expect(report.analyzed).toBe(2);
    expect(env.calls.storageSet).toHaveLength(0);
    expect(env.calls.move).toHaveLength(0);
    expect(env.calls.update).toHaveLength(0);
    expect(env.calls.notify).toHaveLength(0);
    expect(env.calls.createFolder).toHaveLength(0);
  });

  test('a report over stored data missing scoreDefaultsVersion never writes storage', async () => {
    env.browser.storage.local.get = async () => ({ authResultsFilter: {} });
    const report = await connectReportPort(env.browser, [3]);
    expect(report.analyzed).toBe(1);
    expect(env.calls.storageSet).toHaveLength(0);
  });
});

describe('background rule match report context menus', () => {
  // background.js registers its listeners once per module instance, so these
  // tests reuse the browser double the module was loaded with above.
  let env;

  beforeAll(async () => {
    env = sharedEnv;
    globalThis.browser = env.browser;
  });

  afterAll(() => {
    delete globalThis.browser;
  });

  test('registers folder pane and message list entries', () => {
    expect(env.calls.menus.map(m => [m.id, m.contexts])).toEqual([
      ['arf-analyze-folder', ['folder_pane']],
      ['arf-analyze-selection', ['message_list']],
    ]);
    expect(env.calls.menus.map(m => m.title)).toEqual(['Analyze this folder', 'Analyze selected messages']);
  });

  test('"Analyze this folder" opens the report tab scoped to the clicked folder only', async () => {
    const folder = { accountId: 'acct1', path: '/INBOX', name: 'Inbox', subFolders: [{ path: '/INBOX/Sub' }] };
    await clickMenu(env.browser, { menuItemId: 'arf-analyze-folder', selectedFolder: folder });
    expect(env.calls.tabs.at(-1).url).toMatch(/^report\/report\.html\?scope=/);
    const scope = await scopeForLastTab(env);
    expect(scope).toMatchObject({ kind: 'folder', folder: { accountId: 'acct1', path: '/INBOX', name: 'Inbox' } });
    expect(scope.folder).not.toHaveProperty('subFolders');
  });

  test('"Analyze this folder" analyzes the clicked folder when several are affected', async () => {
    const a = { accountId: 'acct1', path: '/A', name: 'A' };
    const b = { accountId: 'acct1', path: '/B', name: 'B' };
    await clickMenu(env.browser, { menuItemId: 'arf-analyze-folder', selectedFolders: [a, b], selectedFolder: b });
    expect((await scopeForLastTab(env)).folder.path).toBe('/B');
  });

  test('"Analyze this folder" uses a single selectedFolders entry without a clicked folder', async () => {
    const a = { accountId: 'acct1', path: '/A', name: 'A' };
    await clickMenu(env.browser, { menuItemId: 'arf-analyze-folder', selectedFolders: [a] });
    expect((await scopeForLastTab(env)).folder.path).toBe('/A');
  });

  test('"Analyze this folder" opens nothing for an ambiguous multi-folder selection', async () => {
    const a = { accountId: 'acct1', path: '/A', name: 'A' };
    const b = { accountId: 'acct1', path: '/B', name: 'B' };
    const before = env.calls.tabs.length;
    await clickMenu(env.browser, { menuItemId: 'arf-analyze-folder', selectedFolders: [a, b] });
    expect(env.calls.tabs).toHaveLength(before);
  });

  test('"Analyze selected messages" resolves every page of the targeted selection', async () => {
    const inbox = { accountId: 'acct1', path: '/INBOX', name: 'Inbox' };
    env.pages.set('page-2', { id: null, messages: [{ id: 7, folder: inbox }] });
    await clickMenu(env.browser, {
      menuItemId: 'arf-analyze-selection',
      selectedMessages: { id: 'page-2', messages: [{ id: 5, folder: inbox }, { id: 6, folder: inbox }] },
    });
    const scope = await scopeForLastTab(env);
    expect(scope).toMatchObject({ kind: 'selection', messageIds: [5, 6, 7], truncated: false });
    expect(scope.folders).toEqual([inbox]);
    // Selection enumeration is timed where it runs, for the report's timing log.
    expect(scope.collectMs).toBeGreaterThanOrEqual(0);
    // Opening the report never touches the messages.
    expect(env.calls.move).toHaveLength(0);
    expect(env.calls.update).toHaveLength(0);
  });

  test('"Analyze selected messages" records messages beyond the limit as excluded', async () => {
    const inbox = { accountId: 'acct1', path: '/INBOX', name: 'Inbox' };
    const messages = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, folder: inbox }));
    env.pages.set('page-big', { id: null, messages: messages.slice(500) });
    await clickMenu(env.browser, {
      menuItemId: 'arf-analyze-selection',
      selectedMessages: { id: 'page-big', messages: messages.slice(0, 500) },
    });
    const scope = await scopeForLastTab(env);
    expect(scope).toMatchObject({ kind: 'selection', excluded: 1, truncated: true });
    expect(scope.messageIds).toHaveLength(1000);
  });

  test('"Analyze selected messages" opens the tab while paging and can be cancelled', async () => {
    const inbox = { accountId: 'acct1', path: '/INBOX', name: 'Inbox' };
    const continueList = env.browser.messages.continueList;
    // The next page never arrives, as with a very large selection.
    env.browser.messages.continueList = () => new Promise(() => {});
    try {
      const before = env.calls.tabs.length;
      await clickMenu(env.browser, {
        menuItemId: 'arf-analyze-selection',
        selectedMessages: { id: 'page-slow', messages: [{ id: 5, folder: inbox }, { id: 6, folder: inbox }] },
      });
      // The tab opens before the remaining pages arrive, with progress so far.
      expect(env.calls.tabs).toHaveLength(before + 1);
      const token = new URL(env.calls.tabs.at(-1).url, 'moz-extension://x/').searchParams.get('scope');
      const pending = await scopeForLastTab(env);
      expect(pending).toMatchObject({ kind: 'selection', collecting: true, collected: 2 });
      expect(pending).not.toHaveProperty('collectMs');

      const [listener] = env.browser.runtime.onMessage.listeners;
      await listener({ type: 'rule-match-report-scope-cancel', token });
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
      expect(await scopeForLastTab(env)).toMatchObject({ kind: 'selection', collecting: false, cancelled: true });
    } finally {
      env.browser.messages.continueList = continueList;
    }
  });

  test('"Analyze selected messages" opens the report in an error state when paging fails', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const continueList = env.browser.messages.continueList;
    env.browser.messages.continueList = async () => { throw new Error('list expired'); };
    try {
      const before = env.calls.tabs.length;
      await clickMenu(env.browser, {
        menuItemId: 'arf-analyze-selection',
        selectedMessages: { id: 'page-gone', messages: [{ id: 5 }] },
      });
      expect(env.calls.tabs).toHaveLength(before + 1);
      expect(await scopeForLastTab(env)).toMatchObject({ kind: 'error', error: 'list expired' });
    } finally {
      env.browser.messages.continueList = continueList;
      errors.mockRestore();
    }
  });

  test('clicks on unrelated menu items or account rows open nothing', async () => {
    const before = env.calls.tabs.length;
    await clickMenu(env.browser, { menuItemId: 'other' });
    await clickMenu(env.browser, { menuItemId: 'arf-analyze-folder', selectedAccount: { id: 'acct1' } });
    expect(env.calls.tabs).toHaveLength(before);
  });

  test('unknown scope tokens resolve to null and other messages are ignored', async () => {
    const [listener] = env.browser.runtime.onMessage.listeners;
    await expect(listener({ type: 'rule-match-report-scope', token: 'missing' })).resolves.toBeNull();
    expect(listener({ type: 'something-else' })).toBeUndefined();
  });
});
