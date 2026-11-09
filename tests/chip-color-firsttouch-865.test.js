#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chip-color-firsttouch-865.test.js');
// (v9.7.865) OWNER-APPROVED 11/9 ("build 865, yes on i"), from the 11/6-11/7 reports and the grabs on 864 (logs 415-416):
//  (a) Add Appt: the same times in the text AND the email (lead 2111918199's email had none; lead 2108867424's text had none).
//  (b) The feed's abbreviations written out: "Civic Hatchback Hybr Sport", "Accord Sdn".
//  (c) The same question twice: "What vehicle are you looking for? ... What vehicle are you shopping for?" (lead 2112048694).
//  (d) The "not in your color" answer only when color is the live question: never on a pause (lead 2111367648), not after a visit
//      where they saw the numbers (lead 2112149909).
//  (e) Times with no day after hours get the next open day ("at 10:00 or 2:00" at 6:17 PM Saturday, lead 2112160613).
//  (f) An out-the-door ask we already answered ("27k drive out", "28k lowest") is not still owed (lead 2112149909).
//  (g) WE ASKED THEM FOR SOMETHING: "We need a letter from the registers office" -- ask whether they got it (lead 2112149909).
//  (h) The asked-about-color path gets the feed's answer: no black 2026 Accord SE, not "I'm checking" (lead 2112000019).
//  (i) A first touch with the car here and the customer close by gets two times, not a video offer (owner, 11/9).
// Executes the build's own functions (populateFromData, buildUserPrompt through the panel payload, the visit decision, the
// render guards, the out-the-door and document readers). Placeholder data.
//
// Usage: node tests/chip-color-firsttouch-865.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chip-color-firsttouch-865.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const U_ = (stock, vehicle, model, color, cond, year) => ({ stock, vin: '', vehicle, year, make: vehicle.split(' ')[1], model, condition: cond, certified: cond === 'cpo',
  class: 'Car', body: '4D Sedan', color, interior: 'Black', odometer: 10, daysOnLot: 30, price: 32000, stockNum: stock });

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const base = (brief, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Accord SE', condition: 'New',
    dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Honda Website -', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true,
    totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 },
    conversationBrief: brief, history: brief, context: '' }, x || {});
  const HB = '6191';
  setUnits(HB, [U_('TEST0A1', '2026 Honda Accord SE', 'Accord SE', 'Solar Silver Metallic', 'new', 2026), U_('TEST0A2', '2026 Honda Accord SE', 'Accord SE', 'Meteorite Gray Metallic', 'new', 2026),
    U_('TEST0A3', '2026 Honda Accord SE', 'Accord SE', 'Platinum White Pearl', 'new', 2026), U_('TEST0A4', '2026 Honda Accord SE', 'Accord SE', 'Canyon River Blue Metallic', 'cpo', 2026),
    U_('TEST0P1', '2026 Honda Pilot EX-L', 'Pilot EX-L', 'Lunar Silver Metallic', 'new', 2026)]);

  console.log(' (a) Add Appt: the same times in the text and the email:');
  const ctb = fn('_lpChipTimesBoth');
  const chipOn = (on) => run(on ? 'window._lpAddApptLeadId = "TEST001"; window._activeLeadId = "TEST001";' : 'window._lpAddApptLeadId = ""; window._activeLeadId = "";');
  const SMS_T = 'Test, the Civic Hybrid is here. Could you come in at 10 a.m. or 2 p.m?\nAgent\nCommunity Honda Lafayette\n(555) 010-0100';
  const EM_N = 'Subject: Your Civic\n\nHi Test,\n\nThe Civic Hybrid is here. What day would work for a visit?\n\nAgent Name\nInternet Sales Coordinator\nCommunity Honda Lafayette\n(555) 010-0100';
  chipOn(true);
  check('chip on, the text has the times and the email none -> the email gets the same asking sentence, before the signature',
    () => quiet(() => (ctb ? ctb(SMS_T, EM_N, { autoLeadId: 'TEST001', agent: 'Agent Name' }) : { email: 'no helper' }).email),
    'Subject: Your Civic\n\nHi Test,\n\nThe Civic Hybrid is here. What day would work for a visit?\n\nCould you come in at 10 a.m. or 2 p.m?\n\nAgent Name\nInternet Sales Coordinator\nCommunity Honda Lafayette\n(555) 010-0100');
  check('...and the other way round: the email\'s time question goes into the text, ahead of the signature',
    () => quiet(() => (ctb ? ctb('Test, would you like to set up a time to come in?\nAgent', 'Subject: x\n\nHi Test,\n\nWould 7:30 PM tonight or 9:30 AM tomorrow work?\n\nAgent Name', { autoLeadId: 'TEST001', agent: 'Agent Name' }) : { sms: 'no helper' }).sms),
    'Test, would you like to set up a time to come in? Would 7:30 PM tonight or 9:30 AM tomorrow work?\nAgent');
  check('control: both formats already have times -> left alone', () => quiet(() => ctb ? ctb(SMS_T, 'Subject: x\n\nWould 10 AM or 2 PM work?\n\nAgent Name', { autoLeadId: 'TEST001', agent: 'Agent Name' }) : 'no helper'), null);
  chipOn(false);
  check('control: chip off -> left alone', () => quiet(() => ctb ? ctb(SMS_T, EM_N, { autoLeadId: 'TEST001', agent: 'Agent Name' }) : 'no helper'), null);

  console.log(' (b)+(c) the render guard: feed abbreviations, and the same question twice:');
  run('lastScrapedData = { leadAgeDays: 0, convState: "first-touch" };');
  const hg = (t, ch) => quiet(() => { const h = fn('_lpHouseGuard'); return h ? h(t, ch || 'sms') : 'no helper'; });
  check('"2026 Honda Civic Hatchback Hybr Sport" -> "Hybrid"; "2013 Honda Accord Sdn" -> "Sedan"',
    () => hg('Test, the 2026 Honda Civic Hatchback Hybr Sport is here, and we can appraise your 2013 Honda Accord Sdn too. Would that help?\nAgent'),
    'Test, the 2026 Honda Civic Hatchback Hybrid Sport is here, and we can appraise your 2013 Honda Accord Sedan too. Would that help?\nAgent');
  check('"What vehicle are you looking for? ... What vehicle are you shopping for?" -> asked once',
    () => hg('Test, thanks for submitting your application through Click & Go. What vehicle are you looking for? Once I know, I can have the paperwork ready. What vehicle are you shopping for?\nAgent'),
    'Test, thanks for submitting your application through Click & Go. What vehicle are you looking for? Once I know, I can have the paperwork ready.\nAgent');
  check('control: "Hybrid" and a single vehicle question are untouched',
    () => hg('Test, the Civic Hybrid is here. What model are you shopping for?\nAgent'), 'Test, the Civic Hybrid is here. What model are you shopping for?\nAgent');

  console.log(' (e) times with no day, after the store has closed for the day:');
  const atClock = (iso, g) => { run('(function(){ var RD = globalThis.__RD = globalThis.__RD || Date, FIX = ' + new Date(iso).getTime() + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
    try { return g(); } finally { run('if (globalThis.__RD) Date = globalThis.__RD;'); } };
  const nd = (t) => quiet(() => { const h = fn('_lpPastTimeGuard'); return h ? h(t, 'sms') : 'no helper'; });
  run('lastScrapedData = { store: "Community Honda Lafayette" };');
  check('Saturday 6:17 PM: "ready for you to see at 10:00 or 2:00" -> "Monday at 10:00 or 2:00"',
    () => atClock('2026-11-08T00:17:00Z', () => nd('Test, I can also have it ready for you to see at 10:00 or 2:00. Which time works better?\nAgent')),
    'Test, I can also have it ready for you to see Monday at 10:00 or 2:00. Which time works better?\nAgent');
  check('control: a day already named ("Monday, November 9 at 9:15 AM") is left alone',
    () => atClock('2026-11-08T00:17:00Z', () => nd('Test, would 9:15 AM or 10:30 AM Monday, November 9 work?\nAgent')), 'Test, would 9:15 AM or 10:30 AM Monday, November 9 work?\nAgent');
  check('control: store hours ("we are open until 7:00 PM") are not an offer', () => atClock('2026-11-08T00:17:00Z', () => nd('Test, we are open until 7:00 PM most days.\nAgent')), 'Test, we are open until 7:00 PM most days.\nAgent');
  check('control: Saturday 10:00 AM with time left today -> left alone', () => atClock('2026-11-07T16:00:00Z', () => nd('Test, would 2:00 or 3:30 work?\nAgent')), 'Test, would 2:00 or 3:30 work?\nAgent');

  console.log(' (f)+(g) an out-the-door ask we answered; something we asked them for:');
  const otd = fn('_lpOtdAsk'), owd = fn('_lpOwedDocument');
  const THREAD = (after) => (after || '') + E(at(2, '5:11 PM'), 'AGENT', 'Outbound Text Message', 'We need a letter from the registers office that states your graduation date.')
    + E(at(2, '5:02 PM'), 'CUSTOMER', 'Inbound Text Message', 'What do I need to get the graduate discount?')
    + E(at(2, '5:01 PM'), 'AGENT', 'Outbound Text Message', 'The HRV in stock today would be 28k lowest price with financing through Honda.')
    + E(at(2, '4:59 PM'), 'CUSTOMER', 'Inbound Text Message', 'OTD') + MARK(at(3, '10:00 AM'));
  const ld = (brief) => ({ history: brief, context: brief, relationshipSignals: { lastInboundAgeDays: 2 } });
  check('"OTD", then our "28k lowest price" a minute later -> the ask is answered (no drive-out follow-up owed)', () => quiet(() => otd ? otd(ld(THREAD())) : 'no helper'), null);
  check('control: "OTD" with no answer since -> still asked', () => quiet(() => { const r = otd ? otd(ld(E(at(1, '4:59 PM'), 'CUSTOMER', 'Inbound Text Message', 'What is the OTD?') + MARK(at(2, '9:00 AM')))) : null; return !!(r && r.how === 'message'); }), true);
  check('"We need a letter from the registers office..." with nothing since -> owed, quoted', () => quiet(() => (owd ? owd(ld(THREAD())) : {}) || {}).quote, 'We need a letter from the registers office that states your graduation date.');
  check('control: they wrote back with the letter attached -> nothing owed',
    () => quiet(() => owd ? owd(ld(THREAD(E(at(1, '9:00 AM'), 'CUSTOMER', 'Email reply from prospect - Has attachment', 'Here is my letter from the registrar')))) : 'no helper'), null);
  check('control: "I can send you the secure credit application" is our offer, not something we asked for',
    () => quiet(() => owd ? owd(ld(E(at(1, '9:00 AM'), 'AGENT', 'Outbound Text Message', 'Test, I can send you the secure credit application so your financing is ready.') + MARK(at(2, '9:00 AM')))) : 'no helper'), null);
  const g1 = go(base(THREAD(), { vehicle: '2026 Honda HR-V', isShowroomFollowUp: true, lastInboundMsg: 'Stop' }));
  check('...and the prompt carries WE ASKED THEM FOR SOMETHING, never "I am putting together your numbers"',
    () => [/^WE ASKED THEM FOR SOMETHING THAT MOVES THEIR DEAL: on \d\d\/\d\d our message said "We need a letter from the registers office/m.test(g1.prompt), /Do not invent a step of ours instead/.test(g1.prompt)], [true, true]);

  console.log(' (d)+(h) the color answer, from the feed, when color is the live question:');
  const blk = (x) => go(base(E(at(1, '9:09 AM'), 'CUSTOMER', 'Inbound Text Message', 'can you provide the vin number and pictures of the 2026 black honda accord sedan SE') + MARK(at(3, '8:14 AM')),
    Object.assign({ stockNum: 'TEST0A1', _pdUnitStock: 'TEST0A1', _pdStatus: 'A', color: 'Solar Silver Metallic', customerStatedColor: 'Black', lastInboundMsg: 'Ok please cancel my appt, thank you' }, x || {})));
  const g2 = blk();
  check('asked for black, the unit on the lead is Solar Silver, no black SE in the feed -> "we don\'t have one in black", the new SEs in other colors',
    () => (g2.prompt.match(/^NO BLACK ONE IN STOCK IN THAT TRIM: [^\n]*/m) || [''])[0].replace(/ This outranks.*/, ''),
    'NO BLACK ONE IN STOCK IN THAT TRIM: today\'s inventory has been checked. Say so plainly, once ("we don\'t have one in black right now") -- never "I\'m checking" or "I\'ll confirm". The same trim in the colors we do have: 2026 in Meteorite Gray Metallic; 2026 in Platinum White Pearl. You may name two or three and ask whether one of those works, and offer to keep watch for a black one.');
  check('control: a black SE in the feed -> no "none in black" line', () => { setUnits(HB, [U_('TEST0A1', '2026 Honda Accord SE', 'Accord SE', 'Solar Silver Metallic', 'new', 2026), U_('TEST0A5', '2026 Honda Accord SE', 'Accord SE', 'Crystal Black Pearl', 'new', 2026)]);
    const r = /NO BLACK ONE IN STOCK/.test(blk().prompt);
    setUnits(HB, [U_('TEST0A1', '2026 Honda Accord SE', 'Accord SE', 'Solar Silver Metallic', 'new', 2026), U_('TEST0A2', '2026 Honda Accord SE', 'Accord SE', 'Meteorite Gray Metallic', 'new', 2026),
      U_('TEST0A3', '2026 Honda Accord SE', 'Accord SE', 'Platinum White Pearl', 'new', 2026), U_('TEST0P1', '2026 Honda Pilot EX-L', 'Pilot EX-L', 'Lunar Silver Metallic', 'new', 2026)]); return r; }, false);
  const SAID_P = 'I am looking for a gray Pilot EX-L, I will get back to you after I gather my trade info';
  const pil = (x) => go(base(E(at(0, '1:50 PM'), 'CUSTOMER', 'Inbound Text Message', SAID_P) + MARK(at(0, '1:00 PM')),
    Object.assign({ vehicle: '2026 Honda Pilot EX-L', stockNum: 'TEST0P1', _pdUnitStock: 'TEST0P1', _pdStatus: 'A', color: 'Lunar Silver Metallic', customerStatedColor: 'Gray', leadSource: 'Truecar/Truecar',
      lastInboundMsg: SAID_P }, x || {})));
  check('a paused customer who once asked for gray -> the color is background ("do not bring it up"), not "say so plainly"',
    () => { const p = pil({ convState: 'pause' }).prompt; return [/COLOR \(background only -- do not bring it up in this message\): they asked for gray earlier/.test(p), /NO GRAY ONE IN STOCK/.test(p)]; }, [true, false]);
  check('control: the same lead not paused -> "NO GRAY ONE IN STOCK ... say so plainly"', () => /COLOR MISMATCH — NO GRAY ONE IN STOCK/.test(pil({ convState: 'active-follow-up' }).prompt), true);
  check('control: paused, but their newest message asks about the color -> it is the live question again',
    () => /COLOR MISMATCH — NO GRAY ONE IN STOCK/.test(pil({ convState: 'pause', lastInboundMsg: 'Do you have it in gray?' }).prompt), true);

  console.log(' (i) a first touch with the car here and the customer close by:');
  const BOT = 'By: Assistant Name Virtual Assistant Community Honda Hi Test, thanks for your interest! Would you be able to come in for a test drive?';
  // ZIPs from the build's own tables, none written here: one in the store's local set, one whose area is more than 75 miles out.
  const LOCAL_ZIP = run('Array.from(DEALER_LOCAL_ZIPS["6191"])[0]') || '';
  const FAR_ZIP = (run('Object.keys(ZIP3_CENTROIDS).filter(function (z) { return (_customerDistanceMiles("6191", z + "01") || 0) > LP_VISIT_RADIUS_MILES; })[0]') || '') + '01';
  const ft = (x) => go(base(E(at(0, '8:15 AM'), 'AGENT', 'Outbound Text Message', BOT) + MARK(at(0, '8:14 AM')),
    Object.assign({ convState: 'first-touch', leadAgeDays: 0, hasCustomerReply: false, stockNum: 'TEST0A2', _pdUnitStock: 'TEST0A2', _pdStatus: 'A', color: 'Meteorite Gray Metallic',
      outboundSends: [{ body: BOT, date: at(0, '8:15 AM') }], customerZip: LOCAL_ZIP, customerState: 'TX' }, x || {})));
  const g3 = ft();
  check('bot-only outreach, the car confirmed here, a ZIP in the store\'s local set -> "close with two specific appointment times", no light-ask hold',
    () => [/VISIT DECISION FOR THIS MESSAGE: this is the first message from a person, the car is here and they are close by -- close with two specific appointment times/.test(g3.prompt),
      /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(g3.prompt)], [true, false]);
  check('control: a customer more than 75 miles out keeps the light ask', () => /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(ft({ customerZip: FAR_ZIP }).prompt), true);
  check('control: no stock number on the lead (nothing confirmed here) keeps the light ask', () => /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(ft({ stockNum: '', _pdUnitStock: '' }).prompt), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
