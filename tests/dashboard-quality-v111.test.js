#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-quality-v111.test.js');
/**
 * dashboard-quality-v111.test.js — dashboard v1.11 + proxy v7.86. Gil, 10/8: "fix the 30 day view also." The Quality
 * view now asks /feedback/range one Central day at a time and adds the days up on the page. The only honest test of an
 * add-up is that it equals the whole: this runs the SHIPPED worker's /feedback/range over a stubbed KV for a 3-day
 * range AND for each day alone, merges the days with the page's own mergeRangeDays, and compares every number the page
 * renders, top line and every bucket, through the page's own readers. (Live, 10/8: seven real single days merged to
 * exactly the real 7-day answer -- 2,805 sessions, 97% / 93%, 149 / 1, 74 no-copy, 139 bucket rows, 0 differences.)
 * Also: the worker's error message reaches the error box, and the version rides on it. Placeholder data only.
 *
 *   usage: dashboard-quality-v111.test.js <dashboard.html> <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm');
const [HTML, PROXY] = process.argv.slice(2);
if (!HTML || !PROXY) { console.error('usage: dashboard-quality-v111.test.js <dashboard.html> <cloudflare-worker.js>'); process.exit(2); }
const html = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
function slice(name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(html); if (!m) return '';
  let i = html.indexOf('{', m.index), depth = 0;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) return html.slice(m.index, j + 1); }
  return '';
}
// the page
const page = { Object, Math, Error, PROXY: 'https://p.test', directorKey: () => 'LP-TESTDIR3', fetchCalls: [] };
vm.createContext(page);
const bc = /const BUCKET_COUNTS = \[[^\]]*\];/.exec(html); if (bc) vm.runInContext(bc[0].replace('const ', 'var '), page);
for (const n of ['mergeBuckets', 'finishBucket', 'mergeRangeDays', 'fetchJSON', 'engagedOf', 'shippedRateOf', 'firstTryRateOf', 'explicitUpOf', 'explicitDownOf', 'implicitDownOf', 'implicitUpOf']) {
  const src = slice(n); if (src) vm.runInContext(src, page);
}
const has = (n) => typeof page[n] === 'function';
// the worker
const DIR = 'LP-TESTDIR3';
const store = new Map([[DIR, JSON.stringify({ persona: 'director', agentName: 'Test Director', active: true })]]);
const kv = { put: (k, v) => { store.set(k, v); return Promise.resolve(); }, get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
  list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
  AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
  caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }, fetch: () => Promise.reject(new Error('no upstream')) };
box.globalThis = box; vm.createContext(box);
vm.runInContext(fs.readFileSync(PROXY, 'utf8').replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
const range = async (f, t) => (await box.__WORKER.fetch(new Request(`https://p.test/feedback/range?from=${f}&to=${t}`, { headers: { 'X-LP-Key': DIR } }), { LEADPRO_LICENSES: kv }, { waitUntil() {} })).json();
// three days of placeholder sessions, a mix of every rating/signal across two stores, personas, sources and a flag
const R = [['up', 'implicit_copy'], ['up', 'explicit'], ['weak_up', 'implicit_chip_copy'], ['neutral', 'implicit_regen_copy'], ['down', 'implicit_regen_no_copy'],
           ['down', 'explicit'], ['abandoned', 'no_interaction'], ['incomplete', 'no_interaction']];
let n = 0;
for (const [day, count] of [['2026-09-20', 11], ['2026-09-21', 7], ['2026-09-22', 13]]) {
  for (let i = 0; i < count; i++) {
    const [rating, signal] = R[(n + i * 3) % R.length];
    const ts = new Date(Date.parse(day + 'T15:00:00Z') + i * 60000).toISOString();
    store.set('feedback:' + ts + ':g' + n, JSON.stringify({ id: 'g' + n, ts, rating, signal, regenCount: i % 3, chipCount: i % 2,
      chipsUsed: i % 2 ? ['direct'] : [], meta: { autoLeadId: 'TEST' + n, store: i % 2 ? 'Community Honda Baytown' : 'Audi Lafayette',
      persona: i % 4 ? 'bdc' : 'sales', leadSource: ['Facebook', 'Showroom', 'Cars.com'][i % 3], flags: i % 5 ? [] : ['showroom'] } }));
    n++;
  }
}
(async () => {
  console.log('\n' + HTML + ' + ' + PROXY + ' — dashboard v1.11, Quality one day at a time');
  const whole = await range('2026-09-20', '2026-09-22');
  const days = [await range('2026-09-20', '2026-09-20'), await range('2026-09-21', '2026-09-21'), await range('2026-09-22', '2026-09-22')];
  const m = has('mergeRangeDays') ? page.mergeRangeDays(days) : null;
  const row = (x) => x ? [x.total, page.shippedRateOf(x), page.firstTryRateOf(x), page.explicitUpOf(x), page.explicitDownOf(x), page.implicitDownOf(x), page.implicitUpOf(x)] : null;
  check('(new helper) the days added up equal the whole range: top line, through the page\'s readers', () => row(m), row(whole));
  check('...every bucket row (store, persona, lead source, flag) equal too', () => {
    if (!m) return 'missing';
    const bad = [];
    for (const b of ['byStore', 'byPersona', 'byLeadSource', 'byFlag']) for (const k of Object.keys(whole[b])) if (JSON.stringify(row(m[b][k])) !== JSON.stringify(row(whole[b][k]))) bad.push(b + ':' + k);
    return [bad, Object.keys(whole.byStore).length + Object.keys(whole.byLeadSource).length > 3]; }, [[], true]);
  check('...signals, ratings, the per-day trend and regens/chips per session equal too', () => m && [JSON.stringify(m.signals) === JSON.stringify(whole.signals),
    JSON.stringify(m.ratings) === JSON.stringify(whole.ratings), JSON.stringify(Object.keys(m.byDay).sort()) === JSON.stringify(Object.keys(whole.byDay).sort()),
    Math.abs(m.avgRegens - whole.avgRegens) < 0.011, Math.abs(m.avgChips - whole.avgChips) < 0.011], [true, true, true, true, true]);
  check('a merged bucket carries no stale rate field (rates are re-derived, never averaged)', () => m && ['engagedShippedRate' in m.byStore['Audi Lafayette'], 'shippedRate' in m], [false, false]);
  await acheck('(new helper) a failed request carries the worker\'s own message, not a bare status', async () => {
    if (!has('fetchJSON')) return 'missing';
    page.fetch = () => Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({ error: 'Too many API requests by single worker invocation' }) });
    try { await page.fetchJSON('https://p.test/agents?date=2026-10-07'); return 'no error'; } catch (e) { return e.message; } },
    'HTTP 500 — Too many API requests by single worker invocation');
  check('the Quality view loads ranges by day, names a failed day, and every error box carries the version', () =>
    [/const d = n > 0 \? await fetchRangeByDay\(n\) : await fetchRange\(fmtDate\(0\), fmtDate\(0\)\);/.test(html), /data\.failedDays\.map/.test(html),
     (html.match(/'Error: ' \+ error \+ ' · dashboard ' \+ DASH_VERSION/g) || []).length], [true, true, 2]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + e.message); process.exit(1); });
