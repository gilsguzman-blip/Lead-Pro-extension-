#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('b2-hours-875.test.js');
// (v9.7.875) OWNER-APPROVED 11/16 ("build 875 as you suggested"), audit #2 B-2 step 2 and Honda Baytown lead 2110385633:
//  (a) one reader per fact: the three fact probes and the v9.7.559 commit observer are off, so a generation asks no probe.
//  (b) verbal commitment: the pattern no longer decides -- the same call notes that made the shipped prompt say "Customer already made
//      a verbal commitment" (the rollback, run beside it) now carry no such line, and the notes block tells the draft how to read one.
//  (c) day-lock and off-franchise: the pattern is still the reader -- a named day still locks, an off-franchise ask still gets its block.
//  (d) THEY HAVE TOLD US THEY CANNOT MAKE OUR HOURS: "I'm only off on sundays" / "I work 8 to 8 mon- Saturday" at a store closed Sundays
//      that closes at 8 -> no times, the phone/online route; controls where they can make our hours.
// Executes the build's own code (populateFromData, buildUserPrompt through the panel payload, _lpPrepareFactVerdicts,
// _lpCantMakeOurHours, the verbal-commit block). Placeholder data only.
//
// Usage: node tests/b2-hours-875.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const rollback = require('./helpers/rollback-875.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: b2-hours-875.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const at = (daysAgo, clock) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + clock; };
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const JASON = fs.readFileSync(path.join(__dirname, 'fixtures', 'jason-pellegrin-context.txt'), 'utf8');

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, rb, src; try { sb = loadPopup(f, { withAuth: true }); rb = loadPopup(f, { withAuth: true, srcTransform: rollback }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (box, g) => { const ol = box.console.log, ow = box.console.warn; box.console.log = () => {}; box.console.warn = () => {}; try { return g(); } finally { box.console.log = ol; box.console.warn = ow; } };
  const go = (box, lsd, bsrc) => quiet(box, () => { try { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', box); box.__L = lsd; vm.runInContext('lastScrapedData = globalThis.__L;', box); box.populateFromData(lsd);
      const ctx = String(vm.runInContext('leadContext', box) || ''); return { d: lsd, ctx, prompt: String(box.__lp.buildUserPrompt(panelPayload(bsrc || src, box, { lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const base = (brief, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: 'Honda Unknown', condition: 'New',
    dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'FullPath', convState: 'active-follow-up', leadAgeDays: 12, hasOutbound: true, hasCustomerReply: true,
    totalNoteCount: 30, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 7 },
    conversationBrief: brief, history: brief, context: '', autoLeadId: 'TEST004D', stockNum: '', vin: '' }, x || {});

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (a) one reader per fact -- no probe runs:');
  check('the shipped switches: the three probes, the 559 observer and the verbal-commitment pattern are off',
    () => vm.runInContext('[LEADPRO_VERBALCOMMIT_COMPREHENSION, LEADPRO_DAYLOCK_COMPREHENSION, LEADPRO_OFFFRANCHISE_COMPREHENSION, LEADPRO_COMMIT_COMPREHENSION, LEADPRO_VERBALCOMMIT_REGEX]', sb), [false, false, false, false, false]);
  let calls = 0;
  sb.__countProbes = () => { calls++; return Promise.resolve({}); };
  vm.runInContext('_lpRunAllFactProbes = function () { return globalThis.__countProbes(); };', sb);   // the dispatcher: any probe at all goes through it
  const pv = quiet(sb, () => vm.runInContext('_lpPrepareFactVerdicts', sb)({ context: JASON, conversationBrief: JASON, history: JASON, dealerId: '6191', autoLeadId: 'TEST004D' }, {}));
  check('a generation never reaches the probe dispatcher', () => [calls, typeof (pv && pv.then)], [0, 'function']);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (b) verbal commitment: the draft reads the call notes itself:');
  const JL = base(JASON, { context: JASON, vehicle: '2026 Honda Accord', leadSource: 'Phone Up', convState: 'call-followup' });
  const pShip = go(sb, JSON.parse(JSON.stringify(JL))).prompt, pRoll = go(rb, JSON.parse(JSON.stringify(JL)), rollback(src)).prompt;
  check('the rollback (the pattern deciding, as before 875) writes "Customer already made a verbal commitment"', () => /Customer already made a verbal commitment/.test(pRoll), true);
  check('the shipped build, same lead: no such line', () => /Customer already made a verbal commitment/.test(pShip), false);
  check('...and the notes block tells the draft what an agreement is, and that a car they own or our own words are not one',
    () => /THE CUSTOMER AGREED TO SOMETHING WITH US:[^\n]*Only what the customer said counts -- a description of a car they already own, or our own words, is not an agreement\./.test(pShip), true);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (c) day-lock and off-franchise keep the pattern as their reader:');
  const pDay = go(sb, base(E(at(1, '2:00 PM'), 'CUSTOMER', 'Inbound Text Message', 'Tuesday works for me.') + MARK(at(5, '9:00 AM')),
    { customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: Customer said Tuesday is when they are available. LOCK IN Tuesday - do NOT offer any other day. Offer two specific times on Tuesday only. Do NOT try to pull them in sooner.' })).prompt;
  check('a named day still locks the times to that day', () => /CUSTOMER NAMED A SPECIFIC DAY|LOCK IN Tuesday/.test(pDay), true);
  const OF = 'we are planning to purchase a new chevy silverado in a couple weeks. Do you have any in dark red?';
  const pOf = go(sb, base(E(at(0, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', OF) + MARK(at(1, '9:00 AM')), { dealerId: '24399', store: 'Community Honda Lafayette', lastInboundMsg: OF })).prompt;
  check('an off-franchise ask still gets its block (the store\'s brand and its two plays)', () => /OFF-FRANCHISE REQUEST/.test(pOf), true);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (d) they have told us they cannot make our hours:');
  const cmh = vm.runInContext('typeof _lpCantMakeOurHours === "function" ? _lpCantMakeOurHours : null', sb) || (() => null);   // absent before 875
  const T = (extra) => (extra || '')
    + E(at(7, '11:09 AM'), 'AGENT', 'Outbound Text Message', 'Understand let us know when you have time to come in\nBy: Rep Name')
    + E(at(7, '10:12 AM'), 'CUSTOMER', 'Inbound Text Message', 'I work 8 to 8 mon- Saturday')
    + E(at(9, '9:01 AM'), 'CUSTOMER', 'Inbound Text Message', 'I work 8 to 8')
    + E(at(9, '8:56 AM'), 'AGENT', 'Outbound Text Message', 'Unfortunately we are closed on Sunday but we can do most of the buying process over the phone\nBy: Rep Name')
    + E(at(9, '8:52 AM'), 'CUSTOMER', 'Inbound Text Message', 'I’m only off on sundays')
    + MARK(at(12, '2:30 PM'));
  const r = quiet(sb, () => cmh({ history: T(), dealerId: '6191' }));
  check('lead 2110385633\'s shape (Honda Baytown, 9 AM - 8 PM, closed Sunday): their hours cover ours and their only day off is Sunday',
    () => r && [/^I.m only off on sundays \/ I work 8 to 8 mon- Saturday$/.test(r.quote), r.why], [true, 'Their working hours cover every hour we are open, every day we are open. Their only day off is Sunday, and we are closed on Sundays.']);
  const g = go(sb, base(T(), { lastInboundMsg: 'I work 8 to 8 mon- Saturday' }));
  check('the prompt: no times in any format, the phone/online route or a window that works', () => [/THEY HAVE TOLD US THEY CANNOT MAKE OUR HOURS/.test(g.prompt), /most of the purchase can be handled by phone, text or online/.test(g.prompt)], [true, true]);
  check('...the visit decision holds the times (their SCHEDULE) and the suggested times are gone',
    () => [/VISIT DECISION FOR THIS MESSAGE: no specific appointment times[^\n]*-- (?:their SCHEDULE \(they cannot make our hours\)|the [A-Z])/.test(g.prompt), /their SCHEDULE \(they cannot make our hours\) owns this|THEY HAVE TOLD US THEY CANNOT MAKE OUR HOURS/.test(g.prompt), /SUGGESTED APPOINTMENT TIMES/.test(g.prompt)], [true, true, false]);
  const one = (body, dl) => quiet(sb, () => cmh({ history: E(at(1, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', body) + MARK(at(5, '9:00 AM')), dealerId: dl || '6191' }));
  check('"I\'m only off on Sundays" alone (closed Sunday) -> they cannot make our hours', () => !!one('I’m only off on Sundays'), true);
  check('control: "I work 8 to 5 Monday through Saturday" -> they can come after five: no', () => one('I work 8 to 5 Monday through Saturday'), null);
  check('control: "I\'m only off on Mondays" (we are open Mondays) -> no', () => one('I’m only off on Mondays'), null);
  check('control: Audi Lafayette (open until 7) and "I work 9 to 6 Mon-Sat" -> they can make the last hour: no', () => one('I work 9 to 6 mon-sat', '21135'), null);
  check('control: a newer message of theirs names a time -> no', () => quiet(sb, () => cmh({ history: T(E(at(1, '9:00 AM'), 'CUSTOMER', 'Inbound Text Message', 'Actually I could do Saturday at 9 before work')), dealerId: '6191' })), null);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
