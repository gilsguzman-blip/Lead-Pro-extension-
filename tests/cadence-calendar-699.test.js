#!/usr/bin/env node
'use strict';
// (v9.7.699) AUDIT P6 — the cadence position is the calendar's. Gil's ruling: "the cadence touch is
// determined by calendar lead age; missed touches are skipped; spacing is kept (the last real outreach
// decides WHETHER it's time); a recent reply or live appointment outranks the cadence."
// Runs the shipped _lpCadenceByCalendar / _lpCadence / _lpBuildArcState out of the whole popup.js.
//
// Usage: node tests/cadence-calendar-699.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: cadence-calendar-699.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DAY = 86400000, NOW = Date.UTC(2026, 8, 23, 17, 0, 0);
const ago = (d) => NOW - d * DAY;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const cal = (o) => sb._lpCadenceByCalendar(Object.assign({ nowMs: NOW, consecutiveOutbound: 5, daysSinceReply: null }, o));
  const pick = (r) => [r.status, r.touch ? r.touch.day : null, r.next ? r.next.day : null];

  console.log(' which touch — calendar age, missed touches skipped:');
  // capture a8dc2954: 55 days old, and the progress reading said "day-24 (reconciled)" off 5 sends.
  check('a 55-day lead is at the day-53 touch, not day-24', () => pick(cal({ leadAgeDays: 55, lastOutreachMs: ago(9) })), ['due', 53, null]);
  check('...and the line says the lead age beside the touch day, so "day-N" cannot read as a date',
    () => /this lead is 55 days old, so the touch scheduled for day 53 of the lead is the one due now/.test(cal({ leadAgeDays: 55, lastOutreachMs: ago(9) }).line), true);
  check('...and says missed touches are skipped', () => /Touches missed earlier are skipped, not made up\./.test(cal({ leadAgeDays: 55, lastOutreachMs: ago(9) }).line), true);
  check('day 15 exactly is the day-15 touch', () => pick(cal({ leadAgeDays: 15.4, lastOutreachMs: ago(3) })), ['due', 15, null]);

  console.log(' whether it is time — the last real outreach decides:');
  check('outreach went out on day 54 of a 55-day lead: day-53 is covered, next is day-64 in 9 days',
    () => { const r = cal({ leadAgeDays: 55, lastOutreachMs: ago(1) }); return [r.status, r.touch.day, r.next.day, r.daysToNext, r.lastOutreachDay]; }, ['covered', 53, 64, 9, 54]);
  check('...and the line says so plainly', () => /already covered — our last text or email went out on day 54\. The next scheduled touch is on day 64, 9 days from now\./.test(cal({ leadAgeDays: 55, lastOutreachMs: ago(1) }).line), true);
  check('outreach on day 52, the touch day is 53: still due', () => pick(cal({ leadAgeDays: 55, lastOutreachMs: ago(3) })), ['due', 53, null]);
  check('no dated text/email on the lead: due, and says nothing about a last send', () => { const r = cal({ leadAgeDays: 28 }); return [r.status, r.touch.day, /nothing has gone out since/.test(r.line)]; }, ['due', 28, false]);
  check('the last numbered touch covered: no next before day 90', () => { const r = cal({ leadAgeDays: 85, lastOutreachMs: ago(1) }); return [r.status, r.touch.day, r.next, /No numbered touch is left before day 90/.test(r.line)]; }, ['covered', 82, null, true]);

  console.log(' what outranks it:');
  check('a reply 2 days ago pauses the cadence', () => { const r = cal({ leadAgeDays: 55, daysSinceReply: 2, consecutiveOutbound: 1 }); return [r.status, r.touch, /replied 2 days ago, so the conversation, not the 90-day schedule/.test(r.line)]; }, ['paused', null, true]);
  check('a reply 40 days ago that is still the newest message pauses it too', () => cal({ leadAgeDays: 55, daysSinceReply: 40, consecutiveOutbound: 0 }).status, 'paused');
  check('a reply 40 days ago with 6 unanswered sends since does NOT', () => pick(cal({ leadAgeDays: 55, daysSinceReply: 40, consecutiveOutbound: 6, lastOutreachMs: ago(8) })), ['due', 53, null]);
  check('a live appointment pauses it', () => { const r = cal({ leadAgeDays: 30, hasApptSet: true }); return [r.status, /an appointment is set/.test(r.line)]; }, ['paused', true]);

  console.log(' edges — unchanged from the progress reading:');
  check('before day 4: no touch, no line', () => { const r = cal({ leadAgeDays: 2 }); return [r.status, r.line]; }, ['none', '']);
  check('unknown age: no touch, no line', () => { const r = cal({ leadAgeDays: 0 }); return [r.status, r.line]; }, ['none', '']);
  check('past day 90: nurture, no line', () => { const r = cal({ leadAgeDays: 120, lastOutreachMs: ago(30) }); return [r.status, r.line]; }, ['nurture', '']);

  console.log(' wiring:');
  check('_lpCadence returns the calendar reading beside the progress one', () => {
    const r = sb._lpCadence({ leadAgeDays: 55, contextText: '', flagOn: false, lastOutreachMs: ago(9), nowMs: NOW, consecutiveOutbound: 9 });
    return [r.calendar.status, r.calendar.touch.day, !!r.compute]; }, ['due', 53, true]);
  check('the diagnostic logs both and flags the shift', () => {
    const logs = []; const r = sb._lpCadence({ leadAgeDays: 55, contextText: '[09/01/2026 9:00 AM] [AGENT] Outbound Text Message\n[08/25/2026 9:00 AM] [AGENT] Outbound Text Message\n', flagOn: false, lastOutreachMs: ago(9), nowMs: NOW, consecutiveOutbound: 9 });
    sb._lpCadenceDiag(r, (l) => logs.push(l));
    return [/CALENDAR \(what the prompt states, v9\.7\.699 P6\): due day-53/.test(logs[0]), /⚠ SHIFT: progress said day-8/.test(logs[0])]; }, [true, true]);
  check('the situation read carries the calendar line and no "Scheduled position"', () => {
    const s = sb._lpBuildArcState({ leadAgeDays: 55, outboundSends: [] }, { totalInbound: 0, totalOutbound: 9, daysSinceReply: null, consecutiveOutbound: 9,
      cadence: { day: 53, status: 'due', line: cal({ leadAgeDays: 55, lastOutreachMs: ago(9) }).line } });
    return [s.lines.some(l => /^Cadence \(by calendar\): this lead is 55 days old/.test(l)), s.lines.some(l => /Scheduled position/.test(l))]; }, [true, false]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
