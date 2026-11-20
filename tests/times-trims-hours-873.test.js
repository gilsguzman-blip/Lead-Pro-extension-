#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('times-trims-hours-873.test.js');
// (v9.7.873) OWNER-APPROVED 11/14 ("Yes add times as suggested. Build the rest as observed"), from the 11/12-11/14 reports:
//  (a) "Unspecified" is not a trim: "We don't have the unspecified version in stock today" with 2027 CR-Vs on the lot (lead 2115358822).
//  (b) hours nobody asked about: "come by today during our open hours, 9 AM to 8 PM" (lead 2115214107); "We have until 8:00 PM tonight,
//      and I can help you find the right Kia" (lead 2115023973).
//  (c) Add Appt's times are the engine's: "Would 9 AM or 8 PM work for you?" (lead 2115214107) -- a first touch withheld the suggested
//      times and the chip asked for two anyway. The times are printed when the chip is on; a closing-hour pair becomes the engine's.
//  (d) the name they go by, when the email greets them by it: "<record name>, <name>, the gray Passport" (lead 2114139435).
//  (e) a first touch with no specific car gets two times (owner, 11/14); a unit named but not confirmed, an AI Buying Signals lead and
//      a special-trip customer keep their own rules.
// Executes the build's own functions (populateFromData, buildUserPrompt through the panel payload, _lpTrimOf, _lpWhatWeHave,
// _lpHouseGuard, _lpPastTimeGuard, the SMS opener block). Placeholder data only.
//
// Usage: node tests/times-trims-hours-873.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: times-trims-hours-873.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const BOT = 'By: Assistant Name Virtual Assistant Community Honda Hi Test, thanks for your interest! Would you be able to come in for a test drive?';   // the 865 suite's bot-authored shape
const U = (vehicle, color, cond) => { const p = vehicle.split(' '); return { stock: 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase(), vin: '', vehicle, year: +p[0], make: p[1], model: p.slice(2).join(' '),
  condition: cond || 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color: color || 'Solar Silver Metallic', interior: 'Black', odometer: 10, daysOnLot: 9, price: 36000 }; };
// a fixed clock in the build's sandbox: Saturday 11/14/2026 at the given Central time
const FIX = (sb, iso) => { const ms = Date.parse(iso); vm.runInContext('(function(){var R=Date;function D(){if(!arguments.length)return new R(' + ms + ');return new (Function.prototype.bind.apply(R,[null].concat([].slice.call(arguments))))();}'
  + 'D.now=function(){return ' + ms + '};D.UTC=R.UTC;D.parse=R.parse;D.prototype=R.prototype;Date=D;})()', sb); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, fetchedAt: Date.now(), invSettledAt: Date.now() };'); };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = window._lpAddApptLeadId || "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd);
      const ctx = String(run('leadContext') || ''); return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const base = (brief, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda CR-V', condition: 'New',
    dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false,
    totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 },
    conversationBrief: brief, history: brief, context: '', autoLeadId: 'TEST001A', stockNum: '', vin: '' }, x || {});
  const THREAD = E(at(0, '9:05 AM'), 'AGENT', 'Outbound Text Message', BOT) + MARK(at(0, '9:04 AM'));
  setUnits('24399', [U('2027 Honda CR-V LX'), U('2027 Honda CR-V EX-L', 'Crystal Black Pearl'), U('2027 Honda CR-V Hybrid Sport', 'Platinum White Pearl')]);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (a) "Unspecified" is not a trim:');
  const T = fn('_lpTrimOf');
  check('Unspecified / Unknown / Not Specified / TBD read as no trim; a trim that is only Any, Other or N/A too',
    () => ['2027 Honda CR-V Unspecified', '2027 Honda CR-V Unknown', '2027 Honda CR-V Not Specified', '2027 Honda CR-V TBD', '2027 Honda CR-V Any', '2027 Honda CR-V Other', '2027 Honda CR-V N/A'].map(v => T(v).norm), ['', '', '', '', '', '', '']);
  check('control: real trims are untouched (EX-L, Hybrid Sport, Base)', () => ['2027 Honda CR-V EX-L', '2027 Honda CR-V Hybrid Sport', '2026 Honda Prelude Base'].map(v => T(v).disp), ['EX-L', 'Hybrid Sport', 'Base']);
  const gU = go(base(THREAD, { vehicle: '2027 Honda CR-V Unspecified (New)' }));
  check('the lead\'s vehicle loses the placeholder before anything reads it ("2027 Honda CR-V Unspecified (New)" -> "2027 Honda CR-V (New)")', () => gU.d.vehicle, '2027 Honda CR-V (New)');
  check('...and the prompt never says "Unspecified" or that the version is not in stock', () => [/unspecified/i.test(gU.prompt), /NONE in stock today/.test(gU.prompt)], [false, false]);
  check('control: the 872 inventory answer still names a trim the lead does carry ("2027 Honda CR-V EX-L" -> IN STOCK)',
    () => /IN STOCK -- 2027 CR-V EX-L/.test(go(base(THREAD, { vehicle: '2027 Honda CR-V EX-L' })).prompt), true);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (b) hours nobody asked about:');
  const hg = (t, x) => quiet(() => { sb.__L = Object.assign({ lastInboundMsg: '' }, x || {}); run('lastScrapedData = globalThis.__L;'); return run('_lpHouseGuard')(t, 'email'); });
  check('"You\'re welcome to come by today during our open hours, 9 AM to 8 PM." goes; the next sentence stays',
    () => hg('Your application gives us a starting point. You’re welcome to come by today during our open hours, 9 AM to 8 PM. Let me know if you’d like to stop in.'),
    'Your application gives us a starting point. Let me know if you’d like to stop in.');
  check('"We have until 8:00 PM tonight, and I can help you find the right Kia..." -> "I can help you find the right Kia..."',
    () => hg('We have until 8:00 PM tonight, and I can help you find the right Kia and have everything ready for you to see. What vehicle are you shopping for?'),
    'I can help you find the right Kia and have everything ready for you to see. What vehicle are you shopping for?');
  check('a sentence that is only "We\'re here until 8 PM tonight." goes', () => hg('Thanks for reaching out. We’re here until 8 PM tonight. What are you shopping for?'), 'Thanks for reaching out. What are you shopping for?');
  check('control: they asked about the hours -> the hours stay', () => hg('We have until 8:00 PM tonight, and I can help you find the right Kia.', { lastInboundMsg: 'what time do you close tonight?' }), 'We have until 8:00 PM tonight, and I can help you find the right Kia.');
  check('control: "we have until Friday to lock in the offer" (no clock time) stays', () => hg('We have until Friday to lock in the offer, and I can hold the details for you.'), 'We have until Friday to lock in the offer, and I can hold the details for you.');

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (c) Add Appt\'s times are the engine\'s:');
  FIX(sb, '2026-11-14T08:20:00-06:00');   // Saturday 8:20 AM -- the 11/14 incident, before the store opens
  const TOY = (x) => base(E(at(0, '8:05 AM'), 'AGENT', 'Outbound Text Message', BOT.replace('Honda Lafayette', 'Toyota Baytown')) + MARK(at(0, '8:04 AM')),
    Object.assign({ vehicle: '', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Gubagoo Virtual Retailing', autoLeadId: 'TEST002B' }, x || {}));
  setUnits('6189', [U('2026 Toyota Camry LE'), U('2026 Toyota RAV4 XLE Premium')]);
  run('window._lpAddApptLeadId = "TEST002B"; window._activeLeadId = "TEST002B"; window._lpAddApptAt = Date.now();');
  // the 11/14 shape: a bot-only first touch whose first-touch hold withholds the times (here a unit named on the lead that is not on
  // the lot, which keeps the light ask in 9.7.873 too), and the agent presses Add Appt
  const gC0 = (run('window._lpAddApptLeadId = "";'), go(TOY({ stockNum: 'TESTZZ9', outboundSends: [{ body: BOT, date: at(0, '8:05 AM') }] })));
  run('window._lpAddApptLeadId = "TEST002B"; window._lpAddApptAt = Date.now();');
  const gC = go(TOY({ stockNum: 'TESTZZ9', outboundSends: [{ body: BOT, date: at(0, '8:05 AM') }] }));
  check('control: the same lead without the chip -> the first-touch hold withholds the times', () => [/FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(gC0.prompt), /APPOINTMENT TIMES WITHHELD ON THIS LEAD/.test(gC0.prompt)], [true, true]);
  check('...with Add Appt on -> the SUGGESTED APPOINTMENT TIMES are in the prompt and nothing says they are withheld',
    () => [/SUGGESTED APPOINTMENT TIMES/.test(gC.prompt), /APPOINTMENT TIMES WITHHELD ON THIS LEAD/.test(gC.prompt)], [true, false]);
  check('...and the decision line says the two times come from them, never the store\'s opening or closing hour',
    () => /close with two specific appointment times inside store hours \([^)]*\), taken from the SUGGESTED APPOINTMENT TIMES in this prompt -- never times of your own, never the store's opening or closing hour/.test(gC.prompt), true);
  check('the Add Appt directive says the same', () => /'add-appt':\s+'Ask for the appointment:[^\n]*The times are the SUGGESTED APPOINTMENT TIMES in this prompt: never a time of your own, and never the store\\'s opening or closing hour\./.test(src), true);
  run('window._lpAddApptLeadId = "";');
  const ptg = (t) => quiet(() => { sb.__L = { store: 'Community Toyota Baytown', autoLeadId: 'TEST002B' }; run('lastScrapedData = globalThis.__L;'); return run('_lpPastTimeGuard')(t, 'sms'); });
  const eng = quiet(() => run('computeAppointmentTimes')('Community Toyota Baytown', 'TEST002B'));
  check('"Would 9 AM or 8 PM work for you?" (8 PM is the closing hour) -> the engine\'s two times',
    () => ptg('What kind of vehicle are you shopping for? Would 9 AM or 8 PM work for you?'),
    'What kind of vehicle are you shopping for? Would ' + String(eng.time1).replace(/\s*today$/, '') + ' or ' + String(eng.time2).replace(/\s*today$/, '') + ' work for you?');
  check('control: a pair without the closing hour is untouched ("10:15 AM or 11:00 AM")', () => ptg('Would 10:15 AM or 11:00 AM work for you?'), 'Would 10:15 AM or 11:00 AM work for you?');
  check('control: another day named in the sentence is left alone ("Monday at 10:00 AM or 8:00 PM")', () => ptg('Would Monday at 10:00 AM or 8:00 PM work?'), 'Would Monday at 10:00 AM or 8:00 PM work?');

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (d) the name they go by, when the email greets them by it:');
  const a = src.indexOf('    // Light-touch SMS opener check'), b = src.indexOf('\n    })();', a);
  const guard = src.slice(a, b + '\n    })();'.length);
  const op = (sms, lsd, email) => { const s2 = { String, RegExp, rawSms: sms, rawEmail: email, lastScrapedData: lsd, console: { log() {} } }; vm.createContext(s2); vm.runInContext(guard, s2); return s2.rawSms; };
  const DR = 'Ricky, the gray Passport TrailSport is here and certified. Would a video walkaround help?';
  check('the text opens on the name the email greets them by ("Hi Ricky,") -> untouched, not "<record name>, ricky, ..."',
    () => op(DR, { name: 'Richard Testbuyer', conversationBrief: '' }, 'Subject: Gray Passport\n\nHi Ricky,\n\nThe gray one is here.'), DR);
  check('control: an email that greets them by another name -> the record name is prepended, as before',
    () => op(DR, { name: 'Richard Testbuyer', conversationBrief: '' }, 'Subject: Gray Passport\n\nHi Richard,\n\nThe gray one is here.').startsWith('Richard, ricky,'), true);
  check('control: the name only in the lead\'s own inquiry text is their name too', () => op(DR, { name: 'Richard Testbuyer', conversationBrief: '', lastInboundMsg: 'Is the Passport still there? - Ricky' }, ''), DR);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (e) a first touch with no specific car gets two times (owner, 11/14):');
  FIX(sb, '2026-11-13T10:30:00-06:00');   // a Friday morning
  const LOCAL = run('Array.from(DEALER_LOCAL_ZIPS["24399"])[0]') || '';
  const FAR = (run('Object.keys(ZIP3_CENTROIDS).filter(function (z) { return (_customerDistanceMiles("24399", z + "01") || 0) > LP_VISIT_RADIUS_MILES; })[0]') || '') + '01';
  const FT = (x) => base(THREAD, Object.assign({ outboundSends: [{ body: BOT, date: at(0, '9:05 AM') }], customerZip: LOCAL, customerState: 'LA' }, x || {}));
  const gN = go(FT());
  // (v9.7.889) owner, 11/20: the first reach-out makes no visit ask -- the two times below were 9.7.873's and are inverted
  check('first touch, model only (no stock, no VIN) -> no two times since v9.7.889: the FIRST REACH-OUT owns the visit, no slot block', () => [/close with two specific appointment times/.test(gN.prompt),
    /VISIT DECISION FOR THIS MESSAGE: no visit ask and no appointment times in this message -- the FIRST REACH-OUT/.test(gN.prompt), /SUGGESTED APPOINTMENT TIMES/.test(gN.prompt)], [false, true, false]);
  check('control: an AI Buying Signals lead with no car keeps its own rule (no two times)', () => /the lead names no specific car/.test(go(FT({ leadSource: 'AI Buying Signals - Not Previously Sold' })).prompt), false);
  check('control: a customer more than 75 miles out keeps the light ask', () => /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(go(FT({ customerZip: FAR, customerState: 'TX' })).prompt), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
