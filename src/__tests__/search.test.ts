import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../index.ts';
import { parse } from '../args.ts';

const TOKEN = 'xoxp-search-synthetic-secret';
const pub = { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false };
const priv = { id: 'C456', name: 'secret', is_private: true, is_im: false, is_mpim: false };
const dm = (user = 'U777') => ({ id: 'D123', name: user, is_private: true, is_im: true, is_mpim: false });
const mpim = { id: 'G123', name: 'mpdm-a--b-1', is_private: true, is_im: false, is_mpim: true };
let urls: URL[] = [];
beforeEach(() => {
  urls = [];
  globalThis.fetch = async () => { throw new Error('default deny'); };
});
function mocked(responses: unknown[]) {
  globalThis.fetch = async (input, init) => {
    urls.push(new URL(String(input)));
    assert.equal(init!.method, 'GET');
    const response = responses.shift();
    assert.ok(response, 'unexpected fetch ' + String(input));
    return response instanceof Response ? response : Response.json(response);
  };
}
async function invoke(args: string[], responses: unknown[]) {
  mocked(responses);
  const r = await run([...args, '--json'], { SLACK_AXI_TOKEN: TOKEN });
  return { ...r, data: JSON.parse(r.stdout) };
}
let serial = 0;
function hit(channel: object, extra: Record<string, unknown> = {}, type = 'message') {
  serial++;
  return { ts: `${1700000000 + serial}.000001`, text: `m${serial}`, user: 'U123', type, channel, ...extra };
}
function page(matches: unknown[], p: number, pages: number) {
  return { ok: true, messages: { matches, paging: { page: p, pages } } };
}
const searchUrls = () => urls.filter(u => u.pathname === '/api/search.messages');

test('fill: fetches further raw pages until --limit eligible matches are found', async () => {
  const r = await invoke(['search', 'deploy', '--limit', '2'], [
    page([hit(dm(), {}, 'im'), hit(dm(), {}, 'im')], 1, 4),
    page([hit(pub), hit(priv, {}, 'group')], 2, 4),
    page([hit(pub), hit(pub)], 3, 4),
  ]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.matches.length, 2);
  assert.equal(r.data.filtered, 3);
  assert.equal(r.data.page, 1);
  assert.deepEqual(searchUrls().map(u => u.searchParams.get('page')), ['1', '2', '3']);
  assert.ok(searchUrls().every(u => u.searchParams.get('count') === '2'));
});
test('fill: never admits matches the opt-ins exclude on any page', async () => {
  const r = await invoke(['search', 'x', '--limit', '5'], [
    page([hit(priv, {}, 'group'), hit(dm(), {}, 'im'), hit(mpim, {}, 'group')], 1, 2),
    page([hit(priv, {}, 'group'), hit(pub)], 2, 2),
  ]);
  assert.equal(r.data.matches.length, 1);
  assert.equal(r.data.matches[0].channel_id, 'C123');
  assert.equal(r.data.filtered, 4);
  assert.equal(r.data.next_page, null);
});
test('fill: stops at the fixed five-page bound and reports the next raw page', async () => {
  const empty = (p: number) => page([hit(dm(), {}, 'im')], p, 50);
  const r = await invoke(['search', 'x', '--limit', '3'], [empty(1), empty(2), empty(3), empty(4), empty(5)]);
  assert.equal(r.exitCode, 0);
  assert.equal(searchUrls().length, 5);
  assert.equal(r.data.matches.length, 0);
  assert.equal(r.data.filtered, 5);
  assert.equal(r.data.pages, 50);
  assert.equal(r.data.next_page, 6);
});
test('fill: --page names the first raw page and next_page continues without a gap', async () => {
  let r = await invoke(['search', 'x', '--limit', '2', '--page', '3'], [
    page([hit(pub), hit(pub)], 3, 9),
  ]);
  assert.equal(searchUrls().length, 1);
  assert.equal(searchUrls()[0]!.searchParams.get('page'), '3');
  assert.equal(r.data.page, 3);
  assert.equal(r.data.next_page, 4);
  r = await invoke(['search', 'x', '--limit', '2', '--page', '9'], [page([hit(pub)], 9, 9)]);
  assert.equal(r.data.next_page, null);
});
test('fill: page 100 is the last requestable page even when Slack reports more', async () => {
  const r = await invoke(['search', 'x', '--limit', '1', '--page', '100'], [page([hit(pub)], 100, 120)]);
  assert.equal(r.data.next_page, null);
});
test('fill: emits at most --limit rows and re-requests the overshot page', async () => {
  const r = await invoke(['search', 'x', '--limit', '3'], [
    page([hit(pub), hit(dm(), {}, 'im')], 1, 5),
    page([hit(pub), hit(pub), hit(pub)], 2, 5),
  ]);
  assert.equal(r.data.matches.length, 3);
  assert.equal(searchUrls().length, 2);
  assert.equal(r.data.next_page, 2);
});
test('fill: a fully consumed final page advances next_page', async () => {
  const r = await invoke(['search', 'x', '--limit', '2'], [page([hit(pub), hit(pub)], 1, 5)]);
  assert.equal(r.data.next_page, 2);
  assert.equal(searchUrls().length, 1);
});
test('fill: an empty page one still validates paging and reports exhaustion', async () => {
  const r = await invoke(['search', 'x'], [page([], 1, 1)]);
  assert.deepEqual(r.data.matches, []);
  assert.equal(r.data.next_page, null);
});

test('text: derived from attachments when text is empty, fields and pretext included', async () => {
  const bot = hit(pub, { text: '', bot_id: 'B123', attachments: [{
    fallback: 'ignored because structured parts exist', pretext: 'Deploy started', title: 'api v2', text: 'rolling out',
    fields: [{ title: 'env', value: 'prod', short: true }, { title: 'by', value: 'ci' }],
  }] });
  const r = await invoke(['search', 'deploy', '--include-bots'], [page([bot], 1, 1)]);
  assert.equal(r.data.matches[0].text, 'Deploy started\napi v2\nrolling out\nenv: prod\nby: ci');
  assert.deepEqual(Object.keys(r.data.matches[0]).sort(), ['bot_id', 'channel_id', 'channel_name', 'permalink', 'reply_count', 'text', 'thread_ts', 'ts', 'user']);
});
test('text: attachment fallback is used only when no structured part exists', async () => {
  const bot = hit(pub, { text: '', attachments: [{ fallback: 'plain summary' }, { title: 'T', fallback: 'dup' }] });
  const r = await invoke(['search', 'x'], [page([bot], 1, 1)]);
  assert.equal(r.data.matches[0].text, 'plain summary\nT');
});
test('text: derived from section, context and rich_text blocks', async () => {
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: 'section body' }, fields: [{ type: 'mrkdwn', text: 'field one' }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'ctx note' }, { type: 'image', image_url: 'https://x/y.png' }] },
    { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'rich ' }, { type: 'link', url: 'https://example.com', text: 'link' }] }] },
    { type: 'divider' },
  ];
  const r = await invoke(['search', 'x'], [page([hit(pub, { text: '', blocks })], 1, 1)]);
  assert.equal(r.data.matches[0].text, 'section body\nfield one\nctx note\nrich link');
});
test('text: non-empty text wins and raw attachments or blocks never reach output', async () => {
  const m = hit(pub, { text: 'human words', attachments: [{ text: 'SECRET-ATTACH' }], blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'SECRET-BLOCK' } }] });
  const r = await invoke(['search', 'x'], [page([m], 1, 1)]);
  assert.equal(r.data.matches[0].text, 'human words');
  assert.ok(!r.stdout.includes('SECRET-'));
  assert.ok(!('attachments' in r.data.matches[0]) && !('blocks' in r.data.matches[0]));
});
test('text: derived text is cleaned, redacted and capped at 2000 code points', async () => {
  const long = 'a\u001b[31m' + TOKEN + '😀'.repeat(2100);
  const r = await invoke(['search', 'x'], [page([hit(pub, { text: '', attachments: [{ text: long }] })], 1, 1)]);
  assert.ok(!r.stdout.includes(TOKEN));
  assert.equal([...r.data.matches[0].text].length, 2000);
  assert.ok(r.data.matches[0].text.startsWith('a[31m[REDACTED]'));
  assert.equal(r.data.truncation[0].path, 'matches[0].text');
});
test('text: a wrong-typed attachment field fails closed', async () => {
  const r = await invoke(['search', 'x'], [page([hit(pub, { text: '', attachments: [{ title: 5 }] })], 1, 1)]);
  assert.equal(r.exitCode, 1);
});
test('text: a message with no text and nothing derivable keeps an empty string', async () => {
  const r = await invoke(['search', 'x'], [page([hit(pub, { text: '' })], 1, 1)]);
  assert.equal(r.data.matches[0].text, '');
});

test('sort: defaults to score desc like the Slack MCP', async () => {
  await invoke(['search', 'x'], [page([], 1, 1)]);
  assert.equal(searchUrls()[0]!.searchParams.get('sort'), 'score');
  assert.equal(searchUrls()[0]!.searchParams.get('sort_dir'), 'desc');
  assert.equal(searchUrls()[0]!.searchParams.get('highlight'), 'false');
});
test('sort: --sort and --sort-dir pass through in both flag forms', async () => {
  await invoke(['search', 'x', '--sort', 'timestamp', '--sort-dir=asc'], [page([], 1, 1)]);
  assert.equal(searchUrls()[0]!.searchParams.get('sort'), 'timestamp');
  assert.equal(searchUrls()[0]!.searchParams.get('sort_dir'), 'asc');
});
test('sort: invalid values and other commands are usage errors before any fetch', async () => {
  for (const args of [['search', 'x', '--sort', 'newest'], ['search', 'x', '--sort-dir', 'up'], ['search', 'x', '--sort', 'Score'],
    ['search', 'x', '--sort'], ['search', 'x', '--sort', 'score', '--sort', 'timestamp'], ['channel', 'list', '--sort', 'score'],
    ['channel', 'list', '--sort-dir', 'asc'], ['channel', 'list', '--include-bots'], ['search', 'x', '--include-bots=1'], ['status', '--include-bots']]) {
    const r = await run(args, { SLACK_AXI_TOKEN: TOKEN });
    assert.equal(r.exitCode, 2, args.join(' '));
  }
  assert.equal(urls.length, 0);
  const a = parse(['search', 'x']);
  assert.deepEqual([a.sort, a.sortDir, a.includeBots], ['score', 'desc', false]);
});

test('query: Slack modifiers pass through unchanged as one query argument', async () => {
  const queries = [
    'in:#general from:@alice deploy', 'in:general -in:random with:@bob has:link is:thread',
    'is:dm from:<@U123> incident', 'has::eyes: before:2026-01-01 after:2025-06-01',
    'on:yesterday during:march "exact phrase" deploy*', 'from:me before:2026-09-30 after:2026-09-01 is:saved has:pin',
  ];
  for (const query of queries) {
    urls = [];
    await invoke(['search', query], [page([], 1, 1)]);
    assert.equal(searchUrls().length, 1);
    assert.equal(searchUrls()[0]!.searchParams.get('query'), query);
  }
  urls = [];
  mocked([page([], 1, 1)]);
  await run(['search', '--json', '--', '-in:random before:2026-01-01'], { SLACK_AXI_TOKEN: TOKEN });
  assert.equal(searchUrls()[0]!.searchParams.get('query'), '-in:random before:2026-01-01');
});

test('bots: excluded by default via bot_id or subtype bot_message and counted in filtered', async () => {
  const matches = [
    hit(pub, { bot_id: 'B123' }), hit(pub, { subtype: 'bot_message' }), hit(pub, { username: 'alice-custom-name' }), hit(pub),
  ];
  const r = await invoke(['search', 'x'], [page(matches, 1, 1)]);
  assert.equal(r.data.matches.length, 2);
  assert.equal(r.data.filtered, 2);
  assert.ok(r.data.matches.every((m: { bot_id: string | null }) => m.bot_id === null));
});
test('bots: --include-bots admits them', async () => {
  const matches = [hit(pub, { bot_id: 'B123' }), hit(pub, { subtype: 'bot_message' }), hit(pub)];
  const r = await invoke(['search', 'x', '--include-bots'], [page(matches, 1, 1)]);
  assert.equal(r.data.matches.length, 3);
  assert.equal(r.data.filtered, 0);
});
test('bots: excluded bot matches do not count toward the fill', async () => {
  const r = await invoke(['search', 'x', '--limit', '2'], [
    page([hit(pub, { bot_id: 'B1' }), hit(pub, { bot_id: 'B2' })], 1, 2),
    page([hit(pub), hit(pub)], 2, 2),
  ]);
  assert.equal(r.data.matches.length, 2);
  assert.equal(r.data.filtered, 2);
});
test('bots: privacy opt-ins still apply to included bot matches', async () => {
  const r = await invoke(['search', 'x', '--include-bots'], [page([hit(priv, { bot_id: 'B1' }, 'group')], 1, 1)]);
  assert.equal(r.data.matches.length, 0);
  assert.equal(r.data.filtered, 1);
});

test('dm labels: im counterpart is resolved through users.info, once per user', async () => {
  const r = await invoke(['search', 'x', '--include-dms'], [
    page([hit(dm('U777'), {}, 'im'), hit(dm('U777'), {}, 'im'), hit(pub)], 1, 1),
    { ok: true, user: { id: 'U777', name: 'jane', real_name: 'Jane Doe', profile: { display_name: '' } } },
  ]);
  assert.equal(r.exitCode, 0);
  const lookups = urls.filter(u => u.pathname === '/api/users.info');
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0]!.searchParams.get('user'), 'U777');
  assert.deepEqual(r.data.matches.map((m: { channel_name: string }) => m.channel_name), ['@Jane Doe', '@Jane Doe', 'general']);
  assert.equal(r.data.matches[0].channel_id, 'D123');
});
test('dm labels: no users.info without im matches, and none for filtered DMs', async () => {
  let r = await invoke(['search', 'x', '--include-dms'], [page([hit(pub), hit(mpim, {}, 'group')], 1, 1)]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.matches[1].channel_name, 'mpdm-a--b-1');
  r = await invoke(['search', 'x'], [page([hit(dm(), {}, 'im')], 1, 1)]);
  assert.equal(r.data.filtered, 1);
  assert.equal(urls.filter(u => u.pathname === '/api/users.info').length, 0);
});
test('dm labels: lookups are capped at ten distinct users, the rest keep the bare ID', async () => {
  const users = Array.from({ length: 12 }, (_, i) => 'U' + String(100 + i));
  const responses: unknown[] = [page(users.map(u => hit(dm(u), {}, 'im')), 1, 1),
    ...users.slice(0, 10).map(u => ({ ok: true, user: { id: u, name: 'n' + u } }))];
  const r = await invoke(['search', 'x', '--include-dms', '--limit', '20'], responses);
  assert.equal(r.exitCode, 0);
  assert.equal(urls.filter(u => u.pathname === '/api/users.info').length, 10);
  assert.equal(r.data.matches[0].channel_name, '@nU100');
  assert.equal(r.data.matches[11].channel_name, 'U111');
});
test('dm labels: a user-lookup failure fails the command loudly', async () => {
  const r = await invoke(['search', 'x', '--include-dms'], [page([hit(dm(), {}, 'im')], 1, 1), { ok: false, error: 'missing_scope' }]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.data.code, 'slack');
});
test('dm labels: an im whose name is absent or not a user ID is left as-is', async () => {
  const noName = { id: 'D999', is_private: true, is_im: true, is_mpim: false };
  const r = await invoke(['search', 'x', '--include-dms'], [page([hit(noName, {}, 'im')], 1, 1)]);
  assert.equal(r.data.matches[0].channel_name, null);
  assert.equal(urls.filter(u => u.pathname === '/api/users.info').length, 0);
});
