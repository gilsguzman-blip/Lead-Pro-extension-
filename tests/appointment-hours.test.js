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

// ── (v9.7.642) THE SECOND OPTION MUST BE A DAY WE ARE OPEN ────────────────────────────────────
// Chukwuma Emezie (Community Honda Baytown, 9/5, 9:05 AM Saturday). His prompt carried
//   STORE STATUS RIGHT NOW: OPEN ... lead with a today time, or today plus tomorrow.
// twenty lines under "TOMORROW = Sunday 9/6 (CLOSED)" and ten lines above "CLOSED DAYS ARE NEVER
// OFFERED ... NOT as a relative word ('tomorrow')". The string was hardcoded; its own comment
// claimed it was "stated positively so it cannot fight the closed-day rule above", and it fought
// it. 4 of 57 open-hours grabs across four separate captures, and deterministic rather than
// occasional — every rooftop closes Sunday, so it fires on every Saturday the store is open.
//
// Executed against the SHIPPED calendar block, whose _dayIsClosed already owns this question and
// stamps (CLOSED) on the reference three lines up. Resolving it anywhere else would be a second
// reading of STORE_HOURS.
function nextOpen(file, iso, dealerId) {
  const src = fs.readFileSync(file, 'utf8');
  const sa = src.indexOf('const STORE_HOURS = {');
  const sh = src.slice(sa, src.indexOf('\n};', sa) + 3);
  const a = src.indexOf('        var _cal_now = new Date(new Date().toLocaleString');
  const b = src.indexOf('        _cal_lines.forEach(function(l){ ageBlock.push(l); });');
  if (sa < 0 || a < 0 || b < 0) bail('calendar block not found in ' + file + ' — THE SUITE DID NOT LOAD');
  const Real = Date;
  const sb = { console: { log() {} }, window: {} };
  sb.Date = class extends Real {
    constructor(...x) { if (!x.length) super(iso); else super(...x); }
    static now() { return new Real(iso).getTime(); }
  };
  vm.createContext(sb);
  vm.runInContext(sh, sb);
  vm.runInContext('var data={dealerId:' + JSON.stringify(dealerId) + '}; var ageBlock=[]; var _lpNextOpenLabel="";\n'
    + src.slice(a, b), sb);
  return vm.runInContext('_lpNextOpenLabel', sb);
}

for (const file of BUILDS) {
  console.log('\n' + path.relative(process.cwd(), file) + ' — the day after today, when today is Saturday');
  const ROOFTOPS = [['Honda Baytown', '6191'], ['Toyota Baytown', '6189'], ['Kia Baytown', '6190'],
                    ['Honda Lafayette', '24399'], ['Audi Lafayette', '21135']];
  console.log('\nSaturday 9/5 — every rooftop is closed Sunday:');
  for (const [name, id] of ROOFTOPS)
    check('  ' + name + ' resolves past the closed Sunday',
      nextOpen(file, '2026-09-05T10:00:00-05:00', id), 'Monday 9/7');
  console.log('\n  ...and on a day whose tomorrow IS open, nothing changes:');
  for (const [name, id] of ROOFTOPS)
    check('  ' + name + ' on a Friday still says tomorrow',
      nextOpen(file, '2026-09-04T10:00:00-05:00', id), 'tomorrow');
  check('  a Monday also still says tomorrow',
    nextOpen(file, '2026-09-07T10:00:00-05:00', '6191'), 'tomorrow');

  console.log('\nthe status line reads the resolved label, not a hardcoded word:');
  const code = fs.readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('the hardcoded "today plus tomorrow" is gone from the unconditional path',
    /so today is the default: lead with a today time, or today plus tomorrow\./.test(code), false);
  check('  ...it is now reached only when tomorrow is genuinely open',
    /_lpNextOpenLabel === 'tomorrow'\s*\n?\s*\? ' lead with a today time, or today plus tomorrow\.'/.test(code), true);
  check('  ...and a closed tomorrow names the open day instead',
    /Only if the conversation genuinely has to move off today does a later day come in, and that day is ' \+ _lpNextOpenLabel/.test(code), true);
  // (v9.7.643) THE PROPERTY GIL'S QUESTION EXPOSED. The slot engine returns TWO TODAY slots all
  // Saturday morning; v9.7.642 told the model any second option had to be Monday, contradicting
  // them and inviting the today+Monday pairing he asked about. This line owns "soonest first" and
  // "never a closed day" — it does not own what is available, and must defer to the block that
  // does. The v9.7.631 ownership rule, applied to a directive I wrote myself.
  check('  ...and it defers to the block that owns availability',
    /the SUGGESTED APPOINTMENT TIMES below already reflect what is genuinely available/.test(code), true);
  check('  ...rather than prescribing what the second option must be',
    /if you offer a second option at all it must be/.test(code), false);
  // EXECUTED, not matched. A source-position assertion says the branch exists; only running it
  // says the branch still decides anything. Disabling the condition leaves every text match green,
  // which is the vacuous shape this repo has shipped before.
  const soonestFor = (label) => {
    const src = fs.readFileSync(file, 'utf8');
    const a = src.indexOf("                  var _soonest = _lpNextOpenLabel === 'tomorrow'");
    if (a < 0) bail('the soonest-first branch is not where this suite expects it in ' + file);
    const b = src.indexOf("_statusLine = 'STORE STATUS RIGHT NOW: OPEN.", a);
    const sb = { };
    vm.createContext(sb);
    vm.runInContext('var _lpNextOpenLabel = ' + JSON.stringify(label) + ';\n' + src.slice(a, b), sb);
    return vm.runInContext('_soonest', sb);
  };
  console.log('\n  ...and running the branch, not just matching it:');
  check('an OPEN tomorrow still offers today plus tomorrow',
    /today plus tomorrow/.test(soonestFor('tomorrow')), true);
  check('a CLOSED tomorrow does not',
    /today plus tomorrow/.test(soonestFor('Monday 9/7')), false);
  check('  ...it names the open day it resolved to',
    /that day is Monday 9\/7/.test(soonestFor('Monday 9/7')), true);
  check('  ...only as the move-off-today fallback, not as the second option',
    /Only if the conversation genuinely has to move off today/.test(soonestFor('Monday 9/7')), true);
  check('  ...and it points at the suggested times rather than replacing them',
    /follow them rather than substituting a day of your own/.test(soonestFor('Monday 9/7')), true);
  check('  ...and says outright that tomorrow is closed',
    /TOMORROW IS CLOSED/.test(soonestFor('Monday 9/7')), true);
  check('  ...and forbids the relative words the closed-day rule also forbids',
    /never offer it and never name it, including as "tomorrow" or "this weekend"/.test(soonestFor('Monday 9/7')), true);
  check('an unresolvable calendar offers no second day at all',
    soonestFor(''), ' lead with a today time.');

  check('the label is declared outside the try, so a calendar failure cannot leave it undefined',
    /var _lpNextOpenLabel = '';\n\s*try \{/.test(code), true);
  check('  ...and an empty label drops the second option rather than guessing',
    /: ' lead with a today time\.'\)/.test(code), true);
  check('it reuses _dayIsClosed rather than re-reading STORE_HOURS',
    /if \(!_dayIsClosed\(_noD\)\) \{/.test(code), true);
}

// ── (v9.7.642) THEY CANNOT HAVE REPLIED IF WE NEVER WROTE ─────────────────────────────────────
// Same capture, same lead. Chukwuma's prompt carried "LIVE CONVERSATION: Customer replied within
// the last few hours ... references exactly what the customer said" while its own facts section
// read "Exchange so far: 1 inbound / 0 outbound", "light (0 outreaches)", "Phase: first-touch",
// and the CONTEXT & HISTORY section carried no transcript at all. isLiveConversation is true when
// any inbound note in the top three is under 8 hours old, and on a fresh lead the lead-received
// note ITSELF is inbound — so it fires on every same-day first-touch grab. The heat reading is
// right; "replied" is not, and telling the model to quote words that are nowhere in the prompt is
// how invented quotes happen (v9.7.428, v9.7.552, v9.7.641).
for (const file of BUILDS) {
  const code = fs.readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const joined = code.replace(/'\s*\n\s*\+\s*'/g, '');
  console.log('\n' + path.relative(process.cwd(), file) + ' — replied vs inquired');
  check('the live-conversation block branches on prior outbound',
    /if \(d\.isLiveConversation\) vehicleExtras\.push\(d\.hasOutbound/.test(code), true);
  check('  ...the replied wording survives for a lead we HAVE written to',
    /LIVE CONVERSATION: Customer replied within the last few hours/.test(joined), true);
  check('  ...and a first inquiry gets its own wording instead',
    /FRESH INQUIRY — CAME IN WITHIN THE LAST FEW HOURS/.test(joined), true);
  check('the fresh branch says plainly that they have not replied',
    /They have NOT replied to anything/.test(joined), true);
  check('  ...and forbids quoting words that are not in the prompt',
    /no message of theirs to quote/.test(joined), true);
  check('  ...so "references exactly what the customer said" is not in the fresh branch',
    joined.split('FRESH INQUIRY')[1].split("');")[0].indexOf('references exactly what the customer said'), -1);
  // EXECUTED, same reason as the soonest-first branch above.
  const liveFor = (hasOutbound) => {
    const src = fs.readFileSync(file, 'utf8');
    const a = src.indexOf('  if (d.isLiveConversation) vehicleExtras.push(d.hasOutbound');
    if (a < 0) bail('the live-conversation branch is not where this suite expects it in ' + file);
    const b = src.indexOf("\n", src.indexOf("getting them in soon is the goal.');", a));
    const sb = { vehicleExtras: [], d: { isLiveConversation: true, hasOutbound: hasOutbound } };
    vm.createContext(sb);
    vm.runInContext(src.slice(a, b), sb);
    return sb.vehicleExtras[0] || '';
  };
  console.log('\n  ...and running that branch too:');
  check('a lead we HAVE written to still reads "replied"',
    /Customer replied within the last few hours/.test(liveFor(true)), true);
  check('a lead we have NOT written to does not',
    /Customer replied within the last few hours/.test(liveFor(false)), false);
  check('  ...it reads as a fresh inquiry instead',
    /FRESH INQUIRY/.test(liveFor(false)), true);
  check('  ...and never asks the model to quote words it has not been given',
    /references exactly what the customer said/.test(liveFor(false)), false);
  check('  ...while the lead we wrote to still may reference what they said',
    /references exactly what the customer said/.test(liveFor(true)), true);

  check('both branches still treat it as hot',
    (joined.match(/This is a HOT lead/g) || []).length, 2);
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
