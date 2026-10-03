#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('reporter-ct-failures.test.js');
// (reporter v1.23) Gil, 9/29: "On the reporter the Failures are listed with the UTC time. Can we switch that to
// Central time like the rest of the dashboard?" Drives the shipped buildReport and checks the failures table
// (HTML and plain text) and the plain-text window line are Central, across both sides of DST.
//
// Usage: node tests/reporter-ct-failures.test.js <reporter.js>
const fs = require('fs'), vm = require('vm');
const FILE = process.argv[2];
if (!FILE) { console.error('usage: reporter-ct-failures.test.js <reporter.js>'); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sandbox = { console: { log() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Intl };
vm.createContext(sandbox);
const lines = src.split('\n');
let s0 = lines.findIndex(l => l.startsWith('function buildReport('));
let s1 = -1; for (let n = s0 + 1; n < lines.length; n++) if (lines[n] === '}') { s1 = n; break; }
vm.runInContext(src.slice(src.indexOf('const _CT_FMT ='), src.indexOf('function buildReport(')), sandbox);
vm.runInContext(lines.slice(s0, s1 + 1).join('\n'), sandbox);
const build = vm.runInContext('buildReport', sandbox);

const req = (ts, fails) => ({ ts, final: { ts, total: 900, regen: false }, primary: { ts, model: 'm', ms: 800 }, fails });
const failTable = (html) => (html.match(/Failures \(\d+\)[\s\S]*?<\/table>/) || [''])[0];

console.log(' 1. the 9/29 failures, CDT (UTC-5):');
const out = build([req('2026-09-29T13:30:00.000Z', []),
  req('2026-09-29T13:36:36.000Z', [{ tier: 'PRIMARY', ms: 1911 }]),
  req('2026-09-29T14:00:27.000Z', [{ tier: 'PRIMARY', ms: 3236 }])], '2026-09-29');
const ft = failTable(out.html);
check('the column header reads Time (CT), not Time (UTC)', () => [/Time \(CT\)/.test(ft), /Time \(UTC\)/.test(ft)], [true, false]);
check('13:36:36Z -> 08:36:36 and 14:00:27Z -> 09:00:27', () => [/>08:36:36</.test(ft), />09:00:27</.test(ft)], [true, true]);
check('no UTC timestamp is left in the table', () => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(ft), false);
check('plain text: failure lines in CT', () => [/  08:36:36 CT  PRIMARY @ 1911ms/.test(out.text), /  09:00:27 CT  PRIMARY @ 3236ms/.test(out.text)], [true, true]);
check('plain text: the window line is CT like the HTML header', () => [/Window: 08:30 – 09:00 CT/.test(out.text), /Window: .*Z/.test(out.text)], [true, false]);

console.log(' 2. after DST ends, CST (UTC-6):');
const w = build([req('2026-12-01T19:05:09.000Z', [{ tier: 'FALLBACK', ms: 8000 }])], '2026-12-01');
check('19:05:09Z in December -> 13:05:09', () => />13:05:09</.test(failTable(w.html)), true);
check('control: no failures -> no failures section', () => /Failures \(/.test(build([req('2026-09-29T13:30:00.000Z', [])], '2026-09-29').html), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
