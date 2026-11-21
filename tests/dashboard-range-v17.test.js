#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-range-v17.test.js');
// dashboard v1.7. 10/2: the Today view read "10-02 → 10-03 · 1 of 2 days". fetchRange added a day to the end of every
// range -- a holdover from UTC-keyed rows -- and the worker has built its day list in Central days since v7.77, so the
// extra day was tomorrow. Executes the shipped fetchRange with fetch stubbed and reads the URL it asks for.
//
// Usage: node tests/dashboard-range-v17.test.js <dashboard.html>
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
if (!file) { console.error('usage: dashboard-range-v17.test.js <dashboard.html>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const html = fs.readFileSync(file, 'utf8');
const a = html.indexOf('async function fetchRange('), b = html.indexOf('\n}\n', a);
(async () => {
  const urls = [];
  const sb = { PROXY: 'https://proxy.invalid', DIRECTOR_KEY: 'k', directorKey: () => 'k', encodeURIComponent, Date,   // (v1.8) key via directorKey()
    fetch: async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({}) }; } };
  vm.createContext(sb);
  vm.runInContext(html.slice(a, b + 2), sb);
  // (v1.11) fetchRange goes through the shared fetchJSON; load it alongside when the page has it
  const fj = html.indexOf('async function fetchJSON(');
  if (fj > -1) vm.runInContext(html.slice(fj, html.indexOf('\n}\n', fj) + 2), sb);
  await vm.runInContext('fetchRange("2026-10-02", "2026-10-02")', sb);
  check('Today asks for one Central day: from=2026-10-02&to=2026-10-02 (was to=2026-10-03)', /from=2026-10-02&to=2026-10-02(?:&|$)/.test(urls[0] || ''), true);
  await vm.runInContext('fetchRange("2026-09-26", "2026-10-02")', sb);
  check('7 days asks for exactly its seven days', /from=2026-09-26&to=2026-10-02(?:&|$)/.test(urls[1] || ''), true);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
