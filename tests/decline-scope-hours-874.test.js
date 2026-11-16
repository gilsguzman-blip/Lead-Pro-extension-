#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('decline-scope-hours-874.test.js');
// (v9.7.874) OWNER-APPROVED 11/16 ("2-6 go with your suggestion. run with ready to build options"):
//  (a) THEY PASSED ON THIS ONE. Audi Lafayette lead 2109434327 (dump 11/16): "Thank you but I don't think that will work." / "No. I
//      will just keep looking." -- no hold, and the text rewrite shipped "here today ... There's still time this afternoon".
//  (b) the opener: never a sentence built only to put the vehicle first ("the 2027 Sportage is what you are looking for").
//  (c) audit #2 SC-1 / ST-2: the scenario flags read the fields, not phrases anywhere in the context.
//  (d) SC-2 (an exit phrase cannot end a lead whose start is unknown) and SC-3 (keepingTrade reads the customer's lines only).
//  (e) ST-3: the pause field mirrors convState.   (f) ST-1: the slot engine reads STORE_HOURS.
// Executes the build's own functions (populateFromData, buildUserPrompt through the panel payload, _lpTheyDeclined,
// _lpBuildSmsRefinePrompt, classifyScenario, computeAppointmentTimes) and the scraper's lines lifted from the file. Placeholder data.
//
// Usage: node tests/decline-scope-hours-874.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: decline-scope-hours-874.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const U = (vehicle, color) => { const p = vehicle.split(' '); return { stock: 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase(), vin: '', vehicle, year: +p[0], make: p[1], model: p.slice(2).join(' '),
  condition: 'used', certified: false, class: 'SUV', body: '4D Sport Utility', color: color || 'Snow White Pearl', interior: 'Black', odometer: 9000, daysOnLot: 20, price: 26000 }; };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd);
      const ctx = String(run('leadContext') || ''); return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const base = (brief, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Sportage LX', condition: 'Used',
    dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Audi Partner Lead - Used/Cpo', convState: 'active-follow-up', leadAgeDays: 13, hasOutbound: true, hasCustomerReply: true,
    totalNoteCount: 40, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 4 },
    conversationBrief: brief, history: brief, context: '', autoLeadId: 'TEST003C', stockNum: 'TESTSP1', vin: '' }, x || {});
  setUnits('21135', [Object.assign(U('2026 Kia Sportage LX'), { stock: 'TESTSP1' })]);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (a) they passed on this one:');
  const THREAD = (extra) => (extra || '')
    + E(at(4, '3:20 PM'), 'AGENT', 'Outbound Text Message', 'My pleasure. Save this number just in case.\nBy: Rep Name')
    + E(at(4, '3:13 PM'), 'CUSTOMER', 'Inbound Text Message', 'No. I will just keep looking. Thank you again.')
    + E(at(4, '3:09 PM'), 'AGENT', 'Outbound Text Message', 'Can I help you find something in particular?\nBy: Rep Name')
    + E(at(4, '3:08 PM'), 'CUSTOMER', 'Inbound Text Message', 'Thank you but I don’t think that will work.')
    + E(at(4, '2:22 PM'), 'AGENT', 'Outbound Text Message', 'Here is the listing link.\nBy: Rep Name')
    + E(at(4, '2:10 PM'), 'CUSTOMER', 'Inbound Text Message', 'What was the price again and mileage?')
    + E(at(4, '12:37 PM'), 'AGENT', 'Outbound Text Message', 'Test, the 2026 Kia Sportage LX is in stock today, and it has front-wheel drive. Is that the setup you’re looking for?\nBy: Rep Name')
    + MARK(at(13, '7:12 PM'));
  const dcl = fn('_lpTheyDeclined') || (() => null);   // absent before 874: every case reads as no decline
  const r = quiet(() => dcl({ history: THREAD() }));
  check('the 11/12 replies read as a decline: both sentences quoted, and we had already asked to help them find something else',
    () => r && [r.quote, r.askedHelp], ['Thank you but I don’t think that will work. / I will just keep looking.', true]);
  const g = go(base(THREAD()));
  check('the prompt says they passed on it: no pitch, no visit, no times; and asks nothing (we already asked)',
    () => [/THEY SAID THIS ONE DOES NOT WORK FOR THEM \([^)]*\): "Thank you but I don.t think that will work\. \/ I will just keep looking\."/.test(g.prompt), /We already asked whether we could help them find something else, and they said no: ask nothing\./.test(g.prompt)], [true, true]);
  check('...the visit decision holds the visit (level 3, the DECLINE) and the suggested times are gone',
    () => [/VISIT DECISION FOR THIS MESSAGE: no visit ask and no appointment times in this message -- the DECLINE \(this one does not work for them; they will keep looking\) owns this/.test(g.prompt), /SUGGESTED APPOINTMENT TIMES/.test(g.prompt)], [true, false]);
  check('...and no "DO NOT OFFER TO CLOSE THIS LEAD OUT" ban (a gracious step back is allowed)', () => /DO NOT OFFER TO CLOSE THIS LEAD OUT/.test(g.prompt), false);
  const rf = quiet(() => { sb.__L = g.d; run('lastScrapedData = globalThis.__L;'); return String(run('_lpBuildSmsRefinePrompt')('Test, I understand you are going to keep looking.\nAgent', 'Subject: x\n\nTest,\n\nThanks.\n\nAgent Name', g.d)); });
  check('the text rewrite is told too, above everything else, and loses the in-stock nudge and the close-out ban',
    () => [/THEY PASSED ON THIS VEHICLE — THIS OUTRANKS EVERYTHING BELOW/.test(rf), /no "there is still time today"/.test(rf), /THE VEHICLE IS IN STOCK/.test(rf), /DO NOT OFFER TO CLOSE THIS LEAD OUT/.test(rf)], [true, true, false, false]);
  check('control: "I\'ll keep looking at it and let you know" is not a decline', () => quiet(() => dcl({ history: E(at(1, '2:00 PM'), 'CUSTOMER', 'Inbound Text Message', 'I’ll keep looking at it and let you know this weekend.') + MARK(at(5, '9:00 AM')) })), null);
  check('control: they wrote again after the decline, asking something -> no decline', () => quiet(() => dcl({ history: THREAD(E(at(1, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', 'Actually, do you have one with lower miles?')) })), null);
  check('control: a decline 60 days ago -> no longer applies', () => quiet(() => dcl({ history: E(at(60, '3:13 PM'), 'CUSTOMER', 'Inbound Text Message', 'No. I will just keep looking. Thank you again.') + MARK(at(70, '9:00 AM')) })), null);
  check('a single "That won\'t work for me." with no help offered -> a decline that may ask one easy question',
    () => { const x = quiet(() => dcl({ history: E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', 'That won’t work for me.') + MARK(at(5, '9:00 AM')) })); return x && x.askedHelp; }, false);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (b) the opener:');
  check('the main prompt and the rewrite both say never a sentence built only to put the vehicle first',
    () => (src.match(/never a sentence built only to put the vehicle first \(\\?"the 2027 Sportage is what you are looking for\\?"/g) || []).length >= 2, true);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (c) SC-1 / ST-2: the scenario flags read the fields:');
  const cs = (ctx, x) => quiet(() => run('classifyScenario')(Object.assign({ context: ctx, leadSource: 'Dealer Website', convState: 'active-follow-up', vehicle: '2026 Kia Sportage LX' }, x || {})));
  const OUR = (t) => '[11/14/2026 10:00 AM] [AGENT] Outbound Text Message\n  ' + t + '\n';
  check('our own "Is your appointment already set with another store?" does not make it an appointment confirmation', () => cs(OUR('Is your appointment already set with another store?')).isApptConfirmation, false);
  check('...the Appointments grid does (hasApptSet)', () => cs('', { hasApptSet: true }).isApptConfirmation, true);
  check('our own "No worries if not today, tomorrow works too." is not NOT TODAY; our own NOT TODAY line is', () => [cs(OUR('No worries if not today, tomorrow works too.')).notToday,
    cs('🚫 NOT TODAY: Customer explicitly said they cannot or do not want to come in right now.').notToday], [false, true]);
  check('a note that says "Lead status changed to Sold/Delivered" is not a sale; the field is', () => [cs(OUR('Lead status changed to Sold/Delivered')).isSoldDelivered, cs('', { isSoldDelivered: true }).isSoldDelivered], [false, true]);
  check('"stalled lead, no response" in a note is not the stalled scenario; _isStalled is', () => [cs(OUR('stalled lead, no response')).isStalled, cs('', { _isStalled: true }).isStalled], [false, true]);
  check('"missed appointment follow up call" in a note is not a missed appointment; the scraper\'s reading is', () => [cs(OUR('missed appointment follow up call, left voicemail')).isMissedAppt, cs('', { hasMissedAppt: true }).isMissedAppt], [false, true]);
  check('exit and pause come from hasExitSignal / hasPauseSignal / convState', () => [cs(OUR('exit signal pause signal')).isExitSignal, cs('', { hasExitSignal: true }).isExitSignal, cs('', { convState: 'pause' }).isPauseSignal], [false, true, true]);
  check('"loyalty vehicle" in a note is not the loyalty scenario; our own LOYALTY VEHICLE line is', () => [cs(OUR('asked about the loyalty vehicle program')).isLoyaltyVehicle, cs('🔑 LOYALTY VEHICLE: "2021 Kia Sorento" is the customer\'s lease').isLoyaltyVehicle], [false, true]);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (d) SC-2 and SC-3 in the scraper:');
  const sc2 = (() => { const a = src.indexOf('    // (v9.7.874) AUDIT #2 SC-2'); const b = src.indexOf('    var keepingTrade = ', a); return a > 0 && b > a ? src.slice(a, b) : ''; })();
  const kt = (() => { const m = /    var keepingTrade = [^\n]*\n/.exec(src); return m ? m[0] : ''; })();
  const lift = (vars) => { const ctx = Object.assign({ _lpD() {}, smsOptOutIsExit: false }, vars); vm.createContext(ctx); vm.runInContext(sc2 + kt, ctx); return ctx; };
  check('start unknown (no Created, no marker): "bought elsewhere" is logged and does not exit', () => { const c = lift({ leadCreatedMs: 0, _lpMarkerMs: 0, exitRaw: true, boughtElsewhere: true, recentInbound: '', fullScanText: '' }); return [c.exitRaw, c.boughtElsewhere]; }, [false, false]);
  check('control: the start known -> the exit stands', () => { const c = lift({ leadCreatedMs: Date.now() - 5 * 86400000, _lpMarkerMs: 0, exitRaw: true, boughtElsewhere: false, recentInbound: '', fullScanText: '' }); return c.exitRaw; }, true);
  check('control: a STOP still exits with the start unknown', () => { const c = lift({ leadCreatedMs: 0, _lpMarkerMs: 0, exitRaw: true, smsOptOutIsExit: true, boughtElsewhere: false, recentInbound: '', fullScanText: '' }); return c.exitRaw; }, true);
  check('SC-3: our "you can just keep your truck" does not cancel their exit; their own "keep my truck" does', () => [lift({ leadCreatedMs: 1, recentInbound: 'we went with another dealer', fullScanText: 'we went with another dealer you can just keep your truck', exitRaw: false, boughtElsewhere: false }).keepingTrade,
    lift({ leadCreatedMs: 1, recentInbound: 'i will keep my truck for now', fullScanText: '', exitRaw: false, boughtElsewhere: false }).keepingTrade], [false, true]);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (e) ST-3 and (f) ST-1:');
  check('ST-3: convState "pause" -> hasPauseSignal true after populateFromData', () => go(base(THREAD(), { convState: 'pause' })).d.hasPauseSignal, true);
  const ms = Date.parse('2026-11-17T10:00:00-06:00');   // a Tuesday morning
  vm.runInContext('(function(){var R=Date;function D(){if(!arguments.length)return new R(' + ms + ');return new (Function.prototype.bind.apply(R,[null].concat([].slice.call(arguments))))();}D.now=function(){return ' + ms + '};D.UTC=R.UTC;D.parse=R.parse;D.prototype=R.prototype;Date=D;})()', sb);
  const cat = (st) => quiet(() => run('computeAppointmentTimes')(st, 'TEST003C'));
  check('ST-1: the slot engine closes each store where STORE_HOURS says (Kia Baytown 8 PM, Honda Lafayette 7 PM)', () => [cat('Community Kia Baytown').closeTime, cat('Community Honda Lafayette').closeTime], ['8:00 PM', '7:00 PM']);
  run('STORE_HOURS["6190"] = Object.assign({}, STORE_HOURS["6190"], { weekday: "9 AM - 6 PM" }); STORE_HOURS["99999"] = { name: "Test Motors", weekday: "10 AM - 5 PM", saturday: "10 AM - 5 PM", sunday: "CLOSED" };');
  check('...edit STORE_HOURS and the slots move: Kia closes at 6 PM, last same-day time 5 PM', () => { const a = cat('Community Kia Baytown'); return [a.closeTime, a.sameDayCutoff]; }, ['6:00 PM', '5:00 PM']);
  check('...and a store whose name has neither "audi" nor "lafayette" gets its own hours, not Baytown\'s', () => cat('Test Motors').closeTime, '5:00 PM');
  run('STORE_HOURS["6190"] = Object.assign({}, STORE_HOURS["6190"], { weekday: "9 AM - 8 PM" }); delete STORE_HOURS["99999"];');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
