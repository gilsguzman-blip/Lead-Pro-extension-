#!/usr/bin/env node
'use strict';
// (v9.7.727) log251/252, Community Kia Baytown, 9/25: the virtual assistant texted "come in for a test drive
// today at 12:00 PM or Friday at 10:00 AM?", the customer answered "I can't make it to Houston today", and
// the scraper read it as "Customer requested reschedule" -> hasMissedAppt + customerRepliedReschedule. The
// prompt then carried an APPOINTMENT HISTORY entry and a "RESCHEDULE REQUESTED: the customer replied R to
// ... Reply C to confirm or R to reschedule" block, and the persona switched to MANAGER (missed appt) -- on
// a lead where nothing had ever been booked. Gil: "especially with the AI agent pushing all the time."
// Now "I can't make it" is a reschedule only when an appointment was BOOKED before it (a reminder, a
// confirmation, our message saying it is set, or the customer taking a time); the assistant's "we can
// reschedule at a more convenient time" with nothing booked is not a missed-appointment re-engagement.
// Executes the shipped appointment-timeline block from inlineScraper against stub note elements.
//
// Usage: node tests/appt-booked-727.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: appt-booked-727.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
// A stub VinSolutions note: direction, title, content, date.
const note = (hoursAgo, dir, title, content) => ({
  getAttribute: (k) => (k === 'data-direction' ? dir : null),
  querySelector: (sel) => ({ innerText: /title/.test(sel) ? title : /content/.test(sel) ? content : /date/.test(sel) ? fmt(NOW - hoursAgo * H) : '' })
});
const BOT_OFFER = 'Sent to: (555) 010-0199 Sent by: Vinessa Virtual Assistant Community Kia Hi Test, would you be able to come in for a test drive today (Thursday) at 12:00 PM or Friday at 10:00 AM?';
const CANT = 'Received from: (555) 010-0199 Received by: Vinessa Virtual Assistant Community Kia I can’t make it to Houston today but I can send photos of my trade in';

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf('    var apptTimeline = [];'), b = src.indexOf("      _lpD('[Lead Pro] Appointment timeline error:', apptErr);\n    }", a);
  if (a < 0 || b < 0) throw new Error('appointment block not found');
  const block = src.slice(a, b) + "      _lpD('[Lead Pro] Appointment timeline error:', apptErr);\n    }\n"
    + '    return { hasMissedAppt: hasMissedAppt, hasApptSet: hasApptSet, reschedule: customerRepliedRescheduleFlag, timeline: apptTimeline };\n';
  const run = (notesNewestFirst) => {
    const logs = [];
    const sb = { noteEls: notesNewestFirst, convState: 'active-follow-up', _lpD: (...x) => logs.push(x.join(' ')), Date, Math, Infinity, String, RegExp };
    vm.createContext(sb);
    const r = vm.runInContext('(function(){\n' + block + '})()', sb);
    return Object.assign(r, { logs, timeline: r.timeline.map(t => t.slice(0, 40)) });
  };

  console.log(' 1. declining a time the assistant OFFERED is not a missed appointment:');
  const r1 = run([note(20, 'outbound', 'outbound text message', 'Sent by: Vinessa Virtual Assistant Community Kia Great news, you can get started.'),
                  note(20.02, 'inbound', 'inbound text message', CANT),
                  note(22, 'outbound', 'outbound text message', BOT_OFFER)]);
  check('log251 shape: no missed appointment, no reschedule, nothing in the timeline', () => [r1.hasMissedAppt, r1.reschedule, r1.timeline], [false, false, []]);
  check('...and the diag says why', () => r1.logs.some(l => /^\[LP APPT DIAG\] ".*" \(.*\) -- no appointment was booked before it; read as declining an offered time/.test(l)), true);
  const r2 = run([note(19, 'outbound', 'outbound text message', 'Sent by: Vinessa Virtual Assistant Community Kia No problem, we can reschedule at a more convenient time for you.'),
                  note(20, 'inbound', 'inbound text message', CANT), note(22, 'outbound', 'outbound text message', BOT_OFFER)]);
  check('the assistant\'s "we can reschedule at a more convenient time" with nothing booked is not a missed-appointment re-engagement', () => [r2.hasMissedAppt, r2.timeline], [false, []]);

  console.log(' 2. a BOOKED appointment the customer then cannot make still is:');
  const r3 = run([note(2, 'inbound', 'inbound text message', 'Received from: (555) 010-0199 I can’t make it, need to reschedule'),
                  note(20, 'outbound', 'outbound text message', 'Sent by: Agent Name Quick reminder of our appointment Friday at 10:00 AM. Reply C to confirm or R to reschedule.')]);
  check('after a reminder: missed appointment and reschedule, as before', () => [r3.hasMissedAppt, r3.reschedule, r3.timeline.length], [true, true, 2]);
  const r4 = run([note(2, 'inbound', 'inbound text message', 'Received from: (555) 010-0199 so sorry, I can’t make it today'),
                  note(20, 'inbound', 'inbound text message', 'Received from: (555) 010-0199 10 works for me, see you then'),
                  note(22, 'outbound', 'outbound text message', BOT_OFFER)]);
  check('the customer TOOK an offered time, then cannot make it -> missed appointment', () => [r4.hasMissedAppt, r4.reschedule], [true, true]);
  const r5 = run([note(2, 'inbound', 'inbound text message', 'Received from: (555) 010-0199 cannot make it Saturday'),
                  note(20, 'outbound', 'outbound text message', 'Sent by: Agent Name Test, your appointment is confirmed for Saturday at 11:00 AM with Jocelyne.')]);
  check('our message said the appointment is confirmed, then they cannot make it -> missed appointment', () => [r5.hasMissedAppt, r5.reschedule], [true, true]);
  const r6 = run([note(2, 'outbound', 'outbound text message', 'Sent by: Agent Name Sorry you couldn’t make it today, want to pick another time?'),
                  note(26, 'outbound', 'outbound text message', 'Sent by: Agent Name Test, your appointment is set for today at 3:00 PM.')]);
  check('control: a person\'s missed-appointment follow-up after a booked appointment still counts', () => r6.hasMissedAppt, true);
  const r7 = run([note(2, 'inbound', 'inbound text message', 'R'),
                  note(20, 'outbound', 'outbound text message', 'Sent by: Agent Name Quick reminder of our appointment Friday at 10:00 AM. Reply C to confirm or R to reschedule.')]);
  check('control: "R" to a reminder is still a reschedule', () => [r7.reschedule, r7.hasMissedAppt], [true, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
