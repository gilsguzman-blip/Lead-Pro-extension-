#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('probes-parallel-851.test.js');
// (v9.7.851) AUDIT PHASE 2, BATCH 2. (B-2 step 1, owner-approved) The three fact probes stop sitting in front of the draft:
// _lpPrepareFactVerdicts is started and not awaited, the three *_AUTHORITATIVE flags ship false (kept, not deleted), the
// regex verdict decides, and the observer switches stay on. Since 9/1, 430 rows agreed 100% and comprehension changed 0
// directives while every generation waited on it. The v9.7.699 memo and the per-generation telemetry row stay: the flush now
// waits for THIS generation's probes, with the generation id, decisions and verbal-commit regex verdict captured when the
// drafts rendered, so a regen that starts first cannot lend the row its own. ([LP GRAB TIMING]) One popup-side line per
// generation with the grab's phase splits (pre-scrape, frame poll, email expand, key-info wait, scrape+merge) and the
// generation's (probes, API, rewrite).
// Executes _lpPrepareFactVerdicts, _lpFactDecide, _lpApplyFactOverrides, _lpFlushFactTelemetry and _lpLogGrabTiming, the
// generate-path block that starts the probes, the deferred-flush block, the injected frame-wait function against a fake
// page, and the popup-side aggregation of its results. Placeholder data only.
//
// Usage: node tests/probes-parallel-851.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: probes-parallel-851.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const between = (src, a, b, from) => { const i = src.indexOf(a, from || 0); if (i < 0) throw new Error('anchor not found: ' + a.slice(0, 60)); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('end not found: ' + b.slice(0, 60)); return src.slice(i, j + b.length); };
// On a build without the code under test, an anchor that is not there must fail the assertions that need it, not stop the suite.
const sbetween = (...a) => { try { return between(...a); } catch (e) { return '/* ' + e.message + ' */ throw new Error("anchor missing");'; } };
const tick = () => new Promise(r => setImmediate(r));
const NONE = (n) => ({ usable: true, fired: false, kind: null, quote: '', verifiedNote: 0, notesRead: n || 1 });

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const capture = async (g) => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = (...q) => logs.push(q.join(' '));
    try { const r = await g(); return { r, logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the switches:');
  check('the three AUTHORITATIVE flags ship false; the three observer switches stay on', () =>
    run('[LEADPRO_VERBALCOMMIT_AUTHORITATIVE, LEADPRO_DAYLOCK_AUTHORITATIVE, LEADPRO_OFFFRANCHISE_AUTHORITATIVE, LEADPRO_VERBALCOMMIT_COMPREHENSION, LEADPRO_DAYLOCK_COMPREHENSION, LEADPRO_OFFFRANCHISE_COMPREHENSION]'),
    [false, false, false, true, true, true]);
  check('the regex decides: a usable "none" verdict against a fired regex keeps the regex directive, on all three', () =>
    ['verbal-commit', 'day-lock', 'off-franchise'].map(id => { const d = run('_lpFactDecide')(id, NONE(1), { fired: true, value: 'x' }, () => {}); return d.source + ':' + d.fired; }),
    ['regex-fallback:true', 'regex-fallback:true', 'regex-fallback:true']);
  const fence = (id, body) => run('LP_FACT_FENCE_OPEN') + id + '⟧' + body + run('LP_FACT_FENCE_CLOSE') + id + '⟧';
  check('a fenced day-lock directive is KEPT when the probe read none (was REMOVED with the flag on); the fences come out', () => {
    const r = run('_lpApplyFactOverrides')('A\n' + fence('day-lock', '\n📅 CUSTOMER NAMED A SPECIFIC DAY — Saturday\n') + 'B', { 'day-lock': NONE(1) }, () => {});
    return [/CUSTOMER NAMED A SPECIFIC DAY — Saturday/.test(r.text), /⟦/.test(r.text)]; }, [true, false]);

  console.log(' 2. the probes do not hold up the draft:');
  const block = sbetween(src, "    var _lpCpWait = (typeof _lpLoadClickPath === 'function')", "      var _lpFactApplied = _lpApplyFactOverrides(leadContext, window._lpFactVerdicts || {});");
  await acheck('with a probe that never answers, the generate path goes straight on to build the prompt', async () => {
    sb.__calls = 0;
    run('_lpPrepareFactVerdicts = function () { globalThis.__calls++; return new Promise(function () {}); }; _lpLoadClickPath = function () { return Promise.resolve(null); };'
      + 'leadContext = "ctx"; lastScrapedData = { dealerId: "6190" }; window._lpGenTiming = { t0: Date.now() };');
    const done = run('(async function () { var store = "Test Store", leadConvState = "first-touch", leadSource = "Cargurus";\n' + block + ' globalThis.__reached = true; } catch (e) {}\n return globalThis.__reached === true; })()');
    const raced = await Promise.race([done, new Promise(r => setTimeout(() => r('still waiting after 200ms'), 200))]);
    return [raced, sb.__calls, typeof run('window._lpFactPending.then')]; }, [true, 1, 'function']);
  check('source: the probe call is not awaited (the click-path read still is)', () => [/await\s+_lpPrepareFactVerdicts/.test(src), /var _lpCpR = await _lpCpWait;/.test(src)], [false, true]);
  // restore the shipped functions for the rest of the suite
  sb = loadPopup(f, { withAuth: true });

  console.log(' 3. the memo, and no stale verdict at prompt time:');
  run('_lpRunAllFactProbes = function () { globalThis.__probeRuns = (globalThis.__probeRuns || 0) + 1; var v = { "verbal-commit": ' + JSON.stringify(NONE(2)) + ', "day-lock": ' + JSON.stringify(NONE(1))
    + ', "off-franchise": ' + JSON.stringify(NONE(1)) + ' }; return Promise.resolve(v).then(function (x) { window._lpFactVerdicts = x; return x; }); };');   // as the shipped runner: set when settled
  const DATA = { context: '[CUSTOMER] I can come Saturday', store: 'Test Store', dealerId: '6190', schedCustomerNotes: [], lastInboundMsg: 'I can come Saturday', conversationBrief: '', convState: 'active', leadSource: 'Cargurus' };
  run('window._activeLeadId = "TEST001A"; window._lpFactVerdicts = { "verbal-commit": { usable: true, fired: true, quote: "from the previous lead" } };');
  sb.__d = DATA;
  const first = await capture(async () => { const p = run('_lpPrepareFactVerdicts(globalThis.__d)'); const sync = run('JSON.stringify(window._lpFactVerdicts)'); await p; return [sync, run('!!window._lpFactFromMemo')]; });
  check('a fresh read clears the previous generation\'s verdicts before the prompt is built (they arrive later)', () => first.r, ['{}', false]);
  const second = await capture(async () => { const p = run('_lpPrepareFactVerdicts(globalThis.__d)'); const sync = run('Object.keys(window._lpFactVerdicts).length'); await p; return [sync, run('!!window._lpFactFromMemo'), sb.__probeRuns]; });
  check('a regen with the same inputs reuses the memo: verdicts set at once, no second probe run (v9.7.699 kept)', () => second.r, [3, true, 1]);
  check('control: the memo hit says so in the log (unchanged since v9.7.699)', () => second.logs.some(l => /\[LP FACT DIAG\] verdicts REUSED/.test(l)), true);

  console.log(' 4. the telemetry row still posts, for this generation:');
  const flushBlock = sbetween(src, '        (function () {\n          var _fp = window._lpFactPending', '        })();');
  await acheck('the flush waits for the probes, then posts one row per detector with the values captured at render', async () => {
    const rows = [], timings = [];
    sb.__rows = rows; sb.__timings = timings; sb.__flushBlock = flushBlock;
    run('var __resolve; window._lpFactPending = new Promise(function (r) { __resolve = r; });'
      + 'window._lpFeedback = { generationId: "gen-A" }; window._lpFactDecisions = { "day-lock": { source: "regex-fallback", regexFired: true, regexValue: "Saturday" } };'
      + 'window._lpVerbalCommitVerdict = { fired: false, quote: "", ran: true }; window._lpFactFlushedFor = ""; window._lpLastPromptInputs = { factVerdicts: {} };'
      + 'window._lpGenTiming = { t0: Date.now() - 50, api: 40, rewrite: 5, probes: null };'
      + '_lpSendCommitComprehension = function (row) { globalThis.__rows.push(row); };'
      + '_lpLogGrabTiming = function (l, t) { globalThis.__timings.push(t); };'
      + 'eval(globalThis.__flushBlock);');
    await tick();
    const before = rows.length;
    // a regen starts before the probes settle: new generation id, new decisions, a new regex verdict
    run('window._lpFeedback = { generationId: "gen-B" }; window._lpFactDecisions = {}; window._lpVerbalCommitVerdict = { fired: true, quote: "regen" };'
      + '__resolve({ "verbal-commit": ' + JSON.stringify(NONE(2)) + ', "day-lock": ' + JSON.stringify(NONE(1)) + ', "off-franchise": ' + JSON.stringify(NONE(1)) + ' });');
    await tick(); await tick();
    const dl = rows.find(r => r.detector === 'day-lock') || {}, vc = rows.find(r => r.detector === 'verbal-commit') || {};
    return [before, rows.length, dl.delta, dl.sourceUsed, dl.authoritative, vc.regexFired, run('window._lpFactFlushedFor'),
      Object.keys(run('window._lpLastPromptInputs.factVerdicts')).length, timings.length, typeof (timings[0] || {}).done]; },
    [0, 3, 'DISAGREE-REGEX-ONLY', 'regex-fallback', false, false, 'gen-A', 3, 1, 'number']);

  console.log(' 5. [LP GRAB TIMING]:');
  sb = loadPopup(f, { withAuth: true });   // section 4 stubbed _lpLogGrabTiming
  const line = (await capture(async () => { try {
    run('lastScrapedData = { autoLeadId: "TEST001A" }; window._lpGrabTiming = { t0: 0, leadId: "TEST001A", preScrape: 120, poll: 850, expand: 300, keyInfo: 0, frameWall: 4010, frames: 5, framesTimedOut: 3, merge: 450, total: 4700, gens: 0 };');
    const t = { t0: 1000, done: 9400, probes: 2300, probesFrom: 'probes', clickPath: 0, api: 6100, rewrite: 1800 };
    return [run('_lpLogGrabTiming')(null, t), run('_lpLogGrabTiming')(null, t)]; } catch (e) { return ['THREW: ' + e.message, '']; } })).r;
  check('one line: the grab splits and the generation\'s, measured', () => line[0],
    '[LP GRAB TIMING] lead:TEST001A | grab: pre-scrape 120ms, frame poll 850ms, email expand 300ms, key-info wait 0ms (frame wait wall 4010ms; 3 of 5 frames waited out the 4000ms cap), scrape+merge 450ms, grab total 4700ms'
    + ' | generate: probes 2300ms (probes, in parallel, not waited on), click-path wait 0ms, API 6100ms, rewrite 1800ms, generate total 8400ms (to the drafts on screen)');
  check('a regen on the same grab says so', () => /\| grab \(same grab, generation 2\): pre-scrape 120ms/.test(line[1]), true);
  check('another lead\'s grab is not reported as this one\'s', () => {
    run('lastScrapedData = { autoLeadId: "TEST002B" };'); return /grab: -- \(no grab timing for this lead\)/.test(run('_lpLogGrabTiming')(() => {}, { t0: 0, done: 10 })); }, true);
  // The injected frame-wait function, against a fake page.
  const waitFn = sbetween(src, "    { target: { tabId: tab.id, allFrames: true }, func: function() {\n      // Inline polling scraper", "      return new Promise(function(resolve) { wait(resolve); });\n    }}");
  const fnSrc = waitFn.slice(waitFn.indexOf('function() {'), waitFn.length - 1);
  const frame = async (lead) => { const doc = { documentElement: { setAttribute() {} }, body: { innerHTML: '' },
      querySelectorAll: (q) => (lead && q === '.notes-and-history-item') ? [{}, {}] : [], querySelector: (q) => (lead && /notes-and-history-item|LeadSourceName/.test(q)) ? {} : null, getElementById: () => null };
    const box = { document: doc, window: {}, Date, Promise, setTimeout: (fn) => setImmediate(fn), console: { log() {} } }; box.window = box; vm.createContext(box);
    return vm.runInContext('(' + fnSrc + ')()', box); };
  const lf = await frame(true), nf = await frame(false);
  check('a lead frame returns its own poll / expand / key-info times', () => [typeof lf.poll, typeof lf.expand, typeof lf.keyInfo, lf.timedOut], ['number', 'number', 'number', false]);
  check('a frame with no lead waits out the cap and says so', () => nf.timedOut, true);
  const agg = sbetween(src, "      try {\n        var _gt = window._lpGrabTiming;\n        if (_gt) {\n          var _rs = (_lpWaitRes", "      } catch (_eGt) {}");
  check('the popup takes the slowest lead frame for each phase and counts the frames that waited out the cap', () => {
    sb.__agg = agg;
    run('window._lpGrabTiming = { t0: Date.now() - 4100, wait0: Date.now() - 4000 }; var _lpWaitRes = [{ result: { poll: 600, expand: 200, keyInfo: 900, timedOut: false } },'
      + '{ result: { poll: 850, expand: 300, keyInfo: 0, timedOut: false } }, { result: { poll: 4000, expand: 0, keyInfo: 0, timedOut: true } }, { result: null }]; eval(globalThis.__agg);');
    const g = run('window._lpGrabTiming'); return [g.poll, g.expand, g.keyInfo, g.frames, g.framesTimedOut, g.frameWall >= 4000]; }, [850, 300, 900, 3, 1, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
