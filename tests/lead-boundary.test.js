#!/usr/bin/env node
'use strict';
// The agent's machine, and VinSolutions' rendering, are both store-local Central; PageData is UTC.
// Pinned BEFORE any Date is constructed so the boundary arithmetic below is deterministic.
process.env.TZ = 'America/Chicago';
// (v9.7.616) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('lead-boundary.test.js');

/**
 * lead-boundary.test.js — v9.7.616. A LEAD IS NOT THE WHOLE CUSTOMER RECORD.
 *
 * THREE DIRECTIVES, ONE ROOT CAUSE, both leads Gil pulled on 9/4 at Community Kia Baytown.
 *
 * Sharon Pierre (lead 2078254326) is thirteen hours old and was written as a fatigued ghost:
 * "Attempt density: heavy (26 outreaches)", "ONE-SIDED CONVERSATION: Customer has not replied to
 * 26 prior outreach attempts", "You have already made 26 outreach attempts on this lead". Counted
 * off her DOM dump, those 26 are:
 *
 *     7  real touches since the lead was created (9/3 8:46 PM -> 9/4 9:20 AM)
 *  + 19  mass-marketing blasts, 8/26/2023 through 4/21/2025 -- "RED TAG SALE", "Monster Price
 *        MELTDOWN", "20th Anniversary Sale", each Sent by: System with its own STOP footer
 *  = 26
 *
 * This EXTENDS v9.7.592 rather than correcting it. That build moved these directives off the CRM
 * note count and onto the real outbound tally, which was right and did not go far enough: the
 * tally still spans the whole CUSTOMER record, and outbound sent years before a lead existed is
 * not outreach on that lead.
 *
 * The same 19 blasts are ALSO where her phantom budget came from. BUDGET-STATED FRAMING told the
 * model "Customer has stated a specific budget, payment, or OTD target ... lead with their stated
 * number as the goal" -- to a customer who has never written a word (0 inbound / 26 outbound).
 * Its flag tested the whole assembled arc, and the blasts say "as low as $20,074 MPR" six times.
 * On Tricia Green an hour earlier the same flag fired on TrueCar's own listing field, verbatim
 * "OFFER SHOWN: $25,815". Neither is a customer statement; neither leaves a number to lead with.
 *
 * And the count is what unlocks the third fix. STORE INCENTIVE suppressed on Sharon with
 * "[LP INCENTIVE DIAG] suppressed -- first-touch, no customer-asked override matched" on a NEW
 * 2026 Kia Sportage EX, hiding two current programs (4.99% APR for 48-84 mos, $750 Customer Cash)
 * on a unit sitting 126 days where the prompt has already banned every scarcity line. convState
 * says first-touch all day on a lead created today, however many times we have written -- the log
 * says so itself: "fresh-today lead, no customer reply -> first-touch (was about to be
 * active-follow-up on 31 notes)". So the gate reads the lead-bounded count instead, which is
 * exactly why these ship together: years-old blast marketing must never be what unlocks an
 * incentive.
 *
 * Executes the SHIPPED boundary arithmetic, the SHIPPED ladder, the SHIPPED money detector and the
 * SHIPPED gate. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lead-boundary.test.js <popup.js> [popup.js...]'); process.exit(2); }

function slice(src, a, b, what) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(what + ' start not found');
  const j = src.indexOf(b, i);
  if (j < 0) throw new Error(what + ' end not found');
  return src.slice(i, j + b.length);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const boundary = slice(src, '      var _lpLeadCreatedMs = null;',
                              'catch (_eLc) { _lpLeadCreatedMs = null; }', 'creation boundary');
  const incr     = slice(src, '            if (_lpLeadCreatedMs) {',
                              'sig.leadOutboundCount++;\n            }', 'lead-bounded increment');
  const ladder   = slice(src, 'function _lpOutreachOnThisLead(data, noteCountFallback) {',
                              "return { n: noteCountFallback || 0, src: 'note-count-fallback' };\n}", 'ladder');
  const money    = slice(src, '      function _lpCustomerSaid() {',
                              'catch (eBm) { _lpCustSaidMoney = false; }', 'money detector');
  const gate     = slice(src, '    var _incOutreach = _lpOutreachOnThisLead(d, d.totalNoteCount || 0);',
                              "outreach(es) already sent ON THIS LEAD, so this is follow-up, not first exposure'); } catch (e) {}\n    }",
                              'incentive gate');
  return { name: path.basename(path.dirname(file)), src, boundary, incr, ladder, money, gate };
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

// ── Sharon's real outbound notes, dates verbatim from the 9/4 DOM dump ──────
const ON_LEAD = [   // 7, all at or after Lead.LeadCreatedUTC 2026-09-04T01:46:00Z
  '09/04/2026 9:20 AM', '09/04/2026 9:18 AM', '09/04/2026 9:10 AM',
  '09/04/2026 9:10 AM', '09/04/2026 9:08 AM',
  '09/03/2026 8:46 PM', '09/03/2026 8:46 PM'   // the auto-welcome pair, same minute as creation
];
const BLASTS = [    // 19, every one predating the lead
  '04/21/2025 2:23 PM', '03/24/2025 10:08 AM', '09/30/2024 11:41 AM', '09/23/2024 9:02 AM',
  '08/27/2024 2:33 PM', '08/20/2024 2:30 PM',  '07/23/2024 8:34 AM',  '06/20/2024 3:16 PM',
  '06/13/2024 3:13 PM', '05/18/2024 4:35 PM',  '05/12/2024 8:55 AM',  '04/24/2024 8:02 PM',
  '04/17/2024 8:08 PM', '03/26/2024 11:20 AM', '03/22/2024 11:18 AM', '03/19/2024 11:21 AM',
  '02/15/2024 10:21 AM','11/17/2023 11:59 AM', '08/26/2023 1:00 PM'
];
const SHARON_CREATED = '2026-09-04T01:46:00';   // PageData Lead.LeadCreatedUTC, no zone suffix

// Runs the SHIPPED boundary block and then the SHIPPED increment over a list of note dates.
function tally(impl, createdUTC, dates) {
  const sb = { String, Date, RegExp, isNaN, console };
  vm.createContext(sb);
  sb._pdCreatedH = createdUTC;
  sb.sig = { leadOutboundCount: null, totalOutboundCount: 0 };
  vm.runInContext(impl.boundary, sb);
  // The real parseNoteDate's first move is `new Date(s).getTime()`, which handles every format
  // VinSolutions emits here; reproduced faithfully so the boundary is what is under test.
  sb.parseNoteDate = s => { const t = new Date(s).getTime(); return (!isNaN(t) && t > 0) ? t : null; };
  sb.DATES = dates;
  vm.runInContext(
    'DATES.forEach(function(dateStr){ sig.totalOutboundCount++; ' + impl.incr + ' });', sb);
  return vm.runInContext('({ lead: sig.leadOutboundCount, total: sig.totalOutboundCount })', sb);
}

function ladder(impl, sigFields, noteFallback) {
  const sb = { String, Object };
  vm.createContext(sb);
  vm.runInContext(impl.ladder, sb);
  sb.D = { relationshipSignals: sigFields };
  sb.NF = noteFallback;
  return vm.runInContext('_lpOutreachOnThisLead(D, NF)', sb);
}

// Runs the SHIPPED gate: is the incentive still suppressed as "first exposure"?
function gate(impl, firstTouchIn, sigFields, noteCount) {
  const logs = [];
  const sb = { String, Object, console: { log: (...a) => logs.push(a.join(' ')) } };
  vm.createContext(sb);
  vm.runInContext(impl.ladder, sb);
  sb.d = { relationshipSignals: sigFields, totalNoteCount: noteCount };
  vm.runInContext('var _incFirstTouch = ' + JSON.stringify(firstTouchIn) + ', _incFirstTouchReason = null;', sb);
  vm.runInContext(impl.gate, sb);
  return { suppressed: vm.runInContext('_incFirstTouch', sb),
           reason: vm.runInContext('_incFirstTouchReason', sb), logs };
}

// Runs the SHIPPED money detector through the SHIPPED _lpCustomerSaid scoping helper.
function money(impl, lines) {
  const logs = [];
  const sb = { String, Date, RegExp, Array,
    concernScanLines: lines,
    // The real tapback/quoted-reply guard lives far outside this slice. Its reaction pattern is
    // copied VERBATIM from popup.js rather than approximated — a stub looser than production can
    // pass an assertion the shipped code would fail, which is how the v9.7.615 version of this
    // stub hid a guard that could never fire.
    _lpCustomerAuthoredPart: (raw) => {
      const m = String(raw).match(
        /^(?:[ \t]*(?:Received\s+(?:from|by)|Sent\s+(?:to|by))[ \t]*:[^\n]*\r?\n)*[ \t]*(Loved|Liked|Disliked|Laughed at|Emphasi[sz]ed|Questioned)\s+["“”']/i);
      return m ? { text: '', cutBy: 'iMessage Tapback reaction (' + m[1] + ')', cutAt: m[0].length - m[1].length }
               : { text: String(raw), cutBy: '', cutAt: -1 };
    },
    _lpD: (...x) => logs.push(x.join(' ')) };
  vm.createContext(sb);
  vm.runInContext(impl.money, sb);
  return { said: vm.runInContext('_lpCustSaidMoney', sb), logs };
}

console.log('\nv9.7.616 — count what happened on THIS lead, and read what THIS customer said');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── SHARON'S EXACT ARITHMETIC ───────────────────────────────────────────────
console.log("Sharon Pierre, 9/4 — 26 outbound on the record, 7 on the lead:");

const ALL = BLASTS.concat(ON_LEAD);

check('the whole record still tallies 26, unchanged',
  i => tally(i, SHARON_CREATED, ALL).total, 26);
check('the lead-bounded count is 7 — the touches since she became a lead',
  i => tally(i, SHARON_CREATED, ALL).lead, 7);
check('all 19 blasts are excluded',
  i => tally(i, SHARON_CREATED, ALL).total - tally(i, SHARON_CREATED, ALL).lead, 19);
check('the auto-welcome pair sent in the SAME MINUTE as creation is KEPT, not lost to rounding',
  i => tally(i, SHARON_CREATED, ['09/03/2026 8:46 PM', '09/03/2026 8:46 PM']).lead, 2);
check('a blast on its own contributes nothing to the lead count',
  i => tally(i, SHARON_CREATED, BLASTS).lead, 0);
check('...while still counting on the record, so nothing is being hidden',
  i => tally(i, SHARON_CREATED, BLASTS).total, 19);

// THE UTC BUG THIS ALMOST HAD. PageData emits "2026-09-04T01:46:00" with no zone suffix, and V8
// reads a bare ISO datetime as LOCAL. Without the 'Z' the boundary lands five hours late on a
// Central machine and silently eats this lead's own first touches.
check('the creation stamp is read as UTC — 01:46Z is 8:46 PM Central the day before',
  i => tally(i, SHARON_CREATED, ['09/03/2026 8:46 PM']).lead, 1);
check('...and a stamp that already carries a zone is not double-suffixed',
  i => tally(i, '2026-09-04T01:46:00Z', ['09/03/2026 8:46 PM']).lead, 1);
check('...an explicit offset is honoured too',
  i => tally(i, '2026-09-03T20:46:00-05:00', ['09/03/2026 8:46 PM']).lead, 1);

// ── FAIL CLOSED WHEN THE BOUNDARY IS UNKNOWN ────────────────────────────────
// An unbounded count is today's behaviour and is merely wrong. An unbounded count REPORTED as
// bounded would be a lie, and would then unlock the incentive gate below on false evidence.
console.log('\nno creation stamp → no claim, and the ladder falls back:');

check('no stamp leaves the lead count null rather than guessing',
  i => tally(i, '', ALL).lead, null);
check('an unparseable stamp also leaves it null',
  i => tally(i, 'not-a-date', ALL).lead, null);
check('...and the record tally is untouched in both cases',
  i => tally(i, 'not-a-date', ALL).total, 26);

check('the ladder prefers the lead-bounded count when it exists',
  i => ladder(i, { leadOutboundCount: 7, totalOutboundCount: 26 }, 39),
  { n: 7, src: 'lead-bounded-outbound' });
check('...falls back to v9.7.592\'s whole-record tally when it does not',
  i => ladder(i, { leadOutboundCount: null, totalOutboundCount: 26 }, 39),
  { n: 26, src: 'outbound-count' });
check('...and to the note count when neither is available, exactly as before',
  i => ladder(i, {}, 39), { n: 39, src: 'note-count-fallback' });
check('a lead-bounded ZERO is honoured, not mistaken for absent',
  i => ladder(i, { leadOutboundCount: 0, totalOutboundCount: 26 }, 39),
  { n: 0, src: 'lead-bounded-outbound' });

// ── WHAT THE DIRECTIVES NOW SAY ON SHARON ───────────────────────────────────
console.log('\nthe gates move onto the true number:');
check('VARY YOUR ANGLE still fires on 7 — it is a real cadence and worth varying',
  i => ladder(i, { leadOutboundCount: 7 }, 39).n >= 5, true);
check('ONE-SIDED CONVERSATION no longer fires — 7 is not 26, and she is 13 hours old',
  i => ladder(i, { leadOutboundCount: 7 }, 39).n >= 8, false);
check('...but it DOES still fire on a genuinely worked lead',
  i => ladder(i, { leadOutboundCount: 11 }, 39).n >= 8, true);

// ── THE INCENTIVE GATE ──────────────────────────────────────────────────────
console.log('\nSharon\'s suppressed Kia programs — "first exposure" after seven messages:');

check('7 outreaches on the lead releases the first-touch suppression',
  i => gate(i, true, { leadOutboundCount: 7 }, 39).suppressed, false);
check('...and records WHY, alongside the existing asked/generic/in_transit reasons',
  i => gate(i, true, { leadOutboundCount: 7 }, 39).reason, 'prior_outreach');
check('...and says so in the log rather than changing behaviour silently',
  i => /first-touch override — 7 outreach\(es\) already sent ON THIS LEAD/
        .test(gate(i, true, { leadOutboundCount: 7 }, 39).logs.join(' ')), true);

check('a genuine first touch is still suppressed — 0 prior outreach',
  i => gate(i, true, { leadOutboundCount: 0 }, 4).suppressed, true);
check('...and 2 is still "light / fresh territory", still suppressed',
  i => gate(i, true, { leadOutboundCount: 2 }, 4).suppressed, true);
check('3 is the boundary the prompt\'s own density bands already use',
  i => gate(i, true, { leadOutboundCount: 3 }, 4).suppressed, false);

// The whole point of shipping Fix 2 and Fix 4 together.
check('BLAST MARKETING CANNOT UNLOCK AN INCENTIVE — an unbounded 26 does not release the gate',
  i => gate(i, true, { leadOutboundCount: null, totalOutboundCount: 26 }, 39).suppressed, true);
check('...nor can a bare note count',
  i => gate(i, true, {}, 39).suppressed, true);
check('a lead that was never first-touch is left exactly as it was',
  i => gate(i, false, { leadOutboundCount: 7 }, 39).reason, null);

// ── THE PHANTOM BUDGET ──────────────────────────────────────────────────────
console.log('\nthe budget neither customer ever stated:');

const TRICIA_TRUECAR = '[09/04/2026 8:05 AM] [AGENT] By: System *** DEALER PORTAL *** LEAD: MARKETPLACE (USED) *** VEHICLE: 2023 Kia EV6 Wind RWD | Steel Gray / BLACK OFFER SHOWN: $25,815 | RATING: FAIR PRICE ($301 below market avg)';
const SHARON_BLAST   = '[09/30/2024 11:41 AM] [AGENT] Ending Soon: Check out our September Savings Spectacular SALE at Community Kia and save on a brand new KIA! Get a select new KIA as low as $20,074 MPR to well-qualified buyers!';
const SHARON_EV9     = '[03/26/2024 11:20 AM] [AGENT] Get the 2024 Kia EV9 for $750 deposit + $5000 finance rebate.';
const REAL_ASK       = '[09/04/2026 9:30 AM] [CUSTOMER] What would my out the door price be on the Sportage?';
const REAL_CASH      = '[09/04/2026 9:30 AM] [CUSTOMER] I have about 5000 cash to put down';
// The OTD sheet we sent, returned as an iMessage reaction — our own words wearing a customer tag.
// In the form the SHIPPED guard recognises, with the CRM routing header v9.7.590 allowed for.
const TAPBACK_SHEET  = '[09/04/2026 9:31 AM] [CUSTOMER] Received from: (281) 918-1617\n  Liked “Drive Out with all Incentives $35,142.17”';

check('Tricia — TrueCar\'s "OFFER SHOWN: $25,815" is not her stating a budget',
  i => money(i, [TRICIA_TRUECAR]).said, false);
check('Sharon — our own "$20,074 MPR" blast is not her stating a budget',
  i => money(i, [SHARON_BLAST]).said, false);
check('...nor is our "$750 deposit + $5000 finance rebate" EV9 blast',
  i => money(i, [SHARON_EV9]).said, false);
check('all nineteen blasts together still say nothing about what she wants to pay',
  i => money(i, BLASTS.map((d, n) => '[' + d + '] [AGENT] ' + SHARON_BLAST)).said, false);

check('a customer actually asking for an OTD number DOES fire it',
  i => money(i, [SHARON_BLAST, REAL_ASK]).said, true);
check('...and so does a customer naming cash down',
  i => money(i, [TRICIA_TRUECAR, REAL_CASH]).said, true);
check('our own price sheet thumbs-up\'d back to us is still ours, not hers',
  i => money(i, [TAPBACK_SHEET]).said, false);
check('a lead with no customer text at all cannot have stated a budget',
  i => money(i, []).said, false);

check('the diagnostic reports the verdict and how many customer lines it read',
  i => /customerSaidMoney:false \| customerLines:0/.test(money(i, [SHARON_BLAST]).logs.join(' ')), true);
check('...and quotes the customer line when it DOES fire, so a fire is checkable',
  i => /hit:"What would my out the door price be on the Sportage\?"/
        .test(money(i, [REAL_ASK]).logs.join(' ')), true);

// The pattern itself must be untouched — this build changes whose words are read, not what counts.
console.log('\nthe money pattern is unchanged — only whose words it reads:');
for (const [label, text] of [['cash', 'I can pay cash'], ['offer', 'what is your best offer'],
                             ['a dollar figure', 'can you do $28,000'], ['OTD', 'what is the OTD'],
                             ['out the door', 'my out the door budget is tight']]) {
  check('  "' + label + '" still counts when the CUSTOMER says it',
    i => money(i, ['[09/04/2026 9:30 AM] [CUSTOMER] ' + text]).said, true);
  check('  ...and no longer counts when WE say it',
    i => money(i, ['[09/04/2026 9:30 AM] [AGENT] ' + text]).said, false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
