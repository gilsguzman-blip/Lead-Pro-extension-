#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quiet-voi-858.test.js');
// (v9.7.858) OWNER-APPROVED 11/3. Audi Lafayette lead 2086496908 (log392): a 2023 Lexus RX 350, confirmed in stock, customer
// 42 days quiet with 25 of our messages unanswered. The QUIET CUSTOMER rule (top of the prompt, outranks every block) made the
// SIMILAR VEHICLES angle the message's one job -- "we have 2026 Genesis GV70; 2025 Audi Q5 in stock now. Offer ONE" -- and two
// drafts in a row pitched the GV70, then the Q5, which our 10/22 email had already offered.
//  (1) While the vehicle on the lead is confirmed in stock (no sold claim, no pending deal) and the customer never asked for
//      options, the job is a check-in on THAT vehicle, and the SIMILAR VEHICLES line comes out of the prompt. An alternative is
//      for a vehicle we cannot confirm, or a customer who asked for options (unchanged there).
//  (2) A comparable our own messages already offered (its model and its year or color) is dropped from SIMILAR VEHICLES. One of
//      the same model as their own vehicle needs its color (one their vehicle does not have): "your 2026 RAV4" is about theirs.
// Executes _lpCompAlreadyOffered, _lpAskedForOptions, populateFromData with an inventory snapshot, and buildUserPrompt through
// the panel payload. Placeholder data only.
//
// Usage: node tests/quiet-voi-858.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quiet-voi-858.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[09/19/2026 9:30 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const Q5_EMAIL = E('10/22/2026 2:40 PM', 'AGENT', 'Email reply to prospect', 'Subject: A white Q5 as another option By: Agent Name Hi Test, I can also offer the white 2025 Audi Q5 Premium Plus quattro as another option alongside the Lexus you asked about.');
const BASE_H = E('11/01/2026 9:37 AM', 'AGENT', 'Email reply to prospect', 'Subject: Your 2023 Lexus RX 350 awaits Hi Test, checking in on the RX.')
  + Q5_EMAIL
  + E('10/05/2026 2:12 PM', 'AGENT', 'Email reply to prospect', 'Subject: The Lexus RX 350 drive-out details Hi Test, the orange 2023 Lexus RX 350 is here and available to see.')
  + E('09/22/2026 10:00 AM', 'CUSTOMER', 'Inbound Text Message', 'What is the out the door price on the RX?')
  + MARK;
const U_ = (stock, vehicle, year, make, model, color, price, dol) => ({ stock, vin: '', vehicle, year, make, model, condition: 'used', certified: false,
  class: 'SUV, Luxury Sport Utility', body: '4D Sport Utility', color, interior: 'Black', odometer: 15000, daysOnLot: dol, price, stockNum: stock });   // the feed's own shape
const UNITS = [U_('TEST0L1', '2023 Lexus RX 350 Luxury', 2023, 'Lexus', 'RX 350 Luxury', 'Copper', 38788, 113),
  U_('TEST0G1', '2026 Genesis GV70 2.5T', 2026, 'Genesis', 'GV70 2.5T', 'Vik Black', 37599, 82),
  U_('TEST0Q1', '2025 Audi Q5 2.0T Premium Plus quattro', 2025, 'Audi', 'Q5 2.0T Premium Plus quattro', 'White', 40998, 76)];
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2023 Lexus RX 350',
  condition: 'Pre-Owned', stockNum: 'TEST0L1', _pdUnitStock: 'TEST0L1', _pdStatus: 'A', color: 'Orange', dealerId: '21135', store: 'Audi Lafayette',
  leadSource: 'Cargurus Area Boost', convState: 'active-follow-up', leadAgeDays: 45, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 30,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'What is the out the door price on the RX?',
  relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 42, consecutiveOutboundNoReply: 25 }, history: BASE_H, conversationBrief: BASE_H }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const go = (lsd, units, payloadOver) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { sb.__U = units || UNITS; run('_lpValueFactCache["21135"] = { inv: { units: globalThis.__U } }; activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd);
      const ctx = String(run('leadContext') || ''); const p = Object.assign(panelPayload(src, sb, { lsd: lsd, context: ctx }), payloadOver || {});
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(p)), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const job = (p) => (p.match(/THIS MESSAGE HAS ONE JOB:[^\n]*/) || [''])[0];
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');

  console.log(' 1. a unit we already offered:');
  const off = fn('_lpCompAlreadyOffered');
  const ours = [{ date: '10/22', body: 'I can also offer the white 2025 Audi Q5 Premium Plus quattro as another option' }];
  check('the white 2025 Q5 our 10/22 email offered -> offered (10/22)', () => off ? off('2025 Audi Q5 2.0T Premium Plus quattro (White)', ours) : 'no helper', '10/22');
  check('the GV70 we never named -> not offered', () => off ? off('2026 Genesis GV70 2.5T (Vik Black)', ours) : 'no helper', '');
  check('control: the model named with neither its year nor its color ("a Q5 could work") -> not offered', () =>
    off ? off('2025 Audi Q5 2.0T Premium Plus quattro (White)', [{ date: '10/01', body: 'A Q5 could work too.' }]) : 'no helper', '');
  const rav = { vehicle: '2026 Toyota RAV4', color: '' };
  check('same model as their own vehicle: "your 2026 RAV4" is about theirs, not the 2026 RAV4 XSE beside it -> not offered', () =>
    off ? off('2026 Toyota RAV4 XSE (Blue)', [{ date: '10/29', body: 'Test, your 2026 RAV4 is here and ready.' }], rav) : 'no helper', '');
  check('...but naming that unit by its color is an offer -> offered', () =>
    off ? off('2026 Toyota RAV4 XSE (Blue)', [{ date: '10/29', body: 'We also have a blue 2026 RAV4 XSE.' }], rav) : 'no helper', '10/29');
  check('a model from the model table matches too (Grand Highlander, by year)', () =>
    off ? off('2026 Toyota Grand Highlander XLE (Blue)', [{ date: '10/02', body: 'We also have a 2026 Grand Highlander XLE.' }]) : 'no helper', '10/02');

  console.log(' 2. they asked to see options:');
  const ask = fn('_lpAskedForOptions');
  const withCust = (t) => LSD({ history: E('10/20/2026 9:00 AM', 'CUSTOMER', 'Inbound Text Message', t) + BASE_H });
  check('"do you have anything else similar?" and "send me other options" -> asked', () =>
    ask ? [!!ask(withCust('do you have anything else similar?')), !!ask(withCust('send me other options please'))] : 'no helper', [true, true]);
  check('control: "is the RX still there?" -> not asked', () => ask ? ask(withCust('is the RX still there?')) : 'no helper', null);

  console.log(' 3. the quiet customer, their vehicle confirmed in stock:');
  const a = go(LSD());
  check('the one job is a check-in on the Lexus, and no other vehicle is offered', () =>
    [/The vehicle they asked about, the 2023 Lexus RX 350, is still in stock\. Make this a short check-in on THAT vehicle/.test(job(a.prompt)),
     /Do not offer another vehicle in this message/.test(job(a.prompt)), /Offer ONE as an extra option/.test(a.prompt), /Genesis GV70|Audi Q5/.test(job(a.prompt))],
    [true, true, false, false]);
  check('the SIMILAR VEHICLES line is out of the prompt', () => /SIMILAR VEHICLES IN STOCK/.test(a.prompt), false);
  check('control: still no appointment times (30+ days quiet)', () => /no appointment times in this message/.test(job(a.prompt)), true);
  check('[LP QUIET CUSTOMER DIAG] says which job and why', () => /job: check-in on the vehicle on the lead \(confirmed in stock; alternatives not offered, they never asked for options\)/.test(a.logs), true);

  console.log(' 4. the alternative stays where it belongs:');
  check('the Q5 we already offered is dropped from SIMILAR VEHICLES; the GV70 is kept', () =>
    [/SIMILAR VEHICLES IN STOCK[^\n]*Genesis GV70/.test(a.ctx), /SIMILAR VEHICLES IN STOCK[^\n]*Audi Q5/.test(a.ctx),
     /\[LP SIMILAR VEHICLES DIAG\] already offered in our messages, dropped: 2025 Audi Q5[^\n]*\(offered 10\/22\)/.test(a.logs)], [true, false, true]);
  // Not confirmed: the payload the prompt reads says the feed does not confirm the unit (as it does when the confirmation is
  // set aside, or the feed and VinSolutions do not list it); the SIMILAR VEHICLES line is the one populateFromData wrote.
  const nc = go(LSD(), null, { _lpInvConfirmedAvailable: false });
  check('their vehicle not confirmed in stock -> the alternative job, as before (the GV70; the Q5 already offered is not)', () =>
    [/The current reason on this lead: we have 2026 Genesis GV70 2\.5T \(Vik Black\) in stock now\. Offer ONE/.test(job(nc.prompt)), /Audi Q5/.test(job(nc.prompt))], [true, false]);
  const asked = go(withCust('do you have anything else similar?'));
  check('they asked for options -> the alternative job, even with their vehicle in stock', () =>
    [/Offer ONE as an extra option/.test(job(asked.prompt)), /they asked for options 10\/20/.test(asked.logs)], [true, true]);
  const fresh = go(LSD({ relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 2, consecutiveOutboundNoReply: 1 } }));
  check('control: a customer who is not quiet gets no quiet rule, and SIMILAR VEHICLES stays as a side angle', () =>
    [/THIS MESSAGE HAS ONE JOB/.test(fresh.prompt), /SIMILAR VEHICLES IN STOCK/.test(fresh.prompt)], [false, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
