#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v783.test.js');
/**
 * worker-v783.test.js — proxy v7.83: perf: rows record which rep sent the request (the license's agentName, never
 * the key), and /perf tallies calls per build and per rep per build. Runs the SHIPPED worker handler: POST /generate
 * with a scripted upstream, then GET /perf over the rows it wrote. Placeholder licenses only.
 *
 * Usage: node tests/worker-v783.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v783.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const AGENT_KEY = 'LP-TESTAGT2', DIR_KEY = 'LP-TESTDIR3';
const SYS = 'You are a BDC agent. '.repeat(300) + '⟦LP_CACHE_BREAKPOINT⟧\nPERSONA: agent.\n', USER = 'Lead context. '.repeat(400);
const DRAFT = JSON.stringify({ sms: 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive.',
  subject: 'Your Accord', email: 'Hi there,\n\nThe Accord is here and ready for you to see whenever works.\n\nAgent', voicemail: 'Hi, Agent at the store about the Accord. It is here and ready.' });
function makeKV() {
  const store = new Map([[AGENT_KEY, JSON.stringify({ persona: 'bdc', agentName: 'Test Agent', active: true })],
                         [DIR_KEY, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true })]]);
  return { store, put: (k, v) => { store.set(k, v); return Promise.resolve(); }, get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
}
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, crypto, setTimeout, clearTimeout,
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
  fetch: (u, o) => { const p = o && o.body ? JSON.parse(o.body) : {};
    const text = p.model === 'gpt-4.1-nano' ? 'NO' : DRAFT;
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 5000 } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })); } };
box.globalThis = box; box.self = box;
vm.createContext(box);
vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);

async function gen(kv, env, extra) {
  const waits = [];
  const ctx = { waitUntil: (p) => { waits.push(p); if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };
  const req = new Request('https://p.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({
    system_instruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text: USER }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json' }, noEdgeCache: true }, extra)) });
  const res = await box.__WORKER.fetch(req, Object.assign({ LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test' }, env), ctx);
  await Promise.all(waits.map(p => Promise.resolve(p).catch(() => {})));
  return res.status;
}
const perfRows = (kv) => [...kv.store.entries()].filter(([k]) => k.startsWith('perf:')).map(([, v]) => v);

(async () => {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.83, the rep on perf: rows');
  let kv = makeKV();
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { licenseKey: AGENT_KEY, extensionVersion: '9.7.758' });
  let rows = perfRows(kv);
  check('REQUIRE_LICENSE off: one perf row, agent = the license\'s name', rows.length === 1 && JSON.parse(rows[0]).agent, 'Test Agent');
  check('...the license key itself is nowhere in the row', rows.some(r => r.indexOf('TESTAGT') > -1 || /"_lk"/.test(r)), false);
  check('...and the build is still there', JSON.parse(rows[0]).extensionVersion, '9.7.758');
  kv = makeKV();
  await gen(kv, { REQUIRE_LICENSE: 'true' }, { licenseKey: AGENT_KEY, extensionVersion: '9.7.758' });
  rows = perfRows(kv);
  check('REQUIRE_LICENSE on: the looked-up license supplies the name, key not stored', [JSON.parse(rows[0]).agent, rows[0].indexOf('TESTAGT') > -1], ['Test Agent', false]);
  kv = makeKV();
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { extensionVersion: '9.7.756' });
  check('no license on the request -> agent null', JSON.parse(perfRows(kv)[0]).agent, null);
  kv = makeKV();
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { licenseKey: 'LP-NOTAKEY9', extensionVersion: '9.7.754' });
  check('an unknown license -> agent null, key not stored', [JSON.parse(perfRows(kv)[0]).agent, perfRows(kv)[0].indexOf('NOTAKEY') > -1], [null, false]);

  console.log(' /perf tallies:');
  kv = makeKV();
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { licenseKey: AGENT_KEY, extensionVersion: '9.7.758' });
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { licenseKey: AGENT_KEY, extensionVersion: '9.7.758' });
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { licenseKey: DIR_KEY, extensionVersion: '9.7.754' });
  await gen(kv, { REQUIRE_LICENSE: 'false' }, { extensionVersion: '9.7.756' });
  const old = { ts: new Date().toISOString(), requestId: 'old-row', extensionVersion: '9.7.750', contract: 'draft', tier: 'primary' };
  kv.store.set('perf:' + old.ts + ':old-row', JSON.stringify(old));   // a v7.82 row: no agent key at all
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const res = await box.__WORKER.fetch(new Request('https://p.test/perf', { method: 'GET', headers: { 'X-LP-Key': DIR_KEY } }),
    { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false' }, ctx);
  const t = res.status === 200 ? (await res.json()).tallies : {};
  check('byAgentVersion: who is on which build', t.byAgentVersion, { 'Test Agent': { '9.7.758': 2 }, 'Test Director': { '9.7.754': 1 }, '(no license)': { '9.7.756': 1 }, '(not recorded)': { '9.7.750': 1 } });
  check('byVersion: calls per build', t.byVersion, { '9.7.758': 2, '9.7.754': 1, '9.7.756': 1, '9.7.750': 1 });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
