#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('mastermind-pick-801.test.js');
// (v9.7.801) THE CAR ON A MASTERMIND LEAD IS THE PROGRAM'S PICK. Audi Lafayette lead 2099729963 (log325): the vehicle on the
// lead was the replacement the Automotive Mastermind program suggested, and every draft treated it as the customer's choice --
// "The 2026 Q5 Sportback Premium 2.0 isn't in stock today ... Would you rather look at the other Q5 options, or wait for the
// Sportback?". Gil, 10/14: they never picked that car -- ask about a new version of what they drive now, or another Audi,
// with the bridge when the model was renamed ("the new A5, which replaced the A4"), and keep the suggested car out even when
// it is in stock. Once the customer writes on the lead, the normal vehicle handling. Also: the lead notice ("[Dealsheet]:
// ... [Lead pushed by]: ...") was quoted as "CUSTOMER'S INQUIRY -- the customer's own words" and, in the text rewrite, as
// "WHAT THE CUSTOMER LAST SAID -- 28 DAYS AGO". Executes the shipped helpers, populateFromData, buildUserPrompt,
// _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed) and the scraper's program-push test (lifted). Placeholder data only.
//
// Usage: node tests/mastermind-pick-801.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: mastermind-pick-801.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nAudi Lafayette\n(555) 010-0100';
const NOTICE = '[Request Date]: 10/14/2026 2:44:42 PM [Dealsheet]: email.automotivemastermind.com... [BPS]: 91 [Lead pushed by]: Rep Name';
const EMAIL = 'Hi Test,\n\nAs a current Audi owner you were selected for the GM Private Incentive, and I would be glad to go over it with you. I can arrange an appraisal of your A4 so you know exactly where you stand.\n\nWould you be interested in the new A5, which replaced the A4, or is there another Audi you have had your eye on?\n\nAgent Name\nAudi Lafayette\n(555) 010-0100';
const U = (stock, year, model) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: year + ' Audi ' + model, year, make: 'Audi', model, condition: 'new',
  certified: false, class: 'SUV', body: '4D Sport Utility', color: 'Glacier White Metallic', odometer: 5, daysOnLot: 10, price: null });
const FEED = [U('A001', 2026, 'A5 quattro'), U('A002', 2026, 'A5 quattro'), U('A003', 2026, 'Q5 2.0T Premium Plus quattro'), U('A004', 2026, 'Q5 Sportback Premium 2.0 TFSI quattro'),
  U('A005', 2026, 'SQ5 Premium Plus quattro'), Object.assign(U('A006', 2023, 'A4 Premium 40 TFSI quattro'), { condition: 'used' })];
const CTX0 = '[10/14/2026 9:44 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const CTX_REPLIED = '[10/14/2026 11:02 AM] [CUSTOMER] is the Q5 Sportback here?\n' + CTX0;
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Audi Q5 Q5 Sportback Premium 2.0 TFSI quattro',
  condition: 'New', stockNum: '', vin: '', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'AUTOMOTIVEMASTERMIND', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', hasTrade: true,
  tradeDescription: '2024 Audi A4 Sedan A4 Sedan Premium 40 TFSI quattro\n\t27,197 miles', relationshipSignals: { unansweredQuestions: [] }, history: CTX0, context: CTX0 }, x || {});
const OTHER = { leadSource: 'Audi Partner Lead' };
const P_CLEAN = 'Test, as a current Audi owner you were selected for the GM Private Incentive. Would you be interested in the new A5, which replaced the A4, or is there another Audi you\'ve had your eye on?' + SIG;
const R_NAMED = 'Test, you were selected for the GM Private Incentive. The Q5 Sportback isn\'t in stock today, but would you be interested in the new A5 or another Audi?' + SIG;
const R_CLEAN = 'Test, you were selected for the GM Private Incentive as a current Audi owner. Would you be interested in the new A5, which replaced the A4, or another Audi?' + SIG;

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const setFeed = (units) => { run('_lpValueFactCache')['21135'] = { inv: { units }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true }; };
  setFeed(FEED);
  run('activeFlags = new Set(); window._lpGrabStartedAt = 0;');
  const fn = (name) => { try { return run(name); } catch (e) { return null; } };

  console.log(' 1. what they drive now, and what to ask them about (new helper):');
  const model = fn('_lpAudiModelOf'), ask = fn('_lpMmModelAsk');
  check('the model reader: A4 sedan, SQ5, S5, RS Q8, RS 3, Q5 -- an S or RS model is not its base model', () =>
    ['2024 Audi A4 Sedan A4 Sedan Premium 40 TFSI quattro', 'SQ5 Premium Plus quattro', 'S5 3.0T Premium Plus quattro', 'RS Q8 performance 4.0T quattro', 'RS 3 2.5T quattro', 'Q5 2.0T Premium Plus quattro'].map(s => model(s)),
    ['A4', 'SQ5', 'S5', 'RS Q8', 'RS 3', 'Q5']);
  check('an A4 with no new A4 in the feed -> "the new A5, which replaced the A4"', () => { const a = ask(LEAD()); return [a.how, a.ask]; },
    ['successor', 'Would you be interested in the new A5, which replaced the A4, or is there another Audi you\'ve had your eye on?']);
  check('a Q5 owner and new Q5s in the feed -> "a new Q5"; a Q5 owner is not offered the SQ5 or the Sportback as their model', () => { const a = ask(LEAD({ tradeDescription: '2022 Audi Q5 Premium 45 TFSI quattro' })); return [a.how, a.ask]; },
    ['stock', 'Would you be interested in a new Q5, or is there another Audi you\'ve had your eye on?']);
  check('control: a TT, no current Audi, or a trade that is not an Audi -> a newer Audi, no model named', () =>
    [ask(LEAD({ tradeDescription: '2019 Audi TT Coupe' })).how, ask(LEAD({ tradeDescription: '' })).how, ask(LEAD({ tradeDescription: '2021 Honda Accord EX' })).ask],
    ['generic', 'generic', 'Would you be interested in a newer Audi, or is there a particular one you\'ve had your eye on?']);

  console.log(' 2. the prompt treats the car on the lead as the program\'s pick:');
  const up = (x) => quiet(() => sb.__lp.buildUserPrompt(LEAD(x)));
  const p = up();
  check('lead 2099729963: THE CAR ON THIS LEAD IS THE PROGRAM\'S PICK -- not named in any format, even in stock, no "wait for it"', () =>
    /^- THE CAR ON THIS LEAD IS THE PROGRAM'S PICK, NOT THEIRS: the 2026 Q5 Sportback Premium 2\.0 TFSI quattro was chosen by the Mastermind program as a possible replacement -- they never asked for it\. Do NOT name it in the SMS, email, voicemail or subject line, even if it is in stock/m.test(p), true);
  check('THE AUDI THEY DRIVE NOW: the A4, and the close is "the new A5, which replaced the A4, or is there another Audi"', () =>
    /^- THE AUDI THEY DRIVE NOW: their current Audi is the A4 \(the trade-in above\)\. Close every format on an open question about what they would want, e\.g\. "Would you be interested in the new A5, which replaced the A4, or is there another Audi you've had your eye on\?" -- the A4 is now the A5, so say it that way\./m.test(p), true);
  check('the old lines are gone: "reference it by name", "Name the vehicle separately", "THIS IS THE VEHICLE FOR THIS LEAD"', () =>
    [/reference it by name/.test(p), /Name the vehicle separately/.test(p), /THIS IS THE VEHICLE FOR THIS LEAD/.test(p), /^Vehicle: {4}\(none chosen by the customer\) ← The 2026 Audi Q5 Q5 Sportback Premium 2\.0 TFSI quattro on this lead was picked by the Automotive Mastermind program/m.test(p)],
    [false, false, false, true]);
  check('the inventory answer is not about it -- no WHAT WE HAVE, no "NONE in stock", no "They asked about" (a Q5 Sportback IS in this feed)', () =>
    [/WHAT WE HAVE|NONE in stock|IN STOCK --|They asked about/.test(p), /INVENTORY: VEHICLE NOTE: The 2026 Q5 Sportback Premium 2\.0 TFSI quattro on this lead is the Mastermind program's suggested replacement, not their choice\. Do NOT name it or say whether it is in stock -- not even if it is here\./.test(p)],
    [false, true]);
  const pR = up({ context: CTX_REPLIED, history: CTX_REPLIED, convState: 'active', hasCustomerReply: true, lastInboundMsg: 'is the Q5 Sportback here?' });
  check('control: once they write on the lead ("is the Q5 Sportback here?") the normal handling is back -- the car is theirs to ask about', () =>
    [/PROGRAM'S PICK|THE AUDI THEY DRIVE NOW/.test(pR), /THIS IS THE VEHICLE FOR THIS LEAD/.test(pR)], [false, true]);
  const pO = up(OTHER);
  check('control: an Audi Lafayette lead from another source keeps its vehicle of interest', () =>
    [/PROGRAM'S PICK|THE AUDI THEY DRIVE NOW|none chosen by the customer/.test(pO), /THIS IS THE VEHICLE FOR THIS LEAD/.test(pO)], [false, true]);

  console.log(' 3. the lead notice is the program\'s text, not the customer\'s words:');
  const pop = (x) => quiet(() => { const d = LEAD(Object.assign({ lastInboundMsg: NOTICE, conversationBrief: 'CUSTOMER\'S INQUIRY — the customer\'s own words when they submitted this lead. This is what they actually asked for; address it directly:\n"' + NOTICE + '"\n\nCONVERSATION TRANSCRIPT (newest first — read the full thread before responding):\n---\n' + CTX0 + '[CUSTOMER REQUEST FROM INQUIRY] ' + NOTICE + '\n---' }, x));
    run('leadContext = ""'); sb.populateFromData(d); return { ctx: run('leadContext'), last: d.lastInboundMsg }; });
  check('populate: no "CUSTOMER\'S INQUIRY", the transcript line reads MASTERMIND OFFER NOTICE, and it is not their last message', () => { const r = pop();
    return [/CUSTOMER'S INQUIRY/.test(r.ctx), /\[MASTERMIND OFFER NOTICE -- the program's lead notice, not the customer's words\]/.test(r.ctx), /Dealsheet/.test(r.ctx), r.last]; }, [false, true, false, '']);
  check('control: another source\'s inquiry is untouched', () => { const r = pop(OTHER); return [/CUSTOMER'S INQUIRY/.test(r.ctx), r.last === NOTICE]; }, [true, true]);
  const push = (content) => { const line = src.split('\n').find(l => /var _isProgramPush = /.test(l)); const box = {}; vm.createContext(box); return vm.runInContext('var content = ' + JSON.stringify(content) + ';' + line + '\n_isProgramPush;', box); };
  check('the scraper: the Mastermind notice is a program push (no inquiry is read from it); a typed comment is not', () =>
    [push(NOTICE), push('Customer comment: is the white one still available?')], [true, false]);

  console.log(' 4. the text rewrite:');
  const RP = (x) => quiet(() => run('_lpBuildSmsRefinePrompt')(P_CLEAN, EMAIL, LEAD(x)));
  const r1 = RP({ lastInboundMsg: NOTICE, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 28 } });
  check('lead 2099729963: no "WHAT THE CUSTOMER LAST SAID -- 28 DAYS AGO" quoting the notice; THE CAR ON THIS LEAD IS THE PROGRAM\'S PICK with the A5 question', () =>
    [/WHAT THE CUSTOMER LAST SAID/.test(r1), /Dealsheet/.test(r1),
     /━━━ THE CAR ON THIS LEAD IS THE PROGRAM'S PICK ━━━\nThe 2026 Q5 Sportback Premium 2\.0 TFSI quattro was picked by the Mastermind program as a possible replacement -- they never asked for it\. .*"Would you be interested in the new A5, which replaced the A4, or is there another Audi you've had your eye on\?"/.test(r1),
     /name the vehicle separately/.test(r1)], [false, false, true, false]);
  const r2 = RP({ context: CTX_REPLIED, history: CTX_REPLIED, lastInboundMsg: 'is the Q5 Sportback here?' });
  check('control: they wrote on the lead -> their message is shown and there is no program\'s-pick section', () =>
    [/WHAT THE CUSTOMER LAST SAID, IN THEIR OWN WORDS ━━━\n"is the Q5 Sportback here\?"/.test(r2), /PROGRAM'S PICK/.test(r2)], [true, false]);

  const refine = async (pass1, reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Audi Lafayette" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite named the Mastermind program's suggested car \("Q5"\)/.test(l))]; };
  await acheck('a first draft on the A5, a rewrite that says "The Q5 Sportback isn\'t in stock today" -> the first draft ships', () => refine(P_CLEAN, R_NAMED), [null, true]);
  await acheck('control: a rewrite that keeps to the A5 question ships', () => refine(P_CLEAN, R_CLEAN), ['shipped', false]);
  await acheck('control: they asked about the Q5 Sportback on the lead -> naming it ships', () => refine(P_CLEAN, R_NAMED, { context: CTX_REPLIED, history: CTX_REPLIED, lastInboundMsg: 'is the Q5 Sportback here?' }), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
