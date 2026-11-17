#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('past-time-879.test.js');
// (v9.7.879) A TIME BELONGS TO THE DAY NAMED NEXT TO IT. Honda Lafayette lead 2115020663 (11/16, 4:57 PM, Add Appt chip) shipped
// "Would 6:00 PM today or 9:15 AM Tuesday, November 17 tomorrow, November 17, work better?" in the text and the email: the past-time
// guard (v9.7.846) read tomorrow's 9:15 AM as a time today that had passed, and swapped in both engine slots as if both were today's
// (since v9.7.869 the late pair is one today time plus a next-morning time). Executes _lpPastTimeGuard and computeAppointmentTimes
// on a fixed Central clock. Placeholder data only.
//
// Usage: node tests/past-time-879.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: past-time-879.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// A Central wall-clock moment, built so the sandbox's Date (and toLocaleString in America/Chicago) reads it whatever TZ runs the suite.
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
function boxAt(f, ms) {
  const sb = loadPopup(f, { withAuth: true });
  vm.runInContext('(function(){ var RD = Date, FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  sb.console.log = () => {};
  vm.runInContext('lastScrapedData = { store: "Community Honda Lafayette", dealerId: "24399", autoLeadId: "TEST008H" };', sb);
  return (t) => vm.runInContext('_lpPastTimeGuard', sb)(t, 'sms');
}
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let late, morning;
  try { late = boxAt(f, CT(2026, 11, 16, 16, 57)); morning = boxAt(f, CT(2026, 11, 14, 9, 13)); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }

  console.log(' Monday 4:57 PM at Honda Lafayette (closes at 7; the engine has 6:00 PM today and a next-morning time):');
  check('lead 2115020663: "6:00 PM today or 9:15 AM tomorrow, November 17" is left as written (no "Tuesday, November 17 tomorrow")',
    () => late('Would 6:00 PM today or 9:15 AM tomorrow, November 17, work better?'), 'Would 6:00 PM today or 9:15 AM tomorrow, November 17, work better?');
  check('"9:15 AM tomorrow or 6:00 PM today" -> left as written (the days no longer swap)', () => late('Would 9:15 AM tomorrow or 6:00 PM today work?'), 'Would 9:15 AM tomorrow or 6:00 PM today work?');
  check('"today at 6 PM or tomorrow at 9:15 AM" (the day before the time) -> left as written', () => late('I can have it ready today at 6 PM or tomorrow at 9:15 AM.'), 'I can have it ready today at 6 PM or tomorrow at 9:15 AM.');
  check('"3:00 PM today or 10:00 AM tomorrow" -> only today\'s past time is replaced; tomorrow\'s stays', () => late('Would 3:00 PM today or 10:00 AM tomorrow work?'), 'Would 6:00 PM today or 10:00 AM tomorrow work?');
  check('"10 AM or 2 PM today", both past, one slot left today -> that one slot, never tomorrow\'s time called today', () => late('Would 10 AM or 2 PM today work?'), 'Would 6:00 PM today work?');
  console.log(' control -- the v9.7.846 case, Saturday 9:13 AM, two slots left today:');
  check('"9 AM or 10 AM today" -> the engine\'s two today times', () => morning('Would 9 AM or 10 AM today work?'), 'Would 10:15 AM or 11:00 AM today work?');
  check('a future time today is left alone', () => late('Would 6:00 PM today work?'), 'Would 6:00 PM today work?');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
