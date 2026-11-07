#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('reporter-fail-reasons.test.js');
// (reporter v1.24) Gil, 10/8: "Today's performance seems like more fallbacks today" -- and the Failures table said only
// tier and latency. The proxy's FAIL line already carries the model, status=NNN and the error after the arrow; the
// report now keeps them and prints Model / Status / Reason, with a count by reason. Drives the shipped parseLogs and
// buildReport on Logpush-shaped entries. Placeholder data only.
//
// Usage: node tests/reporter-fail-reasons.test.js <reporter.js>
const fs = require('fs'), vm = require('vm');
const FILE = process.argv[2];
if (!FILE) { console.error('usage: reporter-fail-reasons.test.js <reporter.js>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const box = { console: { log() {}, warn() {}, error() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Array, RegExp, Intl, Promise, Response, Headers, URL };
box.globalThis = box; vm.createContext(box);
vm.runInContext(fs.readFileSync(FILE, 'utf8').replace(/^export default\s*\{/m, 'globalThis.__R = {'), box);
const parse = vm.runInContext('parseLogs', box), build = vm.runInContext('buildReport', box);
const T0 = Date.parse('2026-10-08T18:08:44.000Z');
const entry = (dt, msgs) => ({ EventTimestampMs: T0 + dt, WallTimeMs: 6000, Outcome: 'ok', Logs: msgs.map(m => ({ Message: ['[rid] ' + m], TimestampMs: T0 + dt })) });
const reqs = parse([
  entry(0, ['PRIMARY FAIL gpt-6-luna 1247ms status=429 → Rate limit reached for requests', 'FALLBACK FAIL gpt-5.6-luna 1961ms status=503 → overloaded',
            'EMERGENCY OK gpt-4.1-mini 2100ms', 'FINAL total=5400ms regenerated=false']),
  entry(60000, ['PRIMARY FAIL gpt-6-luna 12000ms → Timeout 12000ms', 'FALLBACK OK gpt-5.6-luna 4000ms', 'FINAL total=16100ms regenerated=false']),
  entry(120000, ['PRIMARY FAIL gpt-6-luna 900ms', 'FALLBACK OK gpt-5.6-luna 3000ms', 'FINAL total=3900ms regenerated=false']),
  entry(180000, ['PRIMARY OK gpt-6-luna 2000ms', 'FINAL total=2100ms regenerated=false'])]);

console.log(' 1. the FAIL line is read in full:');
check('(new) model, status and reason kept for each failure', () => reqs.filter(r => r.fails).map(r => r.fails.map(f => [f.tier, f.model, f.ms, f.status, f.kind])),
  [[['PRIMARY', 'gpt-6-luna', 1247, 429, 'rate_limit'], ['FALLBACK', 'gpt-5.6-luna', 1961, 503, 'server_5xx']],
   [['PRIMARY', 'gpt-6-luna', 12000, null, 'timeout']], [['PRIMARY', 'gpt-6-luna', 900, null, 'unknown']]]);
check('control: tier and latency read as before (a line with no status or arrow still parses)', () => reqs.filter(r => r.fails).map(r => r.fails.map(f => f.tier + '@' + f.ms)),
  [['PRIMARY@1247', 'FALLBACK@1961'], ['PRIMARY@12000'], ['PRIMARY@900']]);

console.log(' 2. the report prints it:');
const out = build(reqs, '2026-10-08');
const ft = (out.html.match(/Failures \(\d+\)[\s\S]*?<\/table>/) || [''])[0];
check('(new) the table has Model, Status and Reason columns', () => ['Model', 'Status', 'Reason'].map(h => new RegExp('>' + h + '<').test(ft)), [true, true, true]);
check('(new) the 429 row reads gpt-6-luna / 429 / rate_limit', () => /gpt-6-luna[\s\S]{0,200}?429[\s\S]{0,200}?rate_limit/.test(ft), true);
check('(new) a count by reason above the table, most first', () => (ft.match(/By reason: ([^<]*)/) || [, ''])[1], 'rate_limit 1 · server_5xx 1 · timeout 1 · unknown 1');
check('(new) plain text: the reason on each line and the count', () => [/  13:08:44 CT  PRIMARY @ 1247ms  gpt-6-luna  status=429  rate_limit/.test(out.text), /  by reason: rate_limit 1 · server_5xx 1 · timeout 1 · unknown 1/.test(out.text)], [true, true]);
check('control: Time (CT) as before', () => />13:08:44</.test(ft), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
