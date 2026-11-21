#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v793.test.js');
/**
 * worker-v793.test.js — proxy v7.93, the proxy batch (owner, 11/17: "go with C, build the proxy batch").
 *   1  PF-6: a draft whose request says phoneAskCheck: 'render' is not held for the phone-ask classifier; a request without it
 *      (an older extension) is classified exactly as before.
 *   2  PF-2 step 2: GET /inventory and GET /valuefact carry a version and answer {unchanged:true} to ?since=<that version>.
 *   3  L-10: perf: rows ride as their key's KV metadata, and /perf reads them from the list with no get; a key without metadata
 *      (a row written before v7.93) is still read with a get.
 * Runs the SHIPPED fetch handler over a stubbed KV and model API. [new] fails on v7.92, [control] passes on both.
 * Placeholder data only.
 *
 *   usage: worker-v793.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v793.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const SENTINEL = '⟦LP_CACHE_BREAKPOINT⟧';
const SYS = 'You are a BDC agent. '.repeat(300) + SENTINEL + '\nPERSONA: agent at the store.\n';
const USER_PHONE = 'Lead context. '.repeat(400) + '\nCustomer Phone: (555) 010-0199  ← already on file. Do NOT ask for a phone number.\n';
const SMS = 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive so the visit is quick.';
const BODY = 'Hi there,\n\nThe Accord is here and ready for you to see whenever works. I can have everything staged so the visit is quick.\n\nAgent Name';
const GOOD = JSON.stringify({ sms: SMS, subject: 'Your Accord', email: BODY, voicemail: 'Hi, this is Agent Name about the Accord.' });
const USAGE = { prompt_tokens: 12000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 0 } };

function makeKV(seed) {
  const store = new Map(Object.entries(seed || {})), meta = new Map(), gets = [], puts = [];
  return { store, meta, gets, puts,
    put: (k, v, o) => { puts.push({ k, o }); store.set(k, v); meta.set(k, (o && o.metadata) || null); return Promise.resolve(); },
    get: (k) => { gets.push(k); return Promise.resolve(store.has(k) ? store.get(k) : null); },
    list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort()
      .map(name => (meta.get(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: true }) };
}
function load() {
  const calls = [], logs = [];
  const box = { console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl, AbortController, Promise, Date, Math, JSON, String, Number, Object, Array,
    RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout, caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
  const answer = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: USAGE }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  box.fetch = (url, o) => {
    const p = o && o.body ? JSON.parse(o.body) : {};
    const isCls = /You are a binary classifier/.test(JSON.stringify(p.messages || ''));
    calls.push(isCls ? 'classifier' : 'draft');
    return Promise.resolve(answer(isCls ? 'NO' : GOOD));
  };
  box.globalThis = box; box.self = box; vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  return { box, calls, logs };
}
async function generate(extra) {
  const w = load(), kv = makeKV(), waits = [];
  const ctx = { waitUntil: (p) => { waits.push(p); if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };
  const env = { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false', DIRECTOR_KEYS: 'TESTDIRECTORKEY' };
  const req = new Request('https://p.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({
    system_instruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text: USER_PHONE }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json' } }, extra || {})) });
  const res = await w.box.__WORKER.fetch(req, env, ctx);
  await Promise.all(waits.map(p => Promise.resolve(p).catch(() => {})));
  const perf = [...kv.store.entries()].filter(([k]) => /^perf:/.test(k)).map(([, v]) => JSON.parse(v));
  return { status: res.status, calls: w.calls, logs: w.logs, kv, perf, env, w };
}
async function get(w, kvReg, p) {
  const res = await w.box.__WORKER.fetch(new Request('https://p.test' + p), { LEADPRO_REGISTRY: kvReg, LEADPRO_LICENSES: makeKV() }, { waitUntil() {}, passThroughOnException() {} });
  return res.json();
}

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.93, the proxy batch');

  console.log('\n1. PF-6: a draft the panel checks is not held for the classifier:');
  const rr = await generate({ phoneAskCheck: 'render' });
  check('[new] phoneAskCheck: "render", phone on file -> no classifier call, only the draft', rr.calls, ['draft']);
  check('[new] ...the log says why, and the perf row says skipped', [rr.logs.some(l => /CLASSIFY skipped \(the extension checks at render\)/.test(l)), (rr.perf[0] || {}).classifier], [true, 'skipped']);
  const old = await generate({});
  check('[control] no field (an older extension), phone on file -> both classifier calls, as before', old.calls, ['draft', 'classifier', 'classifier']);
  check('[control] ...and its FINAL line carries classifyMs', old.logs.some(l => /FINAL .* classifyMs=\d+/.test(l)), true);

  console.log('\n2. PF-2 step 2: ?since= on the store feeds:');
  const w = load();
  const reg = makeKV({ 'inventory:6191': JSON.stringify({ store: 'Community Honda Baytown', count: 1, generated: '2026-11-17', units: [{ stock: 'TEST001A', vehicle: '2026 Honda Accord SE' }] }),
    'valuefact:6191': JSON.stringify({ store: 'Community Honda Baytown', count: 1, generated: '2026-11-17', incentives: [{ model: 'Accord', text: 'Placeholder offer', expires: '2099-12-31' }] }) });
  const i1 = await get(w, reg, '/inventory?dealer=6191');
  check('[new] the full inventory answer carries a version', [typeof i1.version, !!(i1.inventory && i1.inventory.units.length)], ['string', true]);
  const i2 = await get(w, reg, '/inventory?dealer=6191&since=' + encodeURIComponent(i1.version || 'x'));
  check('[new] since=<that version> -> {unchanged:true}, no units sent', [i2.unchanged, i2.version === i1.version, 'inventory' in i2], [true, true, false]);
  reg.store.set('inventory:6191', JSON.stringify({ store: 'Community Honda Baytown', count: 2, generated: '2026-11-17', units: [{ stock: 'TEST001A' }, { stock: 'TEST002B' }] }));
  const i3 = await get(w, reg, '/inventory?dealer=6191&since=' + encodeURIComponent(i1.version || 'x'));
  check('[new] the feed changed -> the full feed and a new version', [!!i3.unchanged, (i3.inventory || {}).count, i3.version !== i1.version], [false, 2, true]);
  const v1 = await get(w, reg, '/valuefact?dealer=6191');
  const v2 = await get(w, reg, '/valuefact?dealer=6191&since=' + encodeURIComponent(v1.version || 'x'));
  check('[new] /valuefact the same way: a version, then {unchanged:true}', [typeof v1.version, (v1.valuefact || {}).count, v2.unchanged], ['string', 1, true]);
  check('[control] no since= -> the v7.92 answer, field for field, plus version', Object.keys(v1).filter(k => k !== 'version'), ['ok', 'valuefact']);

  console.log('\n3. L-10: perf rows ride as metadata, and /perf reads them with no get:');
  const pk = [...old.kv.meta.keys()].filter(k => /^perf:/.test(k));
  check('[new] the perf put carries the row as its metadata (and keeps the 14-day TTL)', [pk.length, !!old.kv.meta.get(pk[0]), (old.kv.puts.find(p => p.k === pk[0]).o || {}).expirationTtl], [1, true, 1209600]);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  old.kv.gets.length = 0;
  const pr = await (await old.w.box.__WORKER.fetch(new Request('https://p.test/perf?date=' + day, { headers: { 'X-LP-Key': 'TESTDIRECTORKEY' } }), old.env, { waitUntil() {}, passThroughOnException() {} })).json();
  check('[new] /perf returns the row with 0 KV gets', [pr.count, old.kv.gets.filter(k => /^perf:/.test(k)).length], [1, 0]);
  old.kv.meta.set(pk[0], null); old.kv.gets.length = 0;
  const pr2 = await (await old.w.box.__WORKER.fetch(new Request('https://p.test/perf?date=' + day, { headers: { 'X-LP-Key': 'TESTDIRECTORKEY' } }), old.env, { waitUntil() {}, passThroughOnException() {} })).json();
  check('[control] a row written before v7.93 (no metadata) is still read, with a get', [pr2.count, old.kv.gets.filter(k => /^perf:/.test(k)).length], [1, 1]);

  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
