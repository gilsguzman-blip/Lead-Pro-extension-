#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('holidays-894.test.js');
// The agents' machines run on Central time, and the appointment engine's next-day label converts to Central from the machine clock (a
// second conversion on a machine set elsewhere -- older behavior, out of scope here). The suite runs on the agents' clock.
process.env.TZ = 'America/Chicago';
// (v9.7.894) STORE HOLIDAYS: EVERY STORE IS CLOSED. Owner, 11/25: "the first message was pushing for an appointment tomorrow, Thanksgiving.
// We're closed at all stores. While we're at it we need to add the logic for all major holidays. Christmas, New Years Day being closed."
// Audi Lafayette lead 3121946430 (Wednesday 11/25): the calendar read "TOMORROW = Thursday 11/26" as an open day; the agent changed the
// times to today and Friday by hand. Executes _lpHolidayName, computeAppointmentTimes and _lpHouseGuard on fixed Central clocks, and
// buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/holidays-894.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: holidays-894.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const H = (h) => '[11/25/2026 10:05 AM] [CUSTOMER] Inbound Text Message\n  Do you have any SQ7s?\n[11/25/2026 9:30 AM] [AGENT] Outbound Text Message\n  Test, thanks for reaching out. Are you looking at the SQ7?\n[11/25/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Audi SQ7', condition: 'New', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Dealer.com',
  convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', customerZip: '12345',
  relationshipSignals: { unansweredQuestions: [] }, conversationBrief: H(), history: H(), context: '', autoLeadId: 'TEST017S', outboundSends: [] };
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const at = (ms) => { const sb = loadPopup(f, { withAuth: true }); sb.console.log = () => {}; sb.console.warn = () => {};
    vm.runInContext('(function(){ var RD = Date, FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb); return sb; };
  const sb0 = at(CT(2026, 11, 25, 10, 25));
  const hol = (y, m, d) => { try { return vm.runInContext('_lpHolidayName', sb0)(new (vm.runInContext('Date', sb0))(y, m - 1, d, 12, 0)); } catch (e) { return 'missing'; } };

  console.log(' the holidays:');
  check('Thanksgiving is the fourth Thursday of November (2026, 2027, 2028); Christmas Day; New Year\'s Day', () => [hol(2026, 11, 26), hol(2027, 11, 25), hol(2028, 11, 23), hol(2026, 12, 25), hol(2027, 1, 1)], ['Thanksgiving Day', 'Thanksgiving Day', 'Thanksgiving Day', 'Christmas Day', 'New Year’s Day']);
  check('control: the Thursday after Thanksgiving, Christmas Eve, New Year\'s Eve and a plain Thursday are not holidays', () => [hol(2026, 12, 3), hol(2026, 12, 24), hol(2026, 12, 31), hol(2026, 11, 19)], ['', '', '', '']);

  console.log(' the prompt (lead 3121946430, Wednesday 11/25 10:25 AM):');
  const p = (() => { const d = JSON.parse(JSON.stringify(LEAD)); sb0.__L = d; vm.runInContext('activeFlags = new Set(); leadContext = ""; lastScrapedData = globalThis.__L;', sb0); sb0.populateFromData(d);
    return String(sb0.__lp.buildUserPrompt(panelPayload(src, sb0, { lsd: d, context: String(vm.runInContext('leadContext', sb0) || '') }))); })();
  check('the calendar: "TOMORROW = Thursday 11/26 (CLOSED — Thanksgiving Day)", and a HOLIDAY line naming Friday 11/27 as the next open day', () => [/TOMORROW = Thursday 11\/26 \(CLOSED — Thanksgiving Day\)/.test(p), /HOLIDAY: Thursday 11\/26 is Thanksgiving Day -- every store is closed\.[^\n]*offer Friday 11\/27 instead\./.test(p)], [true, true]);
  check('...and the store status says tomorrow is closed: never offer it, never name it', () => [/STORE STATUS RIGHT NOW: OPEN\.[^\n]*TOMORROW IS CLOSED: never offer it and never name it/.test(p), /lead with a today time, or today plus tomorrow/.test(p)], [true, false]);

  console.log(' the appointment engine:');
  const eng = (ms, store) => { const sb = at(ms); return vm.runInContext('computeAppointmentTimes', sb)(store || '21135', 'TEST017S').pairText; };
  check('Wednesday 11/25 at 6:30 PM (past Audi\'s cutoff) -> Friday, November 27, never Thanksgiving', () => /Friday, November 27/.test(eng(CT(2026, 11, 25, 18, 30))), true);
  check('on Thanksgiving itself (Thursday 11/26, 10 AM) -> no same-day times; Friday, November 27', () => /today/.test(eng(CT(2026, 11, 26, 10, 0))) ? 'today offered' : /Friday, November 27/.test(eng(CT(2026, 11, 26, 10, 0))), true);
  check('Thursday 12/24 at 7:30 PM (Baytown) -> Saturday, December 26, never Christmas Day', () => /Saturday, December 26/.test(eng(CT(2026, 12, 24, 19, 30), '6189')), true);
  check('Thursday 12/31 at 7:30 PM (Baytown) -> Saturday, January 2, never New Year\'s Day', () => /Saturday, January 2/.test(eng(CT(2026, 12, 31, 19, 30), '6189')), true);
  check('control: Wednesday 12/2 at 6:30 PM -> Thursday, December 3 (an ordinary Thursday)', () => /Thursday, December 3/.test(eng(CT(2026, 12, 2, 18, 30))), true);

  console.log(' a draft that still names the holiday:');
  const g = (t) => { vm.runInContext('lastScrapedData = { dealerId: "21135", store: "Audi Lafayette" };', sb0); return vm.runInContext('_lpHouseGuard', sb0)(t, 'sms'); };
  check('"Would 10:00 AM or 11:30 AM tomorrow work?" on Wednesday 11/25 -> Friday', () => g('Would 10:00 AM or 11:30 AM tomorrow work?'), 'Would 10:00 AM or 11:30 AM Friday work?');
  check('"Thursday, November 26 at 10:00 AM" -> "Friday, November 27 at 10:00 AM"', () => g('Would Thursday, November 26 at 10:00 AM work?'), 'Would Friday, November 27 at 10:00 AM work?');
  check('control: "We are closed Thursday for Thanksgiving" is left alone', () => g('We are closed Thursday for Thanksgiving, so Friday at 10:00 AM works.'), 'We are closed Thursday for Thanksgiving, so Friday at 10:00 AM works.');
  const sbW = at(CT(2026, 12, 2, 10, 0)); sbW.console.log = () => {};
  check('control: the next week, "Thursday at 10:00 AM" is an ordinary Thursday', () => { vm.runInContext('lastScrapedData = { dealerId: "21135" };', sbW); return vm.runInContext('_lpHouseGuard', sbW)('Would Thursday at 10:00 AM work?', 'sms'); }, 'Would Thursday at 10:00 AM work?');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
