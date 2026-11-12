#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('reporter-v126.test.js');
// (reporter v1.26, proxy v7.92) AUDIT #2 BATCH A -- measurement only. MS-1.1: a request with no START line is labeled by its URL path
// (4,550 of 11/9's 5,454 requests were "Unknown"). MS-1.2: the Directives table from the feedback rows' meta.directives (extension
// 9.7.868). MS-1.3: prompt length from meta.promptChars. MS-1.4: the note-type table only when types are recorded. MS-1.5: key-info
// rows kept, and the proxy's classifyMs on its FINAL line. Drives the shipped parseLogs, buildReport and _feedbackMeasures on
// Logpush-shaped entries; and checks the proxy writes classifyMs where the classifier ran. Placeholder data only.
//
// Usage: node tests/reporter-v126.test.js <reporter.js> [proxy.js]
const fs = require('fs'), vm = require('vm');
const FILE = process.argv[2], PROXY = process.argv[3];
if (!FILE) { console.error('usage: reporter-v126.test.js <reporter.js> [proxy.js]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const box = { console: { log() {}, warn() {}, error() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Array, RegExp, Intl, Promise, URL, Set };
box.globalThis = box; vm.createContext(box);
vm.runInContext(fs.readFileSync(FILE, 'utf8').replace(/^export default\s*\{/m, 'globalThis.__R = {'), box);
const get = (n) => { try { return vm.runInContext('typeof ' + n + ' === "function" ? ' + n + ' : null', box); } catch (e) { return null; } };
const parse = get('parseLogs'), build = get('buildReport'), measures = get('_feedbackMeasures');

const T0 = Date.parse('2026-11-10T15:00:00.000Z');
let seq = 0; const rid = () => 'bbbbbbbb-0000-4000-8000-' + String(++seq).padStart(12, '0');
const entry = (dt, wall, url, msgs) => ({ EventTimestampMs: T0 + dt, WallTimeMs: wall, Outcome: 'ok', Event: { Request: { URL: url, Method: 'GET' } }, Logs: msgs.map(m => ({ Message: [m], TimestampMs: T0 + dt })) });
const draft = (dt, ms, cls) => { const id = rid(); return entry(dt, ms + 40, 'https://proxy.example.invalid/generate', [`[${id}] START tokens=3000 effort=none cacheKey=lp_draft contract=draft ext=9.7.868`,
  `[${id}] PRIMARY OK gpt-6-luna ${ms}ms`, ...(cls != null ? [`[${id}] CLASSIFY sms=NO email=NO phoneOnFile=true`] : []),
  `[${id}] FINAL total=${ms + 20}ms regenerated=false flagged=false classifyFailed=false` + (cls != null ? ` classifyMs=${cls}` : '')]); };
const E = [];
for (let i = 0; i < 6; i++) E.push(draft(i * 1000, 4000 + i * 50, [380, 420, 450, 500, 610, null][i]));
for (let i = 0; i < 20; i++) E.push(entry(10000 + i * 100, 90, 'https://proxy.example.invalid/inventory?dealer=6190', []));
for (let i = 0; i < 8; i++) E.push(entry(20000 + i * 100, 70, 'https://proxy.example.invalid/valuefact?dealer=6190', []));
E.push(entry(30000, 40, 'https://proxy.example.invalid/feedback', ['[FEEDBACK] up | implicit_copy | Community Kia Baytown']));
E.push({ EventTimestampMs: T0 + 31000, WallTimeMs: 12, Outcome: 'ok', Logs: [{ Message: ['something'], TimestampMs: T0 + 31000 }] });   // no URL, no START

const reqs = parse ? parse(E) : [];
console.log(' 1. every request has a name (MS-1.1):');
check('requests with no START line carry their path', () => [reqs.filter(r => r.path === '/inventory').length, reqs.filter(r => r.path === '/valuefact').length, reqs.filter(r => r.path === '/feedback').length], [20, 8, 1]);
const out = build ? build(reqs, '2026-11-10', null, null, { lp_draft: { label: 'Full draft', agree: true } }) : { html: '' };
const ct = (out.html.match(/By Contract \(full drafts first\)[\s\S]*?<\/table>/) || [''])[0];
const rowsOf = ct.split('<tr>').slice(2).map(r => (r.match(/>([^<]*)<\/td>/g) || []).map(x => x.replace(/^>|<\/td>$/g, '')));
check('the contract table: full drafts first, then each route by volume, Unknown last', () => rowsOf.map(r => r.slice(0, 2)),
  [['Full draft', '6'], ['Route /inventory', '20'], ['Route /valuefact', '8'], ['Route /feedback', '1'], ['Unknown (no START line)', '1']]);

console.log(' 2. the classifier\'s time (MS-1.5, proxy v7.92):');
check('classifyMs is read off the FINAL line; absent when the classifier did not run', () => reqs.filter(r => r.classifyMs != null).map(r => r.classifyMs), [380, 420, 450, 500, 610]);
check('the Classify section gives median, P95 and max over the classified drafts', () => /Classifier time per draft \(the draft waits for it\): median 450ms · P95 \d+ms · max 610ms over 5 drafts/.test(out.html), true);
const old = parse ? parse([entry(0, 4100, 'https://proxy.example.invalid/generate', ['[cccccccc-0000-4000-8000-000000000001] START tokens=3000 effort=none cacheKey=lp_draft contract=draft',
  '[cccccccc-0000-4000-8000-000000000001] CLASSIFY sms=NO email=NO phoneOnFile=true', '[cccccccc-0000-4000-8000-000000000001] FINAL total=4100ms regenerated=false flagged=false classifyFailed=false'])]) : [];
check('control: a v7.91 proxy\'s FINAL line -> "not logged", and the request still parses', () => [old.length, old[0] && old[0].final.total, /Classifier time: not logged \(proxy before v7\.92\)/.test(build ? build(old, '2026-11-10', null, null, null).html : '')], [1, 4100, true]);

console.log(' 3. what the prompts carried (MS-1.2, 1.3, 1.5):');
const row = (rating, dirs, chars, ki) => ({ rating, signal: rating === 'down' ? 'implicit_regen_no_copy' : 'implicit_copy', meta: Object.assign({ store: 'Community Kia Baytown' }, dirs ? { directives: dirs } : {}, chars ? { promptChars: chars } : {}, ki != null ? { keyInfoRows: ki } : {}) });
const rows = [row('up', ['STORE STATUS RIGHT NOW', 'OUR PITCH IS ALREADY OUT AND UNANSWERED'], 53000, 0), row('down', ['STORE STATUS RIGHT NOW', 'OUR PITCH IS ALREADY OUT AND UNANSWERED'], 61000, 3),
  row('neutral', ['STORE STATUS RIGHT NOW'], 35000, 0), row('up', null, null, null)];
const fm = measures ? measures(rows) : null;
check('per directive: sessions, shipped, regenerated-or-chipped and left unsent; rows from older builds are skipped', () => fm && [fm.directiveRows, fm.directives.map(d => [d.k, d.n, d.shipped, d.down])],
  [3, [['STORE STATUS RIGHT NOW', 3, 2, 1], ['OUR PITCH IS ALREADY OUT AND UNANSWERED', 2, 1, 1]]]);
check('prompt length: median, max, and how many were over 60,000', () => fm && fm.promptChars && [fm.promptChars.n, fm.promptChars.med, fm.promptChars.max, fm.promptChars.over60k], [3, 53000, 61000, 1]);
check('key-information rows kept: 1 of 3 sessions', () => fm && fm.keyInfo, { n: 3, withRows: 1 });
const fd = { total: 4, engaged: 4, produced: 4, shippedRate: 75, firstTryRate: 50, usedRate: 75, downRate: 25, posRate: 75, explicitUp: 0, explicitDown: 0, implicitUp: 2, implicitDown: 1, abandoned: 0, incomplete: 0,
  ratings: { up: 2, weak_up: 0, neutral: 1, down: 1, abandoned: 0, incomplete: 0 }, signals: {}, chipFreq: {}, byStore: {}, byPersona: {}, byLeadSource: {}, byScenario: {}, downSessions: [], avgRegens: 0, avgChips: 0 };
const fh = build && fm ? build(reqs, '2026-11-10', Object.assign({}, fd, { directives: fm.directives, directiveRows: fm.directiveRows, promptChars: fm.promptChars, keyInfo: fm.keyInfo }), null, null).html : '';
check('the feedback section shows the Directives table and the length / key-info line',
  () => [/Directives in the prompt \(3 sessions from 9\.7\.868\+, top 2\)/.test(fh), /STORE STATUS RIGHT NOW<\/td>\s*<td[^>]*>3<\/td>\s*<td[^>]*>67%<\/td>\s*<td[^>]*>1 \(33%\)/.test(fh.replace(/\n/g, '')),
    /Prompt length \(user prompt, characters\): median 53000 · P95 \d+ · max 61000 · over 60,000: 1 of 3/.test(fh), /Key-information rows kept: 1 of 3 sessions/.test(fh)], [true, true, true, true]);
const fh0 = build ? build(reqs, '2026-11-10', fd, null, null).html : '';
check('control: rows from older builds -> no Directives table, no length line', () => [/Directives in the prompt/.test(fh0), /Prompt length \(user prompt/.test(fh0)], [false, false]);

console.log(' 4. the note-type table (MS-1.4):');
const cd = (types) => ({ total: 30, deltas: {}, verifiedDeltas: {}, bySource: {}, byNoteType: types, byVersion: {}, disagreements: [], regexFired: 0, compFired: 0, unverifiedProbe: 0, comparable: 0, authoritativeRows: 0,
  byDetector: { 'day-lock': { total: 10, usable: 10, agree: 10, disagree: 0, fabricated: 0, probeFailed: 0, changedDirective: 0, defaulted: 0 } } });
const h1 = build ? build(reqs, '2026-11-10', null, cd({ unknown: { total: 255, agree: 250, disagree: 5, fabricated: 0 }, '[CALL NOTE]': { total: 1, agree: 1, disagree: 0, fabricated: 0 } }), null).html : '';
check('255 of 256 rows "unknown" -> no table; one line says why', () => [/By note type<\/div>/.test(h1), /By note type is not shown: a row carries a note type only when the pattern reader fired, and 1 of 256 rows had one\./.test(h1)], [false, true]);
const h2 = build ? build(reqs, '2026-11-10', null, cd({ unknown: { total: 10, agree: 10, disagree: 0, fabricated: 0 }, '[CALL NOTE]': { total: 6, agree: 5, disagree: 1, fabricated: 0 } }), null).html : '';
check('control: types recorded on 6 of 16 rows -> the table is shown', () => /By note type<\/div>/.test(h2), true);

if (PROXY) {
  console.log(' 5. the proxy writes classifyMs (v7.92):');
  const ps = fs.readFileSync(PROXY, 'utf8');
  check('classifier timed around the two calls, and classifyMs added to the FINAL line only when it ran',
    () => [/const _clsT0 = Date\.now\(\);[\s\S]{0,400}?classifyMs = Date\.now\(\) - _clsT0;/.test(ps), /\(classifyMs !== null \? ` classifyMs=\$\{classifyMs\}` : ''\)\);/.test(ps)], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
