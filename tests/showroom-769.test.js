#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('showroom-769.test.js');
// (v9.7.769) log290: five showroom follow-ups on 768, two page dumps.
//  (1) Honda Lafayette lead 2082889754: "did i get pre approved" (9/14) and "Can I come today after 3:30" (10/6 8:25 AM) stayed
//      OPEN after a two-hour visit that afternoon (test drive, write-up, finance turnover, "GOT APPROVED"); the text rewrite
//      answered both. A question asked before the newest showroom visit is now HANDLED-AT-VISIT.
//  (2) The rewrite then wrote "You weren't pre-approved based on what I have here" to an approved customer. No credit result is
//      written: a rule in both prompts, and a rewrite that states one where the first pass did not loses to the first pass.
//  (3) Thin notes gave "What would be most helpful? ... What would you like help with?"; notes naming the vehicle she liked got
//      768's own example question twice. Notes that name a vehicle count; thin notes get one concrete yes/no offer; one question.
//  (4) Gil, 10/7: every showroom be-back closes on ONE concrete yes/no offer, vehicle on file or not (lead 2094209825 closed
//      "What part of the decision would be most helpful to revisit?"); the rewrite is told to keep it.
// Executes the shipped detectUnansweredQuestions (lifted, as open-thread-resolver does), populateFromData, buildSystemPrompt,
// _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/showroom-769.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: showroom-769.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const item = (dir, date, body) => ({ getAttribute: k => (k === 'data-direction' ? dir : null),
  querySelector: sel => sel === '.notes-and-history-item-content' ? { innerText: body } : sel === '.notes-and-hsitory-item-date' ? { innerText: date } : null });
// newest first, as VinSolutions lists them
const NOTES = [
  item('', '10/06/2026 4:04 PM', 'By: Rep Name\nPAYMENT DIDNT FIT, NO MORE MONEY DOWN\nShowroom visit started at 10/06/2026 4:05 PM lasting 2 hours\nDemo - Test Drive\nWriteup'),
  item('outbound', '10/06/2026 9:40 AM', 'Sent to: (555) 010-0199\nSent by: Agent Name\nyes let me send you over our address and who to ask for when you arrive'),
  item('inbound', '10/06/2026 8:25 AM', 'Received from: (555) 010-0199\nCan I come today after 3:30'),
  item('inbound', '09/14/2026 12:02 PM', 'Received from: (555) 010-0199\ndid i get pre approved'),
];
const AFTER = item('inbound', '10/07/2026 8:15 AM', 'Received from: (555) 010-0199\nCan you send me the numbers on the Pilot?');
(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const a = src.indexOf('      (function detectUnansweredQuestions() {'), b = src.indexOf('\n      })();', a);
  const code = src.slice(a, b + '\n      })();'.length);
  const detect = (notes, visitMs) => { const diag = [], sig = { unansweredQuestions: [] };
    const sb = { noteEls: notes, sig, parseNoteDate: s => Date.parse(s) || 0, _lpD: function () { diag.push(Array.prototype.join.call(arguments, ' ')); } };
    if (visitMs !== undefined) sb._lastVisitMs = visitMs;
    vm.createContext(sb); vm.runInContext(code, sb); return { open: sig.unansweredQuestions.map(q => q.question), diag: diag.join(' ') }; };
  const VISIT = Date.parse('10/06/2026 4:04 PM');
  console.log(' 1. questions asked before the visit (executed detector):');
  const r = detect(NOTES, VISIT);
  check('lead 2082889754 shape: both pre-visit questions are handled at the visit, none left open', () => r.open, []);
  check('...and the diagnostic says why, for each', () => (r.diag.match(/HANDLED-AT-VISIT/g) || []).length, 2);
  check('a question asked AFTER the visit is still open', () => detect([AFTER].concat(NOTES), VISIT).open, ['Can you send me the numbers on the Pilot?']);
  check('control: no visit on the lead -> the old behaviour (open)', () => detect(NOTES, 0).open.length > 0, true);
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  console.log(' 2. no credit decisions in writing:');
  const sys = sb.__lp.buildSystemPrompt('bdc');
  check('the main prompt carries the rule', () => /NO CREDIT DECISIONS IN WRITING: never tell the customer in a message whether they were approved, pre-approved, declined or not approved/.test(sys), true);
  const lead = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399',
    store: 'Community Honda Lafayette', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
    showroomDetails: 'PAYMENT DIDNT FIT', hasOutbound: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
    lastInboundMsg: 'It was great service I just have to keep looking', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
  const rp = run('_lpBuildSmsRefinePrompt')('Test, thanks for coming in.', 'Subject: Your visit\n\nTest,\n\nThanks for coming in to see Rep yesterday. Rep can put the numbers together so you can look them over.\n\nAgent Name', lead());
  check('the text rewrite\'s own system prompt carries it too', () => /NO CREDIT DECISIONS IN WRITING\. Never tell the customer whether they were approved, pre-approved or declined/.test(run('buildSystemPromptSmsRefine')('Agent', 'Test Store', '(555) 010-0100')), true);
  const RX = run("typeof LP_CREDIT_DECISION_RX !== 'undefined' ? LP_CREDIT_DECISION_RX : /(?!)/");
  check('(new helper) the guard reads a stated result and leaves conditional wording alone', () =>
    ['You weren’t pre-approved based on what I have here', "you've been approved", 'You were declined', 'if financing is approved', 'subject to credit approval', 'for qualified buyers'].map(t => RX.test(t)),
    [true, true, true, false, false, false]);
  const PASS1 = 'Test, I’m glad Rep and the team took care of you. Rep can put together the numbers on what you looked at so you can review them at home. Want him to send them?';
  const EMAIL = 'Subject: Your visit\n\nTest,\n\nThanks for coming in to see Rep yesterday. Rep can put together the numbers on what you looked at so you can look them over at home. Want him to send them?\n\nAgent Name\nInternet Sales Coordinator\nTest Store';
  const refine = async (reply) => { const logs = []; sb.__reply = reply; sb.__d = lead();
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out, logs.some(l => /kept the first pass — the rewrite stated a credit decision/.test(l))]; };
  await acheck('a rewrite that adds "You weren’t pre-approved" -> the first pass ships, logged', () =>
    refine('Test, glad Rep took care of you. You weren’t pre-approved based on what I have here, but we can go over options. Want the numbers?'), [null, true]);
  await acheck('control: a rewrite with no credit result is kept', async () => { const x = await refine('Test, glad Rep and the team took care of you. Want Rep to send the numbers on what you looked at?'); return [typeof x[0] === 'string' && x[0].length > 0, x[1]]; }, [true, false]);
  console.log(' 3. what counts as a vehicle on the lead (new helper):');
  const nv = (x) => run("typeof _lpShowroomNoVehicle")==='function' ? run('_lpShowroomNoVehicle')(lead(x)) : '(missing)';
  check('lead 2094209825 shape: vehicle field set but noVehicleAtAll true -> a vehicle IS on the lead, no rule, no notice', () =>
    nv({ vehicle: '2023 Ford F-150 XL', noVehicleAtAll: true, stockNum: 'TEST001A' }), null);
  check('no vehicle text but a stock number or a VIN -> a vehicle is on the lead', () => [nv({ stockNum: 'TEST001A' }), nv({ vin: 'TESTVIN0000000001' })], [null, null]);
  check('nothing at all -> the rule applies', () => nv({ vehicle: '', stockNum: '', vin: '' }), { rep: 'Rep Name' });
  console.log(' 4. the showroom wording (executed populateFromData):');
  run('activeFlags = new Set(); leadContext = "";'); const ol = sb.console.log; sb.console.log = () => {}; try { sb.populateFromData(lead()); } finally { sb.console.log = ol; }
  const c = run('leadContext');
  check('notes that name a vehicle, trim or color, or numbers not yet seen, count as something to pick up', () =>
    /if they name a vehicle, trim or color that caught their eye, numbers they did not get to see/.test(c), true);
  check('thin notes: one concrete yes/no offer, not an open question; 768\'s example question is gone', () =>
    [/make ONE concrete offer they can answer yes or no -- Rep putting together new options on what they looked at to go over with them when they come back in, a second look, or an appraisal of their trade/.test(c),
     /Not an open "what would help" or "what matters most" question/.test(c), /ask ONE forward-looking question about them -- what matters most/.test(c)], [true, true, false]);
  check('one question in the whole message, and the rewrite is told to keep the one concrete offer', () => [/One question in the whole message\./.test(c), /The text closes on ONE concrete offer they can answer yes or no -- keep the first draft's\./.test(rp)], [true, true]);
  console.log(' 5. every be-back closes on a concrete offer (Gil, 10/7):');
  const withVeh = lead({ vehicle: '2023 Ford F-150 XL', stockNum: 'TEST001A', showroomDetails: 'WENT TO FINANCE AND GOT ALL THE DETAILS AND WANTED TO THINK ABOUT IT' });
  run('activeFlags = new Set(); leadContext = "";'); const ol2 = sb.console.log; sb.console.log = () => {}; try { sb.populateFromData(withVeh); } finally { sb.console.log = ol2; }
  const cv = run('leadContext');
  check('lead 2094209825 shape (vehicle on file, "wanted to think about it"): the concrete-offer close renders, the no-vehicle line does not', () =>
    [/CLOSE WITH ONE CONCRETE OFFER they can answer yes or no, and the offer BRINGS THEM BACK IN: the rep putting together new options for what the notes say \(a different down payment or term/.test(cv),
     /NOT an open question \("what would help", "what part of the decision"/.test(cv), /NO VEHICLE ON THE LEAD FOR THIS VISIT/.test(cv)], [true, true, false]);
  check('...and its text rewrite gets the same close', () => /ONE CONCRETE OFFER/.test(run('_lpBuildSmsRefinePrompt')('Test, Rep can rework the numbers. Want options?', EMAIL, withVeh)), true);
  run('activeFlags = new Set(); leadContext = "";'); sb.console.log = () => {}; try { sb.populateFromData(lead({ isShowroomFollowUp: false, vehicle: '2023 Ford F-150 XL' })); } finally { sb.console.log = ol2; }
  check('control: not a showroom follow-up -> no concrete-offer close, and no rewrite block', () =>
    [/CLOSE WITH ONE CONCRETE OFFER/.test(run('leadContext')), /ONE CONCRETE OFFER/.test(run('_lpBuildSmsRefinePrompt')('Test, hi.', EMAIL, lead({ isShowroomFollowUp: false })))], [false, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
