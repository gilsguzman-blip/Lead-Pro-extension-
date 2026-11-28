#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('bare-question-821.test.js');
// (v9.7.821) TWO THINGS FROM THE 10/22 REPORT. (1) Kia Baytown lead 2103933995, AI Buying Signals: the vehicle on the lead was our
// own used 2020 Mercedes-Benz GLC 300 (stock on file, on the Kia lot), and the drafts said "we don't carry Mercedes-Benz, so I can't
// show you the GLC 300" -- the cross-brand matrix read "mercedes" off the vehicle and never asked whether we hold it. Gil: "The GLC
// referenced is a pre-owned in stock." (2) Agents hit expand on bare one-question texts ("[Customer], would you like to come see the
// CR-V?"); v9.7.820's catch held only under the pitch rule. Gil: "Extend the bare question also." Now a used unit of that make that
// we hold is not cross-brand, and on every lead a rewrite cut down to the first draft's question alone does not ship.
// Executes the shipped classifyScenario, _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/bare-question-821.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: bare-question-821.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const STORES = { stores: [{ crmDealerId: '6190', brand: 'Kia', name: 'Test Kia' }, { crmDealerId: '6189', brand: 'Toyota', name: 'Test Toyota' }, { crmDealerId: '6191', brand: 'Honda', name: 'Test Honda' }] };
const UNIT = (make, model, cond) => ({ stock: 'P' + Math.random().toString(36).slice(2, 7), vehicle: '2020 ' + make + ' ' + model, year: 2020, make: make, model: model, condition: cond, color: 'Polar White', price: 30000 });
const AI = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', dealerId: '6190', store: 'Test Kia',
  leadSource: 'AI Buying Signals - Not Previously Sold (Phone)', vehicle: '2020 Mercedes-Benz GLC GLC 300', vehicleRaw: '2020 Mercedes-Benz GLC GLC 300', condition: 'Used', stockNum: 'P0001',
  convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, totalNoteCount: 12, relationshipSignals: { unansweredQuestions: [] }, history: '', context: '' }, x || {});
const PASS1 = 'Test, it was good to see you in the showroom yesterday, and the 2024 Accord LX you liked is still here. Would you like to come back with your wife to go over the numbers together?\nAgent';
const EMAIL = 'Subject: The Accord LX\n\nTest,\n\nIt was good to see you yesterday. Would you like to come back with your wife to go over the numbers?\n\nAgent Name';
const BARE = 'Test, would you like to come back with your wife to go over new options?\nAgent';
const KEPT = 'Test, good seeing you yesterday -- the Accord LX you liked is still here. Want to bring your wife back to go over the numbers together?\nAgent';
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2024 Honda Accord LX', dealerId: '6191', store: 'Test Honda',
  leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, lastInboundMsg: 'Thanks, we will talk it over.', phone: '(555) 010-0199',
  relationshipSignals: { unansweredQuestions: [] }, history: '', conversationBrief: '' }, x || {});

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  run('window')._leadProDealerData = STORES;
  const inv = (units) => { run('_lpValueFactCache')['6190'] = { inv: { units: units }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true }; };
  const cls = (d) => { const logs = [], ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...x) => logs.push(x.join(' ')); sb.console.warn = () => {};
    try { const s = sb.classifyScenario(d); return { cross: !!s.aiBSIsCrossBrand, target: s.aiBSTargetBrand, logs: logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. lead 2103933995: our own used Mercedes is not cross-brand:');
  inv([UNIT('Kia', 'Sorento', 'new'), UNIT('Mercedes-Benz', 'GLC 300', 'used')]);
  const own = cls(AI());
  check('the used GLC 300 on the lead carries our stock number: not cross-brand, logged', [own.target, own.cross, own.logs.some(l => /\[LP CROSS-BRAND DIAG\] suppressed -- "2020 Mercedes-Benz GLC GLC 300" is our own stock \(#P0001\): not cross-brand/.test(l))], ['mercedes', false, true]);
  inv([UNIT('Kia', 'Sorento', 'new'), UNIT('Mercedes-Benz', 'C 300', 'used')]);
  check('a make we hold used is not cross-brand either (no stock number on the lead)', cls(AI({ stockNum: '', vin: '' })).cross, false);
  inv([UNIT('Kia', 'Sorento', 'new'), UNIT('Kia', 'Telluride', 'new')]);
  check('control: a Mercedes we do not hold, no stock number -> still cross-brand', cls(AI({ stockNum: '', vin: '' })).cross, true);
  check('control: marked NEW -> still cross-brand', cls(AI({ stockNum: '', vin: '', condition: 'New' })).cross, true);

  console.log(' 2. on every lead, a rewrite cut down to a bare question does not ship (worker stubbed):');
  const refine = async (reply, lead, p1) => { const logs = []; sb.__reply = reply; sb.__d = lead;
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Honda" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(p1 || PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite cut it to a bare question/.test(l))]; };
  check('a showroom follow-up (no pitch rule): "[Customer], would you like to come back with your wife ...?" -> the first pass ships, logged', await refine(BARE, LEAD({ isShowroomFollowUp: true })), [null, true]);
  check('control: a rewrite that keeps where things stand ships', await refine(KEPT, LEAD({ isShowroomFollowUp: true })), ['shipped', false]);
  check('control: a first draft that was itself one question is not held to more', await refine(BARE, LEAD(), 'Test, would you like to come back with your wife to go over the numbers?\nAgent'), ['shipped', false]);
  const rp = String((() => { const ol = sb.console.log; sb.console.log = () => {}; try { return sb._lpBuildSmsRefinePrompt(PASS1, EMAIL, LEAD({ isShowroomFollowUp: true })); } finally { sb.console.log = ol; } })());
  check('the showroom offer block: the offer closes the text, it is not the whole text', /━━━ ONE CONCRETE OFFER ━━━\nThe offer closes the text; it is not the whole text\. Keep what the first draft says about their visit and where things stand before it\./.test(rp), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
