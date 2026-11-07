#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('feedback-gatherer-v16.test.js');
// Feedback Gatherer v1.6 (audit M-10). /feedback/drafts has returned workerRequestId, signal, trigger and extensionVersion,
// and the export dropped all four, so a pair could only be matched to its proxy row by lead and time -- ambiguous on every
// regenerated lead, which is the pairs population. The export now carries them; the gatherer reads the proxy's perf rows
// for the same days (GET /perf, same director key) and joins each pair on workerRequestId alone, reporting unmatched rows
// by reason: no request id on the row, no perf row (14-day TTL), perf row without agent, or perf not read for that day.
// Executes the shipped page script with document, prompt, localStorage and fetch stubbed. Placeholder data only.
//
// Usage: node tests/feedback-gatherer-v16.test.js <tools/feedback-gatherer/index.html>
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
if (!file) { console.error('usage: feedback-gatherer-v16.test.js <index.html>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const html = fs.readFileSync(file, 'utf8');
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const WORKER = 'https://proxy.invalid/', KEY = 'LP-TESTKEY2';
const DRAFTS = {
  '2026-11-02': [
    { id: 'f1', ts: '2026-11-02T15:00:00Z', rating: 'up', signal: 'copied', trigger: 'copy', workerRequestId: 'req-a', extensionVersion: '9.7.849-dev', meta: { store: 'Test Store', autoLeadId: 'TEST001A' }, drafts: { final: { sms: 'x' } } },
    { id: 'f2', ts: '2026-11-02T15:05:00Z', rating: 'down', signal: 'thumb_down', trigger: 'thumb', workerRequestId: 'req-b', extensionVersion: '9.7.849-dev', meta: { store: 'Test Store', autoLeadId: 'TEST001A' }, drafts: { final: { sms: 'y' } } },
    { id: 'f3', ts: '2026-11-02T15:10:00Z', rating: 'neutral', signal: 'copied', trigger: 'copy', workerRequestId: 'req-gone', meta: { store: 'Test Store' }, drafts: { final: { sms: 'z' } } },
    { id: 'f4', ts: '2026-11-02T15:15:00Z', rating: 'up', signal: 'copied', meta: { store: 'Test Store' }, drafts: { final: { sms: 'w' } } } ],
  '2026-11-03': [
    { id: 'f5', ts: '2026-11-03T15:00:00Z', rating: 'up', signal: 'copied', trigger: 'copy', workerRequestId: 'req-c', meta: { store: 'Test Store' }, drafts: { final: { sms: 'v' } } } ],
};
const PERF = { '2026-11-02': [{ requestId: 'req-a', agent: 'Agent Name', contract: 'draft', fullDraft: true }, { requestId: 'req-b', agent: null, contract: 'draft', fullDraft: true }] };
const els = {};
const el = (id) => els[id] || (els[id] = { id, value: id === 'worker' ? WORKER : '', disabled: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, insertAdjacentHTML() {}, querySelectorAll: () => [] });
const mem = new Map([['lp_director_key', KEY]]), calls = [];
const sb = { Intl, Date, String, JSON, Set, Map, Math, Number, Array, Object, Error, console: { log() {}, warn() {}, error() {} },
  document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('_tmp'), addEventListener() {}, body: el('_body') },
  window: {}, navigator: { clipboard: { writeText: async () => {} } }, setTimeout, clearTimeout,
  localStorage: { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  prompt: () => '',
  fetch: async (u, o) => { u = String(u); calls.push(u); const day = (u.match(/date=([\d-]+)/) || [])[1];
    const isPerf = /\/perf\?/.test(u); const body = isPerf ? (PERF[day] ? { rows: PERF[day] } : null) : { rows: DRAFTS[day] || [] };
    const ok = !!body; return { ok, status: ok ? 200 : 500, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body || {}), json: async () => body }; } };
sb.window = sb; vm.createContext(sb);
let loaded = true;
try { vm.runInContext(script, sb); vm.runInContext('buildFilters=function(){}; applyFilters=function(){ state.view = state.all.slice(); }; setStatus=function(){};', sb); } catch (e) { loaded = false; }
els.from.value = '2026-11-02'; els.to.value = '2026-11-03';

(async () => {
  try { await vm.runInContext('gather()', sb); } catch (e) {}
  const x = (() => { try { return vm.runInContext('buildExport()', sb); } catch (e) { return { rows: [], summary: {} }; } })();
  const row = (id) => x.rows.find(r => r.id === id) || {};
  console.log(' 1. the export carries what the proxy returned:');
  check('workerRequestId, signal, trigger and extensionVersion on each row (null when the row predates them)', () =>
    [row('f1').workerRequestId, row('f1').signal, row('f1').trigger, row('f1').extensionVersion, row('f4').workerRequestId, row('f4').extensionVersion],
    ['req-a', 'copied', 'copy', '9.7.849-dev', null, null]);
  check('the summary counts the rows that carry a request id', () => x.summary.withRequestId, 4);
  console.log(' 2. the join, on the request id alone:');
  check('perf is read for each day with the same key (a failed day is not fatal)', () => [calls.filter(u => /\/perf\?date=2026-11-02/.test(u)).length, calls.filter(u => /\/perf\?date=2026-11-03/.test(u)).length, x.rows.length], [1, 1, 5]);
  check('matched: the perf row\'s agent is who pressed Generate', () => row('f1').join, { matched: true, agent: 'Agent Name', reason: '' });
  check('each unmatched row says why', () => ['f2', 'f3', 'f4', 'f5'].map(id => row(id).join && row(id).join.reason), [
    'perf row without agent (the request carried no license)', 'no perf row (expired after 14 days, or never written)',
    'no request id on the row (extension before v9.7.564)', 'perf not read for that day']);
  check('the summary: 1 of 5 matched (20%), unmatched by reason, the day perf could not be read', () => {
    const j = x.summary.join || {}; return [j.rows, j.matched, j.matchRate, Object.keys(j.unmatched || {}).length, j.perfDaysFailed]; }, [5, 1, 20, 4, ['2026-11-03']]);
  check('no guessing by lead and time: f2 shares f1\'s lead and is still unmatched', () => row('f2').join && row('f2').join.matched, false);
  const md = (() => { try { return vm.runInContext('buildMarkdown()', sb); } catch (e) { return ''; } })();
  check('the Markdown says it too', () => [/Joined to their generation on request id: 1 of 5 \(20%\)/.test(md), /request req-a · signal copied · trigger copy · build 9\.7\.849-dev/.test(md)], [true, true]);
  check('control: no key in the export', () => /LP-TESTKEY2/.test(JSON.stringify(x)), false);
  if (!loaded) { fail++; console.log('  FAIL the page script did not load'); }
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
