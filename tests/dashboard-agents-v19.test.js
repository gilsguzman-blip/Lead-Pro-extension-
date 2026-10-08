#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-agents-v19.test.js');
/**
 * dashboard-agents-v19.test.js — dashboard v1.9, the Agents view (proxy v7.84 GET /agents).
 * Executes the page's own helpers (buildNum, buildCmp, topN, fetchAgents) sliced out of the HTML, with fetch stubbed,
 * and pins the wiring: the key travels in X-LP-Key (never the URL, v1.8), an older proxy gets a plain message rather
 * than an empty table, the range is capped at 14 days, and the version marker moved with the change. The page itself
 * was rendered in Chromium against v7.84's breakdown of a real day's perf: rows while this was written.
 *
 *   usage: dashboard-agents-v19.test.js <dashboard.html>
 */
const fs = require('fs'), vm = require('vm');
const HTML = process.argv[2];
if (!HTML) { console.error('usage: dashboard-agents-v19.test.js <dashboard.html>'); process.exit(2); }
const html = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
function slice(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(html); if (!m) return '';
  let i = html.indexOf('{', m.index), depth = 0;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) return html.slice(m.index, j + 1); }
  return '';
}
const calls = [];
let reply = { status: 200, body: { agents: {} } };
const ctx = { PROXY: 'https://p.test', DASH: '—', calls, URL,
  directorKey: () => 'LP-TESTDIR3',
  fetch: (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ status: reply.status, ok: reply.status < 400, json: () => Promise.resolve(reply.body) }); } };
vm.createContext(ctx);
for (const n of ['buildNum', 'buildCmp', 'topN', 'fetchAgents']) { const src = slice(n); if (src) vm.runInContext(src, ctx); }
(async () => {
  console.log('\n' + HTML + ' — dashboard v1.9, Agents');
  check('(new helper) builds compare by number and ignore -dev', () => [ctx.buildCmp('9.7.772', '9.7.774') < 0, ctx.buildCmp('9.7.774-dev', '9.7.774'), ctx.buildCmp('9.7.1000', '9.7.774') > 0], [true, 0, true]);
  check('(new helper) topN orders by count', () => ctx.topN({ a: 1, b: 3, c: 2 }, 2), [['b', 3], ['c', 2]]);
  await acheck('(new helper) fetchAgents: GET /agents, key in X-LP-Key, not in the URL (one day is ?date= since v1.10)', async () => {
    reply = { status: 200, body: { agents: { 'Agent Name': {} } } };
    await ctx.fetchAgents('2026-10-02', '2026-10-08');
    const c = calls[calls.length - 1];
    return [c.url, c.opts.headers['X-LP-Key'], /key=/.test(c.url)]; }, ['https://p.test/agents?from=2026-10-02&to=2026-10-08', 'LP-TESTDIR3', false]);
  await acheck('an older proxy (404): a plain "needs proxy v7.84" message, not an empty table', async () => {
    reply = { status: 404, body: {} };
    try { await ctx.fetchAgents('2026-10-08', '2026-10-08'); return 'no error'; } catch (e) { return /needs proxy v7\.84/.test(e.message); } }, true);
  check('the view switch, the Agents view and its range cap are in the page', () =>
    [/\['quality', 'Quality'\], \['agents', 'Agents'\]/.test(html), /function AgentsView\(/.test(html), /Math\.min\(RANGES\[idx\]\.days, 13\)/.test(html),
     /not the lead\\\\?'s BD Agent/.test(html)], [true, true, true, true]);
  check('the v1.9 header block is kept (DASH_VERSION itself is dashboard-version\'s to pin)', () => /\n  v1\.9 — AGENTS\./.test(html), true);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
