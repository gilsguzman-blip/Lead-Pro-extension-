#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v782.test.js');

/**
 * worker-v782.test.js — proxy v7.82: the director-only read endpoints also take "Authorization: Bearer <key>",
 * the only form Claude's environment credentials can send. Runs the SHIPPED worker handler with GET requests
 * against a KV holding one director and one BDC license (placeholder keys).
 *
 * Usage: node tests/worker-v782.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v782.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DIR = 'LP-TESTDIR2', BDC = 'LP-TESTBDC3';
const store = new Map([
  [DIR, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true, expiresAt: null })],
  [BDC, JSON.stringify({ persona: 'bdc', agentName: 'Test Agent', active: true, expiresAt: null })]]);
const kv = { get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null), put: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true }) };
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, crypto, setTimeout, clearTimeout,
  fetch: () => Promise.reject(new Error('no upstream in this test')),
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
box.globalThis = box; box.self = box;
vm.createContext(box);
vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
const env = { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false' };
const ctx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };
const get = async (p, headers) => (await box.__WORKER.fetch(new Request('https://p.test' + p, { method: 'GET', headers: headers || {} }), env, ctx)).status;

(async () => {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.82, director reads via Authorization: Bearer');
  check('control: no key -> 403', await get('/feedback/summary'), 403);
  check('control: X-LP-Key with the director key -> 200 (unchanged)', await get('/feedback/summary', { 'X-LP-Key': DIR }), 200);
  check('control: ?key= with the director key -> 200 (unchanged)', await get('/feedback/summary?key=' + DIR), 200);
  check('Authorization: Bearer <director key> -> 200 on /feedback/summary', await get('/feedback/summary', { Authorization: 'Bearer ' + DIR }), 200);
  check('...and on /feedback/range', await get('/feedback/range?from=2026-10-01&to=2026-10-02', { Authorization: 'Bearer ' + DIR }), 200);
  check('...lowercase "bearer" and a lowercase key are accepted (the key is normalised as before)', await get('/feedback/summary', { Authorization: 'bearer ' + DIR.toLowerCase() }), 200);
  check('Bearer <a BDC license> -> 403: the director check still runs', await get('/feedback/summary', { Authorization: 'Bearer ' + BDC }), 403);
  check('Bearer <unknown key> -> 403', await get('/feedback/summary', { Authorization: 'Bearer LP-NOTAKEY9' }), 403);
  check('"Authorization: Basic ..." is not read as a key -> 403', await get('/feedback/summary', { Authorization: 'Basic ' + DIR }), 403);
  check('a bad X-LP-Key is not rescued by a good Bearer (the explicit header wins, as ?key= does)', await get('/feedback/summary', { 'X-LP-Key': BDC, Authorization: 'Bearer ' + DIR }), 403);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
