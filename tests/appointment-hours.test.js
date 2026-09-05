#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('appointment-hours.test.js');

/**
 * appointment-hours.test.js — v9.7.638. THE APPOINTMENT ENGINE OFFERED TIMES THE STORE IS CLOSED.
 *
 * Rebecca Caplan (Community Honda Baytown, 9/5), prompt captured at 12:45 AM Central:
 *
 *     STORE HOURS — Honda Baytown:  Monday-Saturday: 9 AM - 8 PM
 *     STORE STATUS RIGHT NOW: NOT YET OPEN today. Opens at 9 AM.
 *     ...
 *     SUGGESTED APPOINTMENT TIMES (fallback only — see rule below):
 *     Option: 2:45 AM today
 *     Option: 3:30 AM today
 *     ↳ These are valid open in-hours slots
 *
 * The status line knew the store was shut. The slot generator did not. Its validity test read
 *
 *     sameDayValid = !isClosed && earliest <= sameDayCutoffMins && earliest + 45 <= closeMins
 *
 * — the store must not have CLOSED, and nothing about it having OPENED. openMins was computed
 * forty lines earlier and then used by nothing at all.
 *
 * THIS SUITE EXISTS BECAUSE ONE FIXTURE WOULD NOT HAVE FOUND IT. The defect is invisible for
 * seventeen hours of the day and every capture Gil had sent before this one was taken inside those
 * seventeen. So the shipped calculator is executed at every hour, at every rooftop, on an open day
 * and a closed one, and the invariant is asserted against the store's real hours rather than
 * against a remembered pair of times.
 *
 * Executes the SHIPPED computeAppointmentTimes with Date replaced. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: appointment-hours.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('appointment-hours.test.js', m);

// The rooftops and the hours the file itself encodes for them. Kept here as the INDEPENDENT
// statement of truth: if someone edits the branches, these assertions are what disagrees.
const STORES = [
  { name: 'Community Honda Baytown',    open: 9, close: 20, satClose: 20 },
  { name: 'Community Toyota Baytown',   open: 9, close: 20, satClose: 20 },
  { name: 'Community Kia Baytown',      open: 9, close: 20, satClose: 20 },
  { name: 'Community Honda Lafayette',  open: 9, close: 19, satClose: 19 },
  { name: 'Audi Lafayette',             open: 9, close: 19, satClose: 18 }
];

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function computeAppointmentTimes(store) {');
  if (a < 0) bail('computeAppointmentTimes not in ' + file + ' — THE SUITE DID NOT LOAD');
  const nb = src.indexOf('// --- Next business day ---', a);
  if (nb < 0) bail('next-business-day section not found in ' + file);
  const end = src.indexOf('\nfunction ', src.indexOf('\n}\n', nb));
  if (end < 0) bail('function end not found in ' + file);
  const region = src.slice(a, end);
  if (!/const isClosed = openMins === null/.test(region)) bail('slot gate not inside the lifted region in ' + file);
  return { src, region };
}

// Run the shipped function as if "now" were the given instant.
function runAt(region, iso, store) {
  const Real = Date;
  const sb = { console: { log() {} } };
  sb.Date = class extends Real {
    constructor(...a) { if (a.length === 0) super(iso); else super(...a); }
    static now() { return new Real(iso).getTime(); }
  };
  vm.createContext(sb);
  vm.runInContext(region, sb);
  return vm.runInContext('computeAppointmentTimes(' + JSON.stringify(store) + ')', sb);
}

// "2:45 AM today" -> 165. Returns null for a next-business-day label, which carries a weekday.
function sameDayMins(label) {
  const s = String(label || '');
  if (!/\btoday\b/.test(s)) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = +m[1];
  if (/AM/i.test(m[3])) { if (h === 12) h = 0; } else if (h !== 12) h += 12;
  return h * 60 + (+m[2]);
}

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — a slot the store is open for');

  // ── THE INCIDENT, EXACTLY ──────────────────────────────────────────────────
  console.log("\nRebecca Caplan's capture — Saturday 9/5/2026, 12:45 AM Central, Honda Baytown:");
  const inc = runAt(B.region, '2026-09-05T00:45:00-05:00', 'Community Honda Baytown');
  check('the first option is no longer 2:45 AM', inc.time1 === '2:45 AM today', false);
  check('the second option is no longer 3:30 AM', inc.time2 === '3:30 AM today', false);
  check('the first option is at or after 9:00 AM', sameDayMins(inc.time1) >= 9 * 60, true);
  check('the second option is at or after 9:00 AM', sameDayMins(inc.time2) >= 9 * 60, true);
  check('  ...and it is still offered for TODAY, not pushed to Monday', /today/.test(inc.time1), true);

  // ── EVERY HOUR, EVERY ROOFTOP ──────────────────────────────────────────────
  // Saturday 9/5/2026 is an open day at all five; Sunday 9/6 is closed at all five.
  console.log('\nevery hour of an open day, at every rooftop:');
  for (const st of STORES) {
    let offered = 0, violations = [];
    for (let h = 0; h < 24; h++) {
      const iso = '2026-09-05T' + String(h).padStart(2, '0') + ':45:00-05:00';
      const r = runAt(B.region, iso, st.name);
      for (const lbl of [r.time1, r.time2]) {
        const mins = sameDayMins(lbl);
        if (mins === null) continue;      // next-business-day label, checked separately below
        offered++;
        if (mins < st.open * 60 || mins >= st.satClose * 60) {
          violations.push(String(h).padStart(2, '0') + ':45 -> ' + lbl);
        }
      }
    }
    check('  ' + st.name + ' — ' + offered + ' same-day slot(s), none outside '
      + st.open + ':00-' + st.satClose + ':00', violations, []);
  }

  // ── THE CLOSED DAY IS STILL CLOSED ─────────────────────────────────────────
  // The clamp must not accidentally make a Sunday look open: openMins is null there, and
  // Math.max(x, null) is 0, which would have quietly enabled same-day slots on a closed day.
  console.log('\nSunday is closed and the clamp must not resurrect it:');
  for (const st of STORES) {
    const r = runAt(B.region, '2026-09-06T10:00:00-05:00', st.name);
    check('  ' + st.name + ' — no same-day slot offered on a closed day',
      sameDayMins(r.time1) === null && sameDayMins(r.time2) === null, true);
  }

  // ── THE HALF THAT WAS ALWAYS RIGHT MUST STAY RIGHT ─────────────────────────
  // Late evening already rolled to the next business day. A clamp that broke that would trade one
  // wrong time for another, so it is asserted explicitly rather than assumed.
  console.log('\nthe evening roll-forward is unchanged:');
  const late = runAt(B.region, '2026-09-05T21:45:00-05:00', 'Community Honda Baytown');
  check('a 9:45 PM grab still rolls forward off today', sameDayMins(late.time1), null);
  check('  ...to the next OPEN day, skipping Sunday', /Monday/.test(late.time1 + ' ' + late.time2), true);
  const midday = runAt(B.region, '2026-09-05T12:45:00-05:00', 'Community Honda Baytown');
  check('a midday grab is untouched and still same-day', midday.time1, '2:45 PM today');
  check('  ...with the second option 45+ minutes later',
    sameDayMins(midday.time2) - sameDayMins(midday.time1) >= 45, true);

  // ── THE CLAMP IS THE MECHANISM, NOT A COINCIDENCE ──────────────────────────
  console.log('\nthe clamp reads the store\'s own opening time:');
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('earliestSlot is bounded below by openMins',
    /const earliestSlot = isClosed \? _rawEarliest : Math\.max\(_rawEarliest, openMins\);/.test(code), true);
  check('  ...and a closed day is exempted, so openMins===null cannot become 0',
    /isClosed \? _rawEarliest :/.test(code), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds compute the same slots:');
  const region = f => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf('  const isClosed = openMins === null; // Sunday');
    const b = s.indexOf('\n\n  if (sameDayValid) {', a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the slot gate is identical', region(BUILDS[0]) === region(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
