#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v785.test.js');
/**
 * worker-v785.test.js — proxy v7.85: /agents one Central day at a time. 10/8: 7- and 14-day loads returned HTTP 500
 * (one request read every perf: and feedback row in the range). A finished day is computed once and stored under
 * agentsday:v785:<date>; today is always read live; each agent row carries the raw sums (regens, chips, draftMsCount,
 * leadIds) the dashboard needs to add days. Runs the SHIPPED handler against a stubbed KV. Placeholder data only.
 *
 * Usage: node tests/worker-v785.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v785.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DIR_KEY = 'LP-TESTDIR3';
const store = new Map([[DIR_KEY, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true })]]);
let gets = 0;
const kv = { put: (k, v) => { store.set(k, v); return Promise.resolve(); }, get: (k) => { gets++; return Promise.resolve(store.has(k) ? store.get(k) : null); },
  list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }, fetch: () => Promise.reject(new Error('no upstream')) };
box.globalThis = box; box.self = box;
vm.createContext(box);
vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
const get = async (q) => { const res = await box.__WORKER.fetch(new Request('https://p.test' + q, { headers: { 'X-LP-Key': DIR_KEY } }), { LEADPRO_LICENSES: kv }, { waitUntil() {} });
  let b = null; try { b = await res.json(); } catch (e) {} return { status: res.status, body: b }; };
const central = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const TODAY = central(Date.now());
const PAST = '2026-09-30';   // CDT: 2026-09-30 15:00Z is 10 AM Central
function seed(day, h, id, agent, lead) {
  const ts = new Date(Date.parse(day + 'T' + String(h + 5).padStart(2, '0') + ':00:00Z')).toISOString();
  store.set('perf:' + ts + ':' + id, JSON.stringify({ ts, requestId: id, contract: 'draft', tier: 'primary', extensionVersion: '9.7.774', latency: 2400, agent }));
  store.set('feedback:' + ts + ':g' + id, JSON.stringify({ id: 'g' + id, ts, rating: 'neutral', signal: 'implicit_regen_copy', regenCount: 2, chipCount: 1, chipsUsed: ['direct'],
    workerRequestId: id, meta: { autoLeadId: lead, store: 'Community Honda Baytown', convState: 'first-touch' } }));
}
(async () => {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.85, /agents per day');
  seed(PAST, 10, 'p1', 'Agent Name', 'TEST001A');
  const first = await get('/agents?date=' + PAST);
  const a = (first.body && first.body.agents && first.body.agents['Agent Name']) || {};
  check('a past day: 200, and the raw sums a client adds days with', [first.status, a.regens, a.chips, a.draftMsCount, a.leadIds], [200, 2, 1, 1, ['TEST001A']]);
  check('(new) the finished day is stored under agentsday:v785:<date>', store.has('agentsday:v785:' + PAST), true);
  seed(PAST, 11, 'p2', 'Agent Name', 'TEST002B');   // a row that appears later must not change a stored day
  gets = 0;
  const again = await get('/agents?date=' + PAST);
  check('...and served from the store after: same answer, one read instead of the day\'s rows', [again.body && again.body.agents['Agent Name'].drafts, gets], [1, 2]);
  seed(TODAY, 3, 't1', 'Agent Name', 'TEST003C');
  await get('/agents?date=' + TODAY);
  seed(TODAY, 4, 't2', 'Agent Name', 'TEST004D');
  const live = await get('/agents?date=' + TODAY);
  check('today is never stored: a second call sees the new row', [store.has('agentsday:v785:' + TODAY), live.body && live.body.agents['Agent Name'].drafts], [false, 2]);
  const multi = await get('/agents?from=2026-09-29&to=' + PAST);
  check('a short from/to range still answers (not stored)', [multi.status, store.has('agentsday:v785:2026-09-29')], [200, false]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + e.message); process.exit(1); });
