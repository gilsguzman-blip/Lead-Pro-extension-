#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('visit-question-844.test.js');
// (v9.7.844) A VISIT ASK WRITTEN AS A QUESTION. Honda Lafayette lead 2107308865 (log385): she test-drove the Passport and "will let me
// know after she does further research", so the prompt decided on no visit ask (the PAUSE rule, level 3). The first draft closed "I'm
// here if you want to revisit it later." -- a door, not an ask; the text rewrite closed "Want to revisit it and go over new options
// together?" and shipped, because v9.7.835's guard knew "come in", "stop by", "what time works" and two times, not this. The statement
// form stays allowed. Executes LP_VISIT_ASK_RX and _lpRefineSms. Placeholder data only.
//
// Usage: node tests/visit-question-844.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: visit-question-844.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nYou liked the Passport after your test drive. Take the time you need; we are here if you decide you would like to revisit it.\n\nAgent Name\nTest Store\n(555) 010-0100';
const P1 = 'Test, you liked the Passport after your test drive. No pressure to decide now. I’m here if you want to revisit it later.' + SIG;
const ASK = 'Test, I get why you’d want to research more after your test drive. No pressure to decide now. Want to revisit it and go over new options together?' + SIG;
const D = { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', dealerId: 'TST1', store: 'Test Store', leadSource: 'Dealers WebSite', convState: 'pause',
  leadAgeDays: 1, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 8, phone: '(555) 010-0199', email: '', lastInboundMsg: '', isShowroomFollowUp: true,
  relationshipSignals: { unansweredQuestions: [] }, history: '', conversationBrief: '' };

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const rx = run('LP_VISIT_ASK_RX');

  console.log(' 1. the question forms are visit asks; the door is not:');
  check('lead 2107308865: "Want to revisit it and go over new options together?" is a visit ask', () => rx.test('Want to revisit it and go over new options together?'), true);
  check('"Would you like to take another look at it?" and "Ready to go over the numbers?" are visit asks', () =>
    [rx.test('Would you like to take another look at it?'), rx.test('Ready to go over the numbers?')], [true, true]);
  check('control: the first draft\'s "I’m here if you want to revisit it later." is not', () => rx.test('I’m here if you want to revisit it later.'), false);
  check('control: "come back in" was always one', () => rx.test('Would you like to come back in Saturday?'), true);

  console.log(' 2. the text rewrite on a lead where the prompt decided on no visit ask:');
  const refine = async (level, reply) => { const logs = []; sb.__reply = reply; sb.__d = D;
    run('_lpLastVisitDecision = { level: ' + level + ', owner: "the PAUSE rule (not ready)" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(P1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } finally { sb.console.log = ol; sb.console.warn = ow; }
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the prompt decided on no visit ask \(the PAUSE rule \(not ready\)\) and the rewrite added one/.test(l))]; };
  await acheck('log385: the rewrite turns the door into "Want to revisit it ... together?" -> the first draft ships', () => refine(3, ASK), [null, true]);
  await acheck('control: a rewrite that keeps the door as a statement ships', () =>
    refine(3, 'Test, I get why you’d want to research more after your test drive. No pressure to decide now. I’m here if you want to revisit it later.' + SIG), ['shipped', false]);
  await acheck('control: the same question where a visit ask is allowed (level 0) ships', () => refine(0, ASK), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
