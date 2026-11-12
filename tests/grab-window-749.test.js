#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('grab-window-749.test.js');
// (v9.7.749) Kia Baytown lead 2086487722, 9/30 (log272, dump 44d65e8e). Two faults on one generation Gil called strong:
//  (1) v9.7.746 called a unit "NOT confirmed" because its inventory settled before the GRAB click -- 10 seconds before,
//      read when the popup opened at 11:57:03. The click rightly did not re-read a snapshot under a minute old, so the
//      check has to allow the same minute. In popup mode that was nearly every grab.
//  (2) The SMS rewrite turned the first pass's "I'll take your $32,250 drive-out target to my manager" into "I can't
//      confirm yet whether $32,250 is our final drive-out price" -- the hedge v9.7.745/748 took out of the draft.
// Executes the shipped _lpFeedUnitCheck and _lpRefineSms (full popup sandbox, worker call stubbed). Placeholder data.
//
// Usage: node tests/grab-window-749.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: grab-window-749.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const INV = { units: [{ stock: 'TEST001A', stockNum: 'TEST001A', vehicle: '2026 Kia Sorento S', year: 2026, make: 'Kia', model: 'Sorento S', condition: 'new', color: 'Panthera Metal' }] };
const BREAKDOWN = 'Hi Test, Available Manufacture Rebates* -$3,000.00 Community Repeat Customer^ -$250.00 Community Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $33,998.74';
const COUNTER = 'I will be financing thru KIA Finance. My Drive out price is $32,250.';
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const P1 = 'Test, I will take your $32,250 drive-out target to my manager and come back with an answer. What term are you considering?' + SIG;
const HEDGED = 'Test, I can’t confirm yet whether $32,250 is our final drive-out price. I will take it to my manager. What term are you considering?' + SIG;
const EMAIL = 'Subject: Your Sorento\n\nHi Test,\n\nI will take your $32,250 drive-out target to my manager and come back to you with an answer.\n\nAgent Name';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const sb = loadPopup(f, { withAuth: true });

    console.log(' 1. inventory read within the grab\'s minute counts as this grab\'s:');
    const confirmed = (settledBeforeGrabMs) => {
      const now = Date.now();
      sb.__c = { vf: null, inv: INV, fetchedAt: now - settledBeforeGrabMs - 50, invSettledAt: now - settledBeforeGrabMs, pending: false, _settled: 2 };
      vm.runInContext('_lpValueFactCache["6190"] = globalThis.__c; window._lpGrabStartedAt = Date.now();', sb);
      const r = sb._lpFeedUnitCheck({ dealerId: '6190', stockNum: 'TEST001A', vehicle: '2026 Kia Sorento S' });
      return r.confirmed;
    };
    check('log272 shape: read 10 seconds before the click (popup just opened) -> confirmed', confirmed(10000), true);
    check('control: read 90 seconds before the click and not re-read -> not confirmed', confirmed(90000), false);
    check('control: the log269 shape, read 23 minutes before -> not confirmed, as in v9.7.746', confirmed(23 * 60000), false);

    console.log(' 2. the SMS rewrite may not hedge on the number after a counter or push-back:');
    const ent = (days, tag, title, body) => '[' + ago(days, tag === 'CUSTOMER' ? '9:00 AM' : '5:44 PM') + '] [' + tag + '] ' + title + '\n  ' + body;
    const lead = (last, entries) => ({ autoLeadId: '2000000001', lastInboundMsg: last, conversationBrief: entries.join('\n'), context: '',
      relationshipSignals: { lastInboundAgeDays: 0, unansweredQuestions: [] } });
    const refine = async (pass1, reply, d) => {
      const logs = [];
      sb.__reply = reply; sb.__logs2 = logs;
      vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = "";'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
      const oldLog = sb.console.log; sb.console.log = (...x) => { logs.push(x.join(' ')); };
      sb.__d = d; sb.__p1 = pass1;
      let out; try { out = await vm.runInContext('_lpRefineSms(globalThis.__p1, ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { out = 'THREW ' + e.message; }
      const prompt = vm.runInContext('_lpBuildSmsRefinePrompt(globalThis.__p1, ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb);
      sb.console.log = oldLog;
      return { out, logs, prompt };
    };
    const dCounter = lead(COUNTER, [ent(0, 'CUSTOMER', 'Email reply from prospect', COUNTER), ent(1, 'AGENT', 'Email reply to prospect', BREAKDOWN)]);
    const r1 = await refine(P1, HEDGED, dCounter);
    check('log272 shape: counter on the lead, the rewrite put "can’t confirm ... final" back -> the first pass ships, logged',
      [r1.out, r1.logs.some(l => /kept the first pass — the customer pushed back or countered on price, and the rewrite hedged/.test(l))], [null, true]);
    check('...and the rewrite is told to keep it: acknowledge $32,250, taking it to the manager, no "can’t confirm"',
      [/THE PRICE: KEEP WHAT THE FIRST DRAFT DOES/.test(r1.prompt), /They countered with their own number, \$32,250/.test(r1.prompt)], [true, true]);
    check('control: a rewrite that keeps the manager line ships', (await refine(P1, P1.replace('What term', 'Which term'), dCounter)).out, P1.replace('What term', 'Which term'));
    const dPlain = lead('Sounds good, what time works?', [ent(0, 'CUSTOMER', 'Text', 'Sounds good'), ent(1, 'AGENT', 'Email reply to prospect', 'Hi Test, the Sorento is here.')]);
    check('control: no counter or push-back on the lead -> the same hedged rewrite ships, and no price line is added', [(await refine(P1, HEDGED, dPlain)).out, /THE PRICE: KEEP/.test((await refine(P1, HEDGED, dPlain)).prompt)], [HEDGED, false]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
