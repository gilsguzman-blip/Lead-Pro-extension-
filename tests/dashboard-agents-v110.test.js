#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-agents-v110.test.js');
/**
 * dashboard-agents-v110.test.js — dashboard v1.10. 10/8: the Agents view worked for Today and returned HTTP 500 for 7
 * and 14 days -- one request read every perf: and feedback row in the range. The page now asks one Central day per
 * request, four at a time, and adds the days up itself. Executes the page's own rangeDays, pool and mergeAgentDays
 * (sliced out of the HTML) with its own rate readers, so the merged rows are judged by the same code the table uses.
 *
 *   usage: dashboard-agents-v110.test.js <dashboard.html>
 */
const fs = require('fs'), vm = require('vm');
const HTML = process.argv[2];
if (!HTML) { console.error('usage: dashboard-agents-v110.test.js <dashboard.html>'); process.exit(2); }
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
const ctx = { Set, Promise, Math, Object, Array, Error, fmtDate: (n) => '2026-10-' + String(8 - n).padStart(2, '0') };
vm.createContext(ctx);
const counts = /const AGENT_COUNTS = \[[^\]]*\];/.exec(html);
if (counts) vm.runInContext(counts[0].replace('const ', 'var '), ctx);
for (const n of ['rangeDays', 'pool', 'mergeAgentDays', 'engagedOf', 'shippedRateOf', 'firstTryRateOf']) { const src = slice(n); if (src) vm.runInContext(src, ctx); }
const has = (n) => typeof ctx[n] === 'function';
// two days of one agent (placeholder data), as proxy v7.85 returns them
const day = (o) => Object.assign({ drafts: 0, failures: 0, rewrites: 0, builds: {}, activeHours: 0, up: 0, weak_up: 0, neutral: 0, down: 0, abandoned: 0,
  incomplete: 0, explicitUp: 0, explicitDown: 0, implicitDown: 0, total: 0, chipFreq: {}, stores: {}, mix: { firstTouch: 0, followUp: 0, showroom: 0 } }, o);
const D1 = { attribution: { feedback: 4, joined: 4, byUser: 0, unattributed: 0 }, agents: { 'Agent Name': day({ drafts: 10, failures: 1, builds: { '9.7.772': 10 },
  latestBuild: '9.7.772', firstAt: '2026-10-07T14:00:00Z', latestAt: '2026-10-07T20:00:00Z', activeHours: 4, medianDraftMs: 2000, draftMsCount: 10,
  up: 3, down: 1, implicitDown: 1, total: 4, leadIds: ['TEST001A', 'TEST002B'], regens: 2, chips: 1, chipFreq: { direct: 1 }, mix: { firstTouch: 3, followUp: 1, showroom: 0 },
  engagedShippedRate: 75 }) } };
const D2 = { attribution: { feedback: 2, joined: 1, byUser: 1, unattributed: 0 }, agents: { 'Agent Name': day({ drafts: 30, builds: { '9.7.774': 30 },
  latestBuild: '9.7.774', firstAt: '2026-10-08T13:00:00Z', latestAt: '2026-10-08T18:00:00Z', activeHours: 2, medianDraftMs: 3000, draftMsCount: 30,
  up: 1, abandoned: 1, total: 2, leadIds: ['TEST002B'], regens: 0, chips: 0, mix: { firstTouch: 0, followUp: 1, showroom: 0 }, engagedShippedRate: 100 }) } };
(async () => {
  console.log('\n' + HTML + ' — dashboard v1.10, Agents one day at a time');
  check('(new helper) rangeDays: the days of a range, oldest first', () => has('rangeDays') ? ctx.rangeDays(2) : 'missing', ['2026-10-06', '2026-10-07', '2026-10-08']);
  await acheck('(new helper) pool: never more than 4 in flight, a failure is kept by position, not thrown', async () => {
    if (!has('pool')) return 'missing';
    let live = 0, peak = 0;
    const res = await ctx.pool([1, 2, 3, 4, 5, 6, 7], 4, async (x) => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; if (x === 3) throw new Error('500'); return x * 10; });
    return [peak, res.map(r => r.ok ? r.value : 'fail')]; }, [4, [10, 20, 'fail', 40, 50, 60, 70]]);
  const m = has('mergeAgentDays') ? ctx.mergeAgentDays([D1, D2]) : null;
  const a = m ? m.agents['Agent Name'] : {};
  check('(new helper) counts add across days', () => [a.drafts, a.failures, a.total, a.up, a.down, a.abandoned, a.activeHours, a.builds], [40, 1, 6, 4, 1, 1, 6, { '9.7.772': 10, '9.7.774': 30 }]);
  check('rates are re-derived from the sums, not averaged (5 shipped... 4 of 5 engaged = 80%, not (75+100)/2)', () => [ctx.shippedRateOf(a), ctx.firstTryRateOf(a)], [80, 80]);
  check('leads de-duplicate across days by id (TEST002B both days -> 2, not 3)', () => a.leads, 2);
  check('draft time: drafts-weighted average of daily medians ((2000*10 + 3000*30) / 40)', () => a.medianDraftMs, 2750);
  check('latest build is the newest day\'s; first/last time span both days; pace = drafts / active hours', () => [a.latestBuild, a.firstAt, a.latestAt, a.perActiveHour],
    ['9.7.774', '2026-10-07T14:00:00Z', '2026-10-08T18:00:00Z', 6.7]);
  check('regens and chips per session from the summed raw counts', () => [a.avgRegens, a.avgChips], [0.33, 0.17]);
  check('attribution adds up', () => m && m.attribution, { feedback: 6, joined: 5, byUser: 1, unattributed: 0 });
  check('a v7.84 day (no leadIds / raw sums) still merges: leads summed, regens from the average', () => {
    const old = { agents: { 'Agent Name': day({ total: 2, up: 2, leads: 2, avgRegens: 0.5, drafts: 4 }) } };
    const x = ctx.mergeAgentDays([old, old]).agents['Agent Name']; return [x.leads, x.avgRegens, x.drafts]; }, [4, 0.5, 8]);
  check('the view fans out one day per request, four at a time, and names a failed day', () =>
    [/await pool\(dates, 4, \(dt\) => fetchAgents\(dt, dt\)\)/.test(html), /'Could not load ' \+ failed\.map/.test(html), /\n  v1\.10 — THE AGENTS VIEW ASKS ONE DAY AT A TIME\./.test(html)], [true, true, true]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
