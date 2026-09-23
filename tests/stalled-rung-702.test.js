#!/usr/bin/env node
'use strict';
// (v9.7.702) THE STALLED LADDER GETS A CALENDAR. Gil's ruling: a stalled lead's rung is the LOWER of
// its count rung (thresholds unchanged: 1 / 2 / 3 / 4 / 5+ texts and emails) and a calendar rung taken
// from lead age (rung 2 from day 2, 3 from day 8, 4 from day 15, 5 from day 21). Unknown age fails safe
// to rung 1. A customer's own exit or pause is not capped.
// Runs the whole popup.js: _lpStalledCalendarRung directly, then buildUserPrompt on synthetic stalled
// leads, reading the phase off the rendered prompt and the [LP STALLED RUNG DIAG] line off the log.
//
// Usage: node tests/stalled-rung-702.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stalled-rung-702.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const entry = (m, d, t, k, ti, b) => '[' + pad(m) + '/' + pad(d) + '/2026 ' + t + '] [' + k + '] ' + ti + '\n  ' + b + '\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }

  // A never-replied stalled lead: `texts` outbound texts and `emails` emails above the lead marker.
  const lead = (age, texts, emails, extra) => {
    const e = [];
    for (let i = 0; i < texts; i++) e.push(entry(9, 22 - (i % 20), '10:0' + (i % 10) + ' AM', 'AGENT', 'Outbound Text Message', 'Sent to: (555) 010-0199\n  Checking in on the Pilot.'));
    for (let i = 0; i < emails; i++) e.push(entry(9, 21 - (i % 20), '11:0' + (i % 10) + ' AM', 'AGENT', 'Email reply to prospect', 'Following up on your inquiry.'));
    const c = e.join('') + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(9, 1, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
    const d = Object.assign({ agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', name: 'Test Buyer',
      vehicle: '2026 Honda Pilot EX-L', leadSource: 'Cars.com', dealerId: '6191', store: 'Community Honda Baytown',
      convState: 'active-follow-up', hasCustomerReply: false, hasOutbound: true, _isStalled: true, _neverReplied: true,
      relationshipSignals: { totalOutboundCount: texts + emails, consecutiveOutboundNoReply: texts + emails, lastInboundAgeDays: null } },
      age === undefined ? {} : { leadAgeDays: age }, extra || {});
    d.context = c; vm.runInContext('leadContext = ' + JSON.stringify(c) + ';', sb); sb.__logs.length = 0;
    const p = sb.__lp.buildUserPrompt(d);
    const m = p.match(/STALLED LEAD RE-ENGAGEMENT -- (PHASE \d)/);
    return { p, phase: m ? m[1] : null, diag: sb.__logs.find(l => /^\[LP STALLED RUNG DIAG\]/.test(l)) || null,
             gate: sb.__logs.find(l => /^\[LP STALLED PHASE GATE DIAG\]/.test(l)) || null };
  };
  const cal = (a) => sb._lpStalledCalendarRung(a);

  console.log(' the calendar bands:');
  check('day 0 to 1.9 → rung 1', () => [0.5, 1, 1.9].map(cal), [1, 1, 1]);
  check('day 2 to 7.9 → rung 2 (engagement)', () => [2, 4, 7.9].map(cal), [2, 2, 2]);
  check('day 8 to 14.9 → rung 3 (persistence, a week of silence)', () => [8, 9, 14.9].map(cal), [3, 3, 3]);
  check('day 15 to 20.9 → rung 4 (the cadence\'s day-15 touch)', () => [15, 18, 20.9].map(cal), [4, 4, 4]);
  check('day 21 and on → rung 5', () => [21, 55, 400].map(cal), [5, 5, 5]);
  check('unknown age — absent, 0, negative, not a number — fails safe to rung 1', () => [undefined, null, 0, -3, NaN, 'abc', ''].map(cal), [1, 1, 1, 1, 1, 1, 1]);
  check('a scraped string age reads as its number', () => [cal('9'), cal('21.0')], [3, 5]);
  check('rung 5\'s calendar floor IS the close-out resolver\'s 21-day floor — the calendar moves no close-out', () => {
    const d = (a) => ({ leadAgeDays: a, hasCustomerReply: false, relationshipSignals: { totalOutboundCount: 9, lastInboundAgeDays: null } });
    return [sb.LP_STALLED_RUNG_MIN_AGE[5], sb._lpCloseOutEligible(d(20.9)).eligible, sb._lpCloseOutEligible(d(21)).eligible, cal(20.9), cal(21)];
  }, [21, false, true, 4, 5]);

  console.log(' the young top-rung leads the 52 logs found now land by the calendar:');
  check('8 touches in 2 days (the Audi Lafayette shape, log capture 634c4a67) → PHASE 2', () => lead(2, 8, 0).phase, 'PHASE 2');
  check('6 touches in 4 days → PHASE 2', () => lead(4, 5, 1).phase, 'PHASE 2');
  check('11 touches in 7 days → PHASE 2', () => lead(7, 9, 2).phase, 'PHASE 2');
  check('13 touches in 9 days → PHASE 3', () => lead(9, 11, 2).phase, 'PHASE 3');
  check('control: 8 touches on day 16 → PHASE 4 without the exit (calendar rung 4; the resolver held it here before too)', () => {
    const r = lead(16, 8, 0);
    return [r.phase, /Do NOT offer to close the file, stop contact, or ask whether to keep it open/.test(r.p), /needs 21d AND 5/.test(r.p)];
  }, ['PHASE 4', true, true]);
  check('...and a PHASE 2 lead gets the PHASE 2 wording, not a stale close-out line', () => {
    const r = lead(2, 8, 0);
    return [/Ask a low-effort question/.test(r.p), /GRACEFUL CLOSE-OUT|close it out\?/.test(r.p), r.gate];
  }, [true, false, null]);
  check('control: the touch count the model is told is unchanged — it is the rung that moved', () => /This customer has not responded to 8 message\(s\)\./.test(lead(2, 8, 0).p), true);

  console.log(' unknown age fails safe:');
  check('8 touches, no lead age → PHASE 1', () => lead(undefined, 8, 0).phase, 'PHASE 1');
  check('8 touches, age 0 → PHASE 1', () => lead(0, 8, 0).phase, 'PHASE 1');

  console.log(' the customer\'s own exit is not capped:');
  check('an exit signal on a 3-day lead still reaches the close-out rung, as the resolver allows at any age',
    () => { const r = lead(3, 8, 0, { hasExitSignal: true }); return [r.phase, /customer exit\/pause — not calendar-capped/.test(r.diag)]; }, ['PHASE 5', true]);

  console.log(' controls — where the count is already the lower rung, nothing changes:');
  check('control: 8 touches on a 55-day lead → PHASE 5', () => lead(55, 8, 0).phase, 'PHASE 5');
  check('control: 8 touches on a 25-day lead → PHASE 5 (eligible: 21 days and 5 outreaches)', () => lead(25, 8, 0).phase, 'PHASE 5');
  check('control: 2 touches on a 40-day lead → PHASE 2 (the count is lower)', () => lead(40, 2, 0).phase, 'PHASE 2');
  check('control: 3 touches on a 10-day lead → PHASE 3', () => lead(10, 3, 0).phase, 'PHASE 3');

  console.log(' [LP STALLED RUNG DIAG]:');
  check('logs outreach, age, count rung, calendar rung and final rung, and says why it capped', () => lead(2, 8, 0).diag,
    '[LP STALLED RUNG DIAG] outreach:8 (texts:8 emails:0) | leadAge:2d | countRung:5 | calendarRung:2 | finalRung:2 ← calendar-capped: 8 touches, but the lead is only 2 days old');
  check('an uncapped lead carries no capped marker', () => lead(55, 8, 0).diag,
    '[LP STALLED RUNG DIAG] outreach:8 (texts:8 emails:0) | leadAge:55d | countRung:5 | calendarRung:5 | finalRung:5');
  check('unknown age is logged as unknown', () => /leadAge:unknown \| countRung:5 \| calendarRung:1 \| finalRung:1 ← calendar-capped: 8 touches, but the lead age is unknown/.test(lead(undefined, 8, 0).diag), true);
  check('it is a popup-side console line, logged once per prompt', () => { lead(9, 8, 0); return sb.__logs.filter(l => /\[LP STALLED RUNG DIAG\]/.test(l)).length; }, 1);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
