#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v786.test.js');
/**
 * worker-v786.test.js — proxy v7.86: a finished Central day of /feedback/range is computed once, stored under
 * rangeday:v786:<date>, and served from there; today is never stored; a multi-day call is unchanged and unstored.
 * Runs the SHIPPED handler against a stubbed KV. Placeholder data only.
 *
 * Usage: node tests/worker-v786.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v786.test.js <cloudflare-worker.js>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DIR = 'LP-TESTDIR3';
const store = new Map([[DIR, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true })]]);
let gets = 0;
const kv = { put: (k, v) => { store.set(k, v); return Promise.resolve(); }, get: (k) => { gets++; return Promise.resolve(store.has(k) ? store.get(k) : null); },
  list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }, fetch: () => Promise.reject(new Error('no upstream')) };
box.globalThis = box; vm.createContext(box);
vm.runInContext(fs.readFileSync(PROXY, 'utf8').replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
const range = async (f, t) => (await box.__WORKER.fetch(new Request(`https://p.test/feedback/range?from=${f}&to=${t}`, { headers: { 'X-LP-Key': DIR } }), { LEADPRO_LICENSES: kv }, { waitUntil() {} })).json();
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const seed = (day, id) => { const ts = new Date(Date.parse(day + 'T17:00:00Z') + (+id.slice(1)) * 1000).toISOString();
  store.set('feedback:' + ts + ':' + id, JSON.stringify({ id, ts, rating: 'up', signal: 'implicit_copy', meta: { store: 'Audi Lafayette' } })); };
(async () => {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.86, a finished day of /feedback/range is stored');
  seed('2026-09-20', 'g1');
  check('a past day answers', (await range('2026-09-20', '2026-09-20')).total, 1);
  check('(new) ...and is stored under rangeday:v786:<date>', store.has('rangeday:v786:2026-09-20'), true);
  seed('2026-09-20', 'g2');
  gets = 0;
  const again = await range('2026-09-20', '2026-09-20');
  check('(new) ...and served from the store after (a later row does not change a finished day; 2 reads, not the day\'s rows)', [again.total, gets], [1, 2]);
  seed(TODAY, 'g3'); await range(TODAY, TODAY); seed(TODAY, 'g4');
  check('today is never stored: a second call sees the new row', [store.has('rangeday:v786:' + TODAY), (await range(TODAY, TODAY)).total], [false, 2]);
  check('a multi-day call is unchanged and not stored', [(await range('2026-09-19', '2026-09-20')).total, store.has('rangeday:v786:2026-09-19')], [2, false]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + e.message); process.exit(1); });
