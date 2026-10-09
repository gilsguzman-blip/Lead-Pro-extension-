#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('miss-refine-778.test.js');
// (v9.7.778) log300/log301, Honda Lafayette lead 2091288708 on v9.7.777. The first draft: "[customer], thanks for the reply. Sorry we
// missed you Saturday. Would you still like to come in?"; the text rewrite shipped "[customer], would you still like to come in? ..."
// -- the email kept the apology, the text lost it (after Warmer, the next run kept it: chance). The rewrite never saw 775's
// "acknowledge it lightly". Now: the rewrite is told when the miss is on THIS lead, a rewrite that drops an acknowledgement the
// first pass made does not ship, and the regen-variance row stops calling a chip's kept move a rejected one (777 intends it).
// Executes the shipped _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed) and the lifted variance verdict. Placeholder data only.
//
// Usage: node tests/miss-refine-778.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: miss-refine-778.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399',
  store: 'Community Honda Lafayette', leadSource: 'Identitymax', convState: 'active-follow-up', leadAgeDays: 9, hasOutbound: true, totalNoteCount: 20,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Okay', hasMissedAppt: true, hasApptSet: false, freshestApptEventDays: 2,
  relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
const PASS1 = 'Test, thanks for the reply. Sorry we missed you Saturday. Would you still like to come in? You can reply yes or no, and we will take it from there.\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Subject: A simple reset after Saturday\n\nHi Test,\n\nThanks for replying. Sorry we missed you Saturday. Would you still like to come in? A simple yes or no is fine.\n\nAgent Name\nTest Store';
const DROPPED = 'Test, would you still like to come in? Just reply yes or no, and we can find a day that works.\nAgent\nTest Store\n(555) 010-0100';
const KEPT = 'Test, I am glad to hear from you, and I am sorry we missed you Saturday. Would you still like to come in?\nAgent\nTest Store\n(555) 010-0100';

(async () => {
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const rp = (x) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')(PASS1, EMAIL, LEAD(x)); } finally { sb.console.log = ol; } };

  console.log(' 1. the rewrite is told:');
  check('a miss on this lead (lead 2091288708 shape): acknowledge it lightly, keep the ask, do not drop it to shorten', () =>
    /━━━ THE APPOINTMENT ON THIS LEAD WAS MISSED ━━━\nAcknowledge it lightly and without blame, as the first draft did[^\n]*never "you didn't show up"[^\n]*Do not drop the acknowledgement to make the text shorter\./.test(rp()), true);
  check('control: a no-show from earlier history (older than this lead), a rebooked appointment, or no miss -> not told', () =>
    [rp({ freshestApptEventDays: 40 }), rp({ hasApptSet: true }), rp({ hasMissedAppt: false })].map(t => /THE APPOINTMENT ON THIS LEAD WAS MISSED/.test(t)), [false, false, false]);

  console.log(' 2. a rewrite that drops the acknowledgement does not ship (worker stubbed):');
  const refine = async (reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — it acknowledged the missed appointment \("missed you"\) and the rewrite dropped it/.test(l))]; };
  await acheck('log300: "Test, would you still like to come in?" after "Sorry we missed you Saturday" -> the first pass ships, logged', () => refine(DROPPED), [null, true]);
  await acheck('control: a rewrite that keeps the apology ships', () => refine(KEPT), ['shipped', false]);
  await acheck('control: the same rewrite on a lead whose miss is older history ships (nothing on this lead to acknowledge)', () => refine(DROPPED, { freshestApptEventDays: 40 }), ['shipped', false]);
  const RX = run("typeof LP_MISS_ACK_RX !== 'undefined' ? LP_MISS_ACK_RX : /(?!)/");
  check('(new helper) what counts as acknowledging it -- and "missed your call" does not', () =>
    ['Sorry we missed you Saturday', 'sorry you couldn\'t make it', 'we didn\'t get to see you Saturday', 'I know plans can change', 'Sorry we missed your call', 'Would you still like to come in?'].map(t => RX.test(t)),
    [true, true, true, true, false, false]);

  console.log(' 3. the regen-variance row after a chip:');
  const a = src.indexOf('        var _rvChip = '), b = src.indexOf("'DIFFERENT MOVE \\u2014 the ask changed, not just the wording');", a);
  const verdict = (dir, key) => { if (a < 0 || b < 0) return '(not in this build)';
    const ctx = { window: { _lpRegenDirective: dir, _lpRegenChipKey: key }, _rvBest: 1, _rvAt: 1, String };
    vm.createContext(ctx); vm.runInContext(src.slice(a, b) + "'DIFFERENT MOVE');\nthis.__v = _rvVerdict;", ctx); return ctx.__v; };
  check('(new helper) after Warmer, the same move is reported as intended, not as rejected', () => verdict('Warm the tone.', 'warmer'),
    'SAME MOVE — draft #1 with the warmer adjustment, as intended: a chip keeps the move (v9.7.777)');
  check('(new helper) control: a plain Regenerate keeps the old verdict', () => verdict('', ''), 'SAME MOVE — this is draft #1 reworded, which is what the agent just rejected');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
