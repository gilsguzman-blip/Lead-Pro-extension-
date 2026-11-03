#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('reporter-v125.test.js');
// (reporter v1.25) AUDIT PHASE 2, BATCH 3 -- measurement only. M-4: (1) a tier failure that a later tier answered is
// Recovered, not a failure; Served safe fallback and Nothing served are what count against completion; (2) latency and
// counts per contract, full drafts first, each cache key labeled from a few of its own perf rows; (3) "Regen Rate" was the
// proxy's classifier regen and is named so; (4) the comprehension footnote is computed from the Changed column. M-9 step 2:
// per cache key, per minute, full drafts against warm hits. Drives the shipped parseLogs, buildReport and _labelCacheKeys on
// Logpush-shaped entries shaped like 11/2 (two recovered primaries; drafts about 2 s; fact probes and edge hits fast).
// Placeholder data only.
//
// Usage: node tests/reporter-v125.test.js <reporter.js>
const fs = require('fs'), vm = require('vm');
const FILE = process.argv[2];
if (!FILE) { console.error('usage: reporter-v125.test.js <reporter.js>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const box = { console: { log() {}, warn() {}, error() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Array, RegExp, Intl, Promise };
box.globalThis = box; vm.createContext(box);
vm.runInContext(fs.readFileSync(FILE, 'utf8').replace(/^export default\s*\{/m, 'globalThis.__R = {'), box);
const get = (n) => { try { return vm.runInContext(n, box); } catch (e) { return null; } };
const parse = get('parseLogs'), build = get('buildReport'), label = get('typeof _labelCacheKeys === "function" ? _labelCacheKeys : null');

// 11/2 at 08:00 CT (CST since 11/1) = 14:00Z. Full drafts on key lp_draft, rewrites on lp_rfn, fact probes on lp_fact, two edge hits.
const T0 = Date.parse('2026-11-02T14:00:00.000Z');
let seq = 0;
const rid = () => 'aaaaaaaa-0000-4000-8000-' + String(++seq).padStart(12, '0');
const entry = (dtMs, wall, msgs) => ({ EventTimestampMs: T0 + dtMs, WallTimeMs: wall, Outcome: 'ok', Logs: msgs.map(m => ({ Message: [m], TimestampMs: T0 + dtMs })) });
const ok = (key, contract, ms, cached, extra) => { const id = rid(); return { id, key, e: (dt) => entry(dt, ms + 50, [
  `[${id}] START tokens=3000(caller; tiers use spec.tokens) effort=none cacheKey=${key} contract=${contract} ext=9.7.851`,
  ...(extra || []).map(x => `[${id}] ` + x),
  `[${id}] PRIMARY OK gpt-6-luna ${ms}ms`, ...(cached !== null ? [`[${id}] CACHE primary cached=${cached}/10000`] : []), `[${id}] FINAL total=${ms + 20}ms regenerated=false`]) }; };
const E = [], PERF = {};
const add = (r, dt, perf) => { E.push(r.e(dt)); if (perf) PERF['perf:2026-11-02T14:00:' + String(dt).padStart(6, '0') + 'Z:' + r.id] = Object.assign({ requestId: r.id }, perf); };
// minute 0: 1 full draft (warm); minute 1: 5 full drafts (2 warm); minute 2: 12 full drafts (3 warm)
add(ok('lp_draft', 'draft', 2000, 2400), 0, { contract: 'draft', fullDraft: true, smsRefine: false });
for (let i = 0; i < 5; i++) add(ok('lp_draft', 'draft', 1900 + i * 20, i < 2 ? 2400 : 0), 60000 + i * 1000, { contract: 'draft', fullDraft: true, smsRefine: false });
for (let i = 0; i < 12; i++) add(ok('lp_draft', 'draft', 2050 + i * 10, i < 3 ? 2400 : 0), 120000 + i * 1000, { contract: 'draft', fullDraft: true, smsRefine: false });
for (let i = 0; i < 6; i++) add(ok('lp_rfn', 'draft', 900, 0), 180000 + i * 1000, { contract: 'draft', fullDraft: false, smsRefine: true });
for (let i = 0; i < 20; i++) add(ok('lp_fact', 'fact', 140, null), 240000 + i * 1000, { contract: 'fact', fullDraft: false, smsRefine: false });
// two recovered primaries on full drafts (a timeout, a 429), as on 11/2
const rec1 = rid(), rec2 = rid();
E.push(entry(300000, 14200, [`[${rec1}] START tokens=3000 effort=none cacheKey=lp_draft contract=draft ext=9.7.851`, `[${rec1}] PRIMARY FAIL gpt-6-luna 12000ms → Timeout 12000ms`, `[${rec1}] FALLBACK OK gpt-5.6-luna 2100ms`, `[${rec1}] FINAL total=14150ms regenerated=false`]));
E.push(entry(301000, 3300, [`[${rec2}] START tokens=3000 effort=none cacheKey=lp_draft contract=draft ext=9.7.851`, `[${rec2}] PRIMARY FAIL gpt-6-luna 1200ms status=429 → Rate limit reached`, `[${rec2}] FALLBACK OK gpt-5.6-luna 2000ms`, `[${rec2}] FINAL total=3250ms regenerated=false`]));
// two edge hits (no START line: the HIT returns before a request id exists)
E.push(entry(302000, 6, ['[EDGE-CACHE] HIT'])); E.push(entry(303000, 7, ['[EDGE-CACHE] HIT']));

const reqs = parse ? parse(E) : [];
const ALL_TIERS = (id, contract, line) => entry(400000, 24100, [`[${id}] START tokens=3000 effort=none cacheKey=lp_x contract=${contract}`, `[${id}] PRIMARY FAIL gpt-6-luna 12000ms → Timeout 12000ms`,
  `[${id}] FALLBACK FAIL gpt-5.6-luna 8000ms → Timeout 8000ms`, `[${id}] EMERGENCY FAIL gpt-4.1-mini 4000ms → Timeout 4000ms`, `[${id}] ${line}`]);

(async () => {
console.log(' 1. what the log lines say about each request:');
check('START gives the request id, cache key and contract; edge hits are marked', () =>
  [reqs.length, reqs.filter(r => r.cacheKey === 'lp_draft').length, reqs.filter(r => r.contract === 'fact').length, reqs.filter(r => r.edgeHit).length, !!reqs[0].requestId],
  [48, 20, 20, 2, true]);
const extra = parse ? parse([ALL_TIERS(rid(), 'draft', 'SAFE_FALLBACK after 24050ms lastTier=EMERGENCY'), ALL_TIERS(rid(), 'fact', 'TIERS EXHAUSTED (contract=fact, no safe fallback served)')]) : [];
check('SAFE_FALLBACK and TIERS EXHAUSTED are read', () => extra.map(r => [!!r.safeFallback, !!r.exhausted]), [[true, false], [false, true]]);

console.log(' 2. labels from perf rows, bounded:');
let gets = 0;
const listKeys = async (prefix) => Object.keys(PERF).filter(k => k.indexOf(prefix) === 0);
const getRow = async (name) => { gets++; return PERF[name] || null; };
const labels = label ? await label(reqs, ['perf:2026-11-02', 'perf:2026-11-03'], listKeys, getRow, 3) : null;
check('each key is labeled by its own rows: full draft, SMS rewrite, fact probe', () => labels && [labels.lp_draft.label, labels.lp_rfn.label, labels.lp_fact.label, labels.lp_draft.agree],
  ['Full draft', 'SMS rewrite', 'Fact probe', true]);
check('at most 3 reads per key (9 for 3 keys), not one per request (46)', () => gets, 9);

console.log(' 3. the 11/2 shape, re-rendered:');
const out = build ? build(reqs, '2026-11-02', null, null, labels) : { html: '', text: '' };
const tile = (name) => { const m = out.html.match(new RegExp('>' + name.replace(/[()]/g, '\\$&') + '</div>\\s*<div[^>]*>([^<]*)<')); return m ? m[1] : null; };
check('Recovered 2, Served safe fallback 0, Nothing served 0, Completion 100.0%', () => [tile('Recovered'), tile('Served safe fallback'), tile('Nothing served (non-draft)'), tile('Completion Rate')],
  ['2', '0', '0', '100.0%']);
check('the failures section says the two were recovered', () => /Failures \(2\) · requests with a failed tier: 2 recovered, 0 served safe fallback, 0 nothing served/.test(out.html), true);
const ct = (out.html.match(/By Contract \(full drafts first\)[\s\S]*?<\/table>/) || [''])[0];
const rowsOf = ct.split('<tr>').slice(2).map(r => (r.match(/>([^<]*)<\/td>/g) || []).map(x => x.replace(/^>|<\/td>$/g, '')));
check('by contract, full drafts first: 20 drafts, median about 2 s', () => rowsOf.map(r => r.slice(0, 2)),
  [['Full draft', '20'], ['SMS rewrite', '6'], ['Fact probe', '20'], ['Edge cache hit', '2']]);
check('the draft median is about 2 s (the all-contracts median is pulled down by probes and edge hits)', () => {
  const med = +String((rowsOf[0] || [])[2]).replace('ms', ''); return med >= 1900 && med <= 2200; }, true);
check('the two recovered requests are in the full-draft row', () => (rowsOf[0] || [])[5], '2');
check('"Classifier regen", not "Regen Rate"', () => [/>Classifier regen</.test(out.html), /Regen Rate/.test(out.html), /Classifier regen : /.test(out.text)], [true, false, true]);
const noLabels = build ? build(reqs, '2026-11-02', null, null, null) : { html: '' };
check('with no perf rows the drafts are unlabeled and the page says why', () =>
  [/Draft contract \(key unlabeled\)/.test(noLabels.html), /No perf rows were read/.test(noLabels.html)], [true, true]);

console.log(' 4. cache load per key (M-9 step 2, measure only):');
const cl = (out.html.match(/Cache Load per Key \(measure only\)[\s\S]*?<\/table>/) || [''])[0];
check('the full-draft key: peak 12/min, and warm hits by load: 1/min 100%, 4-6/min 40%, 11-15/min 25%', () =>
  [/lp_draft · Full draft · 20 requests · peak 12\/min at 08:02 CT/.test(cl), /<td[^>]*>1<\/td><td[^>]*>1<\/td><td[^>]*>1<\/td><td[^>]*>100%<\/td>/.test(cl.replace(/\s+/g, '')),
   /4–6<\/td>[\s\S]*?40%/.test(cl), /11–15<\/td>[\s\S]*?25%/.test(cl)], [true, true, true, true]);

console.log(' 5. the comprehension footnote is computed:');
const cd = (changed, auth) => ({ total: 30, deltas: {}, verifiedDeltas: {}, bySource: {}, byNoteType: {}, byVersion: {}, disagreements: [], regexFired: 0, compFired: 0,
  unverifiedProbe: 0, comparable: 0, authoritativeRows: auth, byDetector: { 'day-lock': { total: 10, usable: 10, agree: 10, disagree: 0, fabricated: 0, probeFailed: 0, changedDirective: changed, defaulted: 0 } } });
const f0 = build ? build(reqs, '2026-11-02', null, cd(0, 0), labels).html : '', f2 = build ? build(reqs, '2026-11-02', null, cd(2, 30), labels).html : '';
check('Changed 0 -> "No comprehension verdict changed a shipped directive on this day"; the static claim is gone', () =>
  [/No comprehension verdict changed a shipped directive on this day/.test(f0), /has ever changed a customer-facing message/.test(f0), /authoritative switch was on for 0 of 30 rows/.test(f0)], [true, false, true]);
check('Changed 2 -> "Comprehension changed 2 shipped directives on this day"', () => /Comprehension changed 2 shipped directives on this day/.test(f2), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
