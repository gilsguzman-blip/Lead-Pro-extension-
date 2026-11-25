#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('early-close-895.test.js');
// The agents' machines run on Central time, and the appointment engine's next-day label converts to Central from the machine clock (a
// second conversion on a machine set elsewhere -- older behavior, out of scope here). The suite runs on the agents' clock.
process.env.TZ = 'America/Chicago';
// (v9.7.895) CHRISTMAS EVE AND NEW YEAR'S EVE CLOSE AT 5 PM, every store. Owner, 11/25: "Christmas Eve and New Year's Eve close at 5 PM".
// The last same-day appointment is an hour before closing, as on every other day. Executes computeAppointmentTimes on fixed Central
// clocks and buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/early-close-895.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: early-close-895.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const H = (h) => '[12/22/2026 10:05 AM] [CUSTOMER] Inbound Text Message\n  Do you have any RAV4s?\n[12/22/2026 9:30 AM] [AGENT] Outbound Text Message\n  Test, thanks for reaching out. Are you looking at the RAV4?\n[12/22/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Toyota RAV4', condition: 'New', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Dealer.com',
  convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', customerZip: '12345',
  relationshipSignals: { unansweredQuestions: [] }, conversationBrief: H(), history: H(), context: '', autoLeadId: 'TEST017S', outboundSends: [] };
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const at = (ms) => { const sb = loadPopup(f, { withAuth: true }); sb.console.log = () => {}; sb.console.warn = () => {};
    vm.runInContext('(function(){ var RD = Date, FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb); return sb; };
  const eng = (ms, store) => vm.runInContext('computeAppointmentTimes', at(ms))(store || '6189', 'TEST017S');
  const late = (r) => /\b(?:4:(?:[1-5]\d)|[5-9]:\d\d) PM\b/.test(r.time1 + ' ' + r.time2);
  const prompt = (ms) => { const sb = at(ms); const d = JSON.parse(JSON.stringify(LEAD)); sb.__L = d; vm.runInContext('activeFlags = new Set(); leadContext = ""; lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); };

  console.log(' the appointment engine:');
  const ce = eng(CT(2026, 12, 24, 15, 0));
  check('Christmas Eve at 3:00 PM (Baytown) -> 4:00 PM today is the last time, nothing after it, and the next one is Saturday 12/26', () => [ce.time1, late(ce), /Saturday, December 26/.test(ce.pairText)], ['4:00 PM today', false, true]);
  check('Christmas Eve at 3:30 PM -> no same-day time left; Saturday, December 26 (Christmas Day skipped)', () => /Saturday, December 26/.test(eng(CT(2026, 12, 24, 15, 30)).pairText), true);
  check('New Year\'s Eve at 3:30 PM -> Saturday, January 2 (New Year\'s Day skipped)', () => /Saturday, January 2/.test(eng(CT(2026, 12, 31, 15, 30)).pairText), true);
  check('control: December 23 at 3:30 PM (Baytown, open till 8) -> still today', () => /today/.test(eng(CT(2026, 12, 23, 15, 30)).pairText), true);

  console.log(' the prompt:');
  const p22 = prompt(CT(2026, 12, 22, 10, 25));
  check('the calendar three days out: "(closes at 5 PM — Christmas Eve)", and an EARLY CLOSE line', () => [/Thursday 12\/24 \(closes at 5 PM — Christmas Eve\)/.test(p22), /EARLY CLOSE: Thursday 12\/24 is Christmas Eve -- every store closes at 5 PM\. On that day offer no time after 4:00 PM\./.test(p22)], [true, true]);
  check('on Christmas Eve itself: "Closes at 5 PM"', () => /STORE STATUS RIGHT NOW: OPEN\. Closes at 5 PM/.test(prompt(CT(2026, 12, 24, 10, 0))), true);
  check('control: December 23 -> "Closes at 8 PM"', () => /STORE STATUS RIGHT NOW: OPEN\. Closes at 8 PM/.test(prompt(CT(2026, 12, 23, 10, 0))), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
