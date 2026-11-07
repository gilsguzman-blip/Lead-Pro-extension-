#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v784.test.js');
/**
 * worker-v784.test.js — proxy v7.84: GET /agents, the per-agent breakdown (dashboard v1.9's Agents view), and the
 * license holder (`user`) on POST /feedback rows. Runs the SHIPPED worker handler against a stubbed KV holding perf:
 * and feedback: rows. The trap it pins: feedback meta.agent is the LEAD'S BD Agent, so a director testing on a rep's
 * lead must be credited to the director (the license holder on the joined perf: row), never to the rep.
 * Placeholder licenses and names only.
 *
 * Usage: node tests/worker-v784.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v784.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const AGENT_KEY = 'LP-TESTAGT2', DIR_KEY = 'LP-TESTDIR3';
function makeKV() {
  const store = new Map([[AGENT_KEY, JSON.stringify({ persona: 'bdc', agentName: 'Agent Name', active: true })],
                         [DIR_KEY, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true })]]);
  return { store, put: (k, v) => { store.set(k, v); return Promise.resolve(); }, get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
}
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }, fetch: () => Promise.reject(new Error('no upstream')) };
box.globalThis = box; box.self = box;
vm.createContext(box);
vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const call = async (kv, pathq, init) => {
  const res = await box.__WORKER.fetch(new Request('https://p.test' + pathq, init || {}), { LEADPRO_LICENSES: kv, REQUIRE_LICENSE: 'false' }, ctx);
  let body = null; try { body = await res.json(); } catch (e) {}
  return { status: res.status, body };
};
const get = (kv, q) => call(kv, q, { headers: { 'X-LP-Key': DIR_KEY } });
// 10/08/2026, Central (CDT = UTC-5)
const T = (h, m) => new Date(Date.UTC(2026, 9, 8, h + 5, m, 0)).toISOString();
function seed(kv) {
  const perf = (ts, id, agent, extra) => kv.store.set('perf:' + ts + ':' + id, JSON.stringify(Object.assign({ ts, requestId: id, contract: 'draft', tier: 'primary',
    extensionVersion: '9.7.774', latency: 2000, smsRefine: true, agent }, extra || {})));
  const fb = (ts, id, req, rating, signal, meta, extra) => kv.store.set('feedback:' + ts + ':' + id, JSON.stringify(Object.assign({ id, ts, rating, signal,
    regenCount: 0, chipCount: 0, chipsUsed: [], ...(req ? { workerRequestId: req } : {}), meta: Object.assign({ store: 'Community Honda Baytown', convState: 'first-touch', scenario: 'standard' }, meta) }, extra || {})));
  perf(T(9, 0), 'r1', 'Agent Name');
  perf(T(9, 20), 'r2', 'Agent Name', { latency: 3000 });
  perf(T(10, 5), 'r3', 'Agent Name', { extensionVersion: '9.7.772', latency: 1000 });
  perf(T(10, 6), 'r3f', 'Agent Name', { tier: 'fallback', latency: 8000 });
  perf(T(10, 7), 'r3p', 'Agent Name', { contract: 'fact' });                    // a fact probe is not a draft
  perf(T(11, 0), 'r4', 'Test Director', { extensionVersion: '9.7.774-dev' });
  // Agent Name's sessions: copied as-is, regen then copied, showroom regen-and-left
  fb(T(9, 1), 'g1', 'r1', 'up', 'implicit_copy', { autoLeadId: 'TEST001A', agent: 'Agent Name' });
  fb(T(9, 21), 'g2', 'r2', 'neutral', 'implicit_regen_copy', { autoLeadId: 'TEST001A', agent: 'Agent Name', convState: 'active-follow-up' }, { regenCount: 1 });
  fb(T(10, 6), 'g3', 'r3', 'down', 'implicit_regen_no_copy', { autoLeadId: 'TEST002B', agent: 'Agent Name', scenario: 'showroom' }, { regenCount: 2, chipCount: 2, chipsUsed: ['direct', 'no-appt'] });
  // THE TRAP: the director generated on the rep's lead; meta.agent is the rep (the lead's BD Agent)
  fb(T(11, 1), 'g4', 'r4', 'up', 'explicit', { autoLeadId: 'TEST003C', agent: 'Agent Name' });
  // no perf row to join: credited by `user`, then 'Unattributed'
  fb(T(12, 0), 'g5', 'gone', 'up', 'implicit_copy', { autoLeadId: 'TEST004D', agent: 'Agent Name' }, { user: 'Other Rep' });
  fb(T(12, 5), 'g6', null, 'up', 'implicit_copy', { autoLeadId: 'TEST005E', agent: 'Agent Name' });
}

(async () => {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.84, GET /agents');
  const kv = makeKV(); seed(kv);
  check('director key required', (await call(kv, '/agents?date=2026-10-08')).status, 403);
  const r = await get(kv, '/agents?date=2026-10-08');
  check('director key: 200 (new endpoint)', r.status, 200);
  const A = (r.body && r.body.agents) || {}, a = A['Agent Name'] || {}, d = A['Test Director'] || {};
  check('the director\'s session on the rep\'s lead is the director\'s, not the rep\'s (license holder, not meta.agent)', [d.total, d.explicitUp, a.total], [1, 1, 3]);
  check('attribution: 4 joined by request id, 1 by user, 1 unattributed -- never guessed', r.body && r.body.attribution, { feedback: 6, joined: 4, byUser: 1, unattributed: 1 });
  check('...and those two land under their own names', [(A['Other Rep'] || {}).total, (A['Unattributed'] || {}).total], [1, 1]);
  check('perf side: 3 drafts (a fact probe is not one), 1 failure, builds, latest build, rewrites', [a.drafts, a.failures, a.builds, a.latestBuild, a.rewrites],
    [3, 1, { '9.7.774': 2, '9.7.772': 1 }, '9.7.772', 3]);
  check('active hours, pace, median draft time (primary only, not the 8s fallback)', [a.activeHours, a.perActiveHour, a.medianDraftMs], [2, 1.5, 2000]);
  check('feedback side: the shared bucket rates', [a.shipped, a.firstTry, a.implicitDown, a.engagedShippedRate, a.engagedFirstTryRate], [2, 1, 1, 67, 33]);
  check('leads worked, regens and chips per session, chips used', [a.leads, a.avgRegens, a.avgChips, a.chipFreq], [2, 1, 0.67, { direct: 1, 'no-appt': 1 }]);
  check('mix: first touch / follow-up / showroom', a.mix, { firstTouch: 1, followUp: 1, showroom: 1 });
  check('stores', a.stores, { 'Community Honda Baytown': 3 });
  const empty = await get(kv, '/agents?date=2026-10-07');
  check('a day with nothing: empty, not an error', [empty.status, empty.body && empty.body.agents ? Object.keys(empty.body.agents).length : null], [200, 0]);
  const wide = await get(kv, '/agents?from=2026-09-01&to=2026-10-08');
  check('a range wider than 14 days is capped at 14 (perf: rows live 14 days) and says so', [wide.body && wide.body.dates ? wide.body.dates.length : null, wide.body ? wide.body.capped : null], [14, true]);
  check('bad input: 400', (await get(kv, '/agents?from=2026-10-08&to=2026-10-01')).status, 400);

  console.log(' POST /feedback carries the license holder:');
  const kv2 = makeKV();
  const post = (body) => call(kv2, '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post({ id: 'gen_x1', rating: 'up', signal: 'implicit_copy', licenseKey: AGENT_KEY, meta: { agent: 'Someone Else' } });
  await post({ id: 'gen_x2', rating: 'up', signal: 'implicit_copy', meta: {} });
  const rows = [...kv2.store.entries()].filter(([k]) => k.startsWith('feedback:')).map(([, v]) => v);
  const byId = (id) => JSON.parse(rows.find(x => x.indexOf(id) > -1) || '{}');
  check('user = the license\'s agentName; meta.agent untouched', [byId('gen_x1').user, (byId('gen_x1').meta || {}).agent], ['Agent Name', 'Someone Else']);
  check('the license key is never stored', rows.some(x => x.indexOf('TESTAGT') > -1), false);
  check('no license: no user key at all', 'user' in byId('gen_x2'), false);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + e.message); process.exit(1); });
