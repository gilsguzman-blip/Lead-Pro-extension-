#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('addappt-video-885.test.js');
// (v9.7.885) ADD APPT ALWAYS GETS ITS TIMES, AND A TIME IS FOR A VISIT, NOT A VIDEO. Owner, 11/19, on the 11/18 export: "Appointment
// times should have been added, fix the video times issue." (1) Honda Lafayette, Capital One, 7:26 PM: Add Appt, and the text came back
// with no time while the email offered "If so, I can plan a visit for 11:00 AM or 1:00 PM Thursday, November 19 ..." -- not carried to the
// text because it was no question; and with no time in either format nothing added one. (2) Kia Baytown, 7:12 PM: the draft offered a
// walkaround video; Add Appt produced "Would a quick walkaround Thursday at 10:30 AM or 2:00 PM work?". Executes _lpChipTimesBoth on a
// fixed Central clock, _lpHouseGuard, and reads the Add Appt directive. Placeholder data only.
//
// Usage: node tests/addappt-video-885.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: addappt-video-885.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 18, 19, 26);   // Wednesday 7:26 PM Central, Honda Lafayette closed at 7
const SMS = 'Test, the Capital One start gives us a way to explore your options. Would a quick overview of the next steps be helpful?\nAgent\nCommunity Honda Lafayette';
const EM_OFFER = 'Subject: Next steps\n\nTest,\n\nWould a quick overview be helpful? If so, I can plan a visit for 11:00 AM or 1:00 PM Thursday, November 19, and have the next steps ready for you.\n\nAgent Name\nInternet Sales Coordinator';
const EM_NONE = 'Subject: Next steps\n\nTest,\n\nWould a quick overview be helpful?\n\nAgent Name\nInternet Sales Coordinator';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  sb.console.log = () => {};
  const run = (e) => vm.runInContext(e, sb);
  run('lastScrapedData = { autoLeadId: "TEST011L", store: "Community Honda Lafayette", dealerId: "24399", agent: "Agent Name" }; window._lpAddApptLeadId = "TEST011L"; window._activeLeadId = "TEST011L"; window._lpAddApptAt = Date.now(); window._lpLastVisitDecision = { level: 0 };');
  const ctb = (s, e) => { const r = run('_lpChipTimesBoth')(s, e, run('lastScrapedData')); return r ? [r.sms.split('\n')[0], r.email] : null; };

  console.log(' Add Appt: the times reach both formats:');
  check('the email\'s time offer written as a statement ("If so, I can plan a visit for 11:00 AM or 1:00 PM Thursday ...") is carried to the text',
    () => (ctb(SMS, EM_OFFER) || [''])[0].endsWith('If so, I can plan a visit for 11:00 AM or 1:00 PM Thursday, November 19, and have the next steps ready for you.'), true);
  const both = ctb(SMS, EM_NONE) || ['', ''];
  check('neither format has a time -> the engine\'s next-morning pair goes in the text ...', () => /Would \d{1,2}:\d{2} [AP]M or \d{1,2}:\d{2} [AP]M tomorrow \(Thursday, November 19\) work for you to come in\?$/.test(both[0]), true);
  check('... and in the email, ahead of the sign-off', () => /Would [^\n]*tomorrow \(Thursday, November 19\) work for you to come in\?\n\nAgent Name/.test(both[1]), true);
  run('window._lpLastVisitDecision = { level: 3 };');
  check('control: a hold the chip does not override (a pause, a decline, an exit) -> nothing added', () => ctb(SMS, EM_NONE), null);
  run('window._lpAddApptLeadId = "";');
  check('control: no Add Appt -> nothing added', () => ctb(SMS, EM_NONE), null);

  console.log(' a time is for a visit, not a video:');
  const g = (t) => run('_lpHouseGuard')(t, 'sms');
  run('lastScrapedData = { dealerId: "6190", store: "Community Kia Baytown" };');
  check('the Kia shape: "a quick walkaround Thursday at 10:30 AM or 2:00 PM" -> "a quick in-person walkaround"', () => g('Would a quick walkaround Thursday at 10:30 AM or 2:00 PM work?'), 'Would a quick in-person walkaround Thursday at 10:30 AM or 2:00 PM work?');
  check('"a walkaround video ... at 10:30 AM" -> "an in-person walkaround"', () => g('Would a walkaround video Thursday at 10:30 AM work?'), 'Would an in-person walkaround Thursday at 10:30 AM work?');
  check('control: a video offered with no time stays a video', () => g('I can send you a quick walkaround video of the Seltos. Would that be useful?'), 'I can send you a quick walkaround video of the Seltos. Would that be useful?');
  check('control: a live video walkaround by name stays one', () => g('We can do a live video walkaround at 3:00 PM if you prefer.'), 'We can do a live video walkaround at 3:00 PM if you prefer.');
  check('the Add Appt directive says the times are for a visit in person, never attached to a video', () => /The times are for a visit in person: if the draft offered a video, photos or a walkaround video, never attach the times to them/.test(require('fs').readFileSync(f, 'utf8')), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
