#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('arrival-time-795.test.js');
// (v9.7.795) Two leads on 10/13, one bug under both, and a second one beside it.
//   Toyota Baytown lead 2099028967 (log316), submitted that day: "Give me about 45 minutes" -- a text from 02/19/2026, on a
//   closed lead -- became "Customer gets off at 45 PM ... arrive around 45:30 PM ... Evening only", and the text offered
//   6:45 or 7:15 this evening. The arrival scan's bare "out" matched inside "about", and the scan read notes from before
//   the current lead.
//   Honda Lafayette lead 2077008076 (log315): "I would love to come about 1:30" (9/29) became "1:30 PM today", offered at
//   1:44 PM -- the arrival-adjusted slots never checked the clock.
//   And on 2099028967 the text rewrite was told "THE APPOINTMENT ON THIS LEAD WAS MISSED ... as the first draft did ('sorry
//   we missed you Saturday')": the miss was 236 days old and from the closed lead, but the rewrite's check had no lead age
//   (the raw scrape carries none) and fell through; the first draft said nothing of the kind, and the text shipped "[customer],
//   sorry we missed you Saturday."
// Executes the shipped scheduling loop (lifted, as sched-attribution does), populateFromData, buildUserPrompt with the
// clock frozen, and _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/arrival-time-795.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: arrival-time-795.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = n => String(n).padStart(2, '0');
const D = (daysAgo, h, m) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(h || 13, m || 0, 0, 0);
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };

function loop(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n); return i; };
  const sa = at('    function _lpCustomerAuthoredPart(raw) {'), sb = src.indexOf('\n    function ', sa + 10);
  const body = src.slice(at('    var customerSaidNotToday = false;'), at('    // Detect when customer has explicitly declined an alternative the agent offered.'));
  return (notes, markerDaysAgo) => {
    const els = notes.map(n => ({ getAttribute: () => 'inbound', querySelector: sel => /title/.test(sel) ? { innerText: 'Inbound Text Message' }
      : /content/.test(sel) ? { innerText: 'Received from: (555) 010-0199\n' + n.text } : /date/.test(sel) ? { innerText: n.date } : null }));
    const box = { Date, Math, String, Number, JSON, RegExp, Array, Object, noteEls: els, _lpD: () => {},
      _lpMarkerMs: markerDaysAgo === undefined ? 0 : Date.now() - markerDaysAgo * 86400000 };
    vm.createContext(box); vm.runInContext(src.slice(sa, sb), box); vm.runInContext(body, box);
    const c = vm.runInContext('customerScheduleConstraint', box);
    return (c.match(/around (\d{1,2}(?::\d{2})?)/) || [, c ? c.slice(0, 30) : ''])[1];
  };
}
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Toyota RAV4', condition: 'New', dealerId: '6189',
  store: 'Community Toyota Baytown', leadSource: 'Dealer Website', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, totalNoteCount: 3,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] }, history: '', context: '' }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, run1; try { sb = loadPopup(f, { withAuth: true }); run1 = loop(f); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the arrival-time scan reads whole words and real times:');
  check('lead 2099028967: "Give me about 45 minutes" is not an arrival time ("out" inside "about")', () => run1([{ text: 'Ok I will come. Give me about 45 minutes', date: D(0) }], 0), '');
  check('lead 2077008076: "I would love to come about 1:30" is not one either', () => run1([{ text: 'I would love to come about 1:30 that\'s fine', date: D(0) }], 0), '');
  check('control: "I get off at 5" still is', () => run1([{ text: 'I get off at 5 so after that works', date: D(0) }], 0), '5');
  check('control: "I\'m out at 6:30" and "done by 4" still are', () => [run1([{ text: 'I\'m out at 6:30 today', date: D(0) }], 0), run1([{ text: 'I should be done by 4', date: D(0) }], 0)], ['6:30', '4']);
  check('(new helper) "I can come by at 5" counts today, not from two weeks ago (a time for one visit)', () =>
    [run1([{ text: 'I can come by at 5', date: D(0) }], 20), run1([{ text: 'I can come by at 5', date: D(14) }], 20)], ['5', '']);

  console.log(' 2. a closed lead\'s messages are not this lead\'s schedule:');
  check('"I get off at 5" from eight months ago, on a lead submitted today -> skipped', () => run1([{ text: 'I get off at 5', date: D(236) }], 0), '');
  check('control: the same message one day before the lead was opened is kept (a conversation the lead began inside)', () => run1([{ text: 'I get off at 5', date: D(1) }], 0), '5');

  console.log(' 3. the constraint\'s wording is a real time, and "evening only" only for an evening time:');
  const ctxOf = (c) => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); quiet(() => sb.populateFromData(LEAD({ customerScheduleConstraint: c }))); return run('leadContext'); };
  const c1 = ctxOf('CUSTOMER ARRIVAL TIME: Customer said they arrive/get off around 1:30 . Offer appointment times AFTER this time - not before.');
  check('"around 1:30" -> free from 1:30 PM, arrive around 2:00 PM, and no "Evening only" (was "13:30 PM")', () =>
    [/Customer is free from about 1:30 PM and needs ~30 min to get here\. They will arrive around 2:00 PM\./.test(c1), /Evening only/.test(c1), /13:30/.test(c1)], [true, false, false]);
  const c2 = ctxOf('CUSTOMER ARRIVAL TIME: Customer said they arrive/get off around 6 . Offer appointment times AFTER this time - not before.');
  check('control (new wording): "around 6" -> 6:00 PM, arrive 6:30 PM, evening only', () =>
    [/free from about 6:00 PM[^\n]*arrive around 6:30 PM/.test(c2), /Evening only/.test(c2)], [true, true]);

  console.log(' 4. today\'s arrival-adjusted times are never in the past:');
  const frozen = (h, m) => run('(function(){ var RD = Date; var FIX = new RD(2026, 9, 13, ' + h + ', ' + m + ').getTime();'
    + ' function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); }'
    + ' FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; var prev = Date; Date = FD; return function(){ Date = prev; }; })()');
  const slots = (h, m, around) => { const restore = frozen(h, m);
    try { const p = quiet(() => sb.__lp.buildUserPrompt(LEAD({ customerScheduleConstraint: 'CUSTOMER ARRIVAL TIME: Customer said they arrive/get off around ' + around + ' . Offer appointment times AFTER this time - not before.' })));
      return (p.match(/ADJUSTED FOR CUSTOMER ARRIVAL TIME \(use exactly\):\nFirst option: ([^\n]*)\nSecond option: ([^\n]*)/) || [, 'none', 'none']).slice(1, 3); } finally { restore(); } };
  check('lead 2077008076: "around 1:30" at 1:44 PM -> 2:30 and 3:00 PM today, not 1:30', () => slots(13, 44, '1:30'), ['2:30 PM today', '3:00 PM today']);
  check('control: "around 5" at 1:44 PM -> 5:30 and 6:00 PM today, unchanged', () => slots(13, 44, '5'), ['5:30 PM today', '6:00 PM today']);

  console.log(' 5. the text rewrite does not invent a missed appointment:');
  const RW = (pass1, x) => quiet(() => run('_lpBuildSmsRefinePrompt')(pass1, 'email text', Object.assign(LEAD({ hasMissedAppt: true, freshestApptEventDays: 236,
    relationshipSignals: { unansweredQuestions: [], leadAgeDaysForFatigue: 0.01 } }), x || {})));
  const P_NEW = 'Test, the 2026 RAV4 you asked about is confirmed and on its way. Would 4:15 or 5:00 today work?\nAgent\nTest Store\n(555) 010-0100';
  const r1 = RW(P_NEW, { leadAgeDays: undefined });
  check('lead 2099028967: a 236-day-old miss, a lead submitted today, the raw scrape (no leadAgeDays) -> no MISSED section, no "Saturday"', () =>
    [/THE APPOINTMENT ON THIS LEAD WAS MISSED/.test(r1), /Saturday/.test(r1)], [false, false]);
  check('a miss on this lead, but a first draft that never mentions it -> no MISSED section (nothing to keep)', () =>
    /THE APPOINTMENT ON THIS LEAD WAS MISSED/.test(RW(P_NEW, { freshestApptEventDays: 1, leadAgeDays: 5 })), false);
  check('control (v9.7.778; new wording): a miss on this lead and a first draft that acknowledges it -> kept, in its own words', () =>
    /THE APPOINTMENT ON THIS LEAD WAS MISSED ━━━\nThe first draft acknowledges it\. Keep that acknowledgement, in the first draft's own words/.test(
      RW('Test, sorry we missed you yesterday. Would you still like to come in?\nAgent\nTest Store\n(555) 010-0100', { freshestApptEventDays: 1, leadAgeDays: 5 })), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
