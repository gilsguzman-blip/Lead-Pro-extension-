#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('distance-appt-gate.test.js');

/**
 * distance-appt-gate.test.js — v9.7.611. TWO DIRECTIVES, OPPOSITE INSTRUCTIONS, ONE PROMPT.
 *
 * LIVE, 9/2. Lolita Lane, Audi Lafayette, lead 2049868669 — 54 days old, 39 outreaches, zero
 * replies, PHASE 5 graceful close-out. Her prompt told the model NOT to offer an appointment time
 * in FIVE separate places:
 *
 *   "🚫 ZERO-CONTACT LEAD — APPOINTMENT ENGINE DISABLED"
 *   "DO NOT include appointment times in ANY format"
 *   "⚠ NO APPOINTMENT TIME (UNLESS THE ARC SHOWS OTHERWISE)"
 *   PHASE 5: "DO NOT offer appointment times. DO NOT write duration."
 *   "HARD RULE: Do NOT offer appointment times ... to someone who has never responded"
 *
 * …while the DISTANCE BUYER block, unconditionally and in STRONGER language than any of those
 * prohibitions used, told it the opposite:
 *
 *   "REQUIRED in EVERY format: One specific reason the visit is worth their time"
 *   "SMS: 1 sentence justifying the trip is MANDATORY"
 *   "Email: Open with the vehicle/option confirmation, THEN the appointment ask."
 *
 * The model resolved it correctly and produced a clean close-out. That is the model being sensible
 * DESPITE the prompt — the same class as the Ford/Jeep pivot (v9.7.428) and the closed-day offer
 * (v9.7.481), where two directives disagreed about one thing and the wrong one happened to win.
 *
 * WHAT IS GATED: the scheduling half — the header's "visit ask", the in-state "invite it" clause,
 * and the email's "THEN the appointment ask".
 * WHAT IS NOT: the justification. "One specific reason the visit is worth their time" is the whole
 * point of the distance treatment and has nothing to do with scheduling. It stays mandatory in
 * every format, engine on or off. A distance buyer must never feel they might drive far for
 * nothing.
 *
 * OUT OF SCOPE AND ASSERTED UNTOUCHED: the OTD PRICING block's appointment language. That is the
 * pricing area Gil settled — "it's on the agent to work, they have the facts" — and this build
 * does not go near it.
 *
 * Executes the SHIPPED block. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: distance-appt-gate.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    var _dbApptOff = (function () {');
  if (a < 0) throw new Error('_dbApptOff gate not found');
  const endMark = "        '');";
  const b = src.indexOf(endMark, src.indexOf("'- Never make the distance buyer feel", a));
  if (b < 0) throw new Error('distance block end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

// Run the shipped block with a real `data` shape and collect the lines it pushes.
function build(impl, data, opts) {
  opts = opts || {};
  const logs = [];
  const sb = {
    String, parseFloat, JSON,
    data: data,
    lines: [],
    _inStateFar: !!opts.inStateFar,
    // (v9.7.631) The block gained a SECOND gate — the sold-unit fact arbitration — declared
    // above this slice and read inside it. Supplied here as an explicit input, the same way
    // _inStateFar and distanceContext already are. It defaults to FALSE, which is the state
    // every pre-existing case in this suite is in, so none of them changed meaning. The two
    // gates are orthogonal and the case at the end of this file pins that they stay so.
    _dbSoldUnit: !!opts.soldUnit,
    distanceContext: opts.distanceContext || '',
    _hasCustomerReplied: opts.replied === undefined ? undefined : () => !!opts.replied,
    console: { log: (...x) => logs.push(x.join(' ')) }
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { lines: vm.runInContext('lines', sb).filter(Boolean), logs };
}
const text = r => r.lines.join('\n');

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

// Lolita's real lead shape: 54 days, never replied, zero-contact stalled, in-state distance buyer.
const LOLITA = { leadAgeDays: 54, _isStalled: true, _neverReplied: true };
// A live lead: engaged customer, distance buyer, appointment engine on.
const LIVE   = { leadAgeDays: 4, _isStalled: false, _neverReplied: false };

console.log('\nv9.7.611 — the distance block no longer contradicts the appointment engine');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── LOLITA'S EXACT CASE ─────────────────────────────────────────────────────
console.log("Lolita Lane, 9/2 — distance buyer, appointment engine disabled:");

check('the gate reads the engine as OFF',
  i => /apptEngineOff:true/.test(build(i, LOLITA, { inStateFar: true }).logs.join(' ')), true);

check('the JUSTIFICATION requirement still appears — this is not what was wrong',
  i => /REQUIRED in EVERY format: One specific reason the visit is worth their time/
        .test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('...and the SMS justification stays MANDATORY',
  i => /SMS: 1 sentence justifying the trip is MANDATORY/
        .test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('the email no longer says to close with the appointment ask',
  i => /THEN the appointment ask/.test(text(build(i, LOLITA, { inStateFar: true }))), false);

check('...it says the opposite, and names why',
  i => /Do NOT close with an appointment ask or a time/
        .test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('the in-state clause no longer tells it to invite them in',
  i => /invite it once you have given them a concrete reason/
        .test(text(build(i, LOLITA, { inStateFar: true }))), false);

check('...and says not to invite on this touch instead',
  i => /Do NOT invite them in on this touch/.test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('the header stops mandating a "visit ask"',
  i => /The visit ask must be worth their time/.test(text(build(i, LOLITA, { inStateFar: true }))), false);

check('...while still demanding the ask be worth their time',
  i => /Whatever you ask of them must be worth their time/
        .test(text(build(i, LOLITA, { inStateFar: true }))), true);

// ── THE ENGINE-ON PATH IS BYTE-FOR-BYTE UNCHANGED ───────────────────────────
// The risk of this change is breaking the ordinary distance buyer, who SHOULD be asked in.
console.log('\nan engaged distance buyer is asked in exactly as before:');

check('the gate reads the engine as ON',
  i => /apptEngineOff:false/.test(build(i, LIVE, { inStateFar: true, replied: true }).logs.join(' ')), true);

check('the email still closes with the appointment ask',
  i => /Open with the vehicle\/option confirmation, THEN the appointment ask/
        .test(text(build(i, LIVE, { inStateFar: true, replied: true }))), true);

check('the in-state clause still invites them in',
  i => /invite it once you have given them a concrete reason/
        .test(text(build(i, LIVE, { inStateFar: true, replied: true }))), true);

check('the header still frames it as a visit ask',
  i => /The visit ask must be worth their time/
        .test(text(build(i, LIVE, { inStateFar: true, replied: true }))), true);

check('and none of the suppression wording leaks into the live path',
  i => /Do NOT invite them in on this touch|Do NOT close with an appointment ask/
        .test(text(build(i, LIVE, { inStateFar: true, replied: true }))), false);

// ── EACH INPUT TO THE GATE, INDEPENDENTLY ───────────────────────────────────
console.log('\neach condition that disables the engine, on its own:');

check('zero-contact stalled alone disables it, at any age',
  i => /apptEngineOff:true/.test(build(i, { leadAgeDays: 3, _isStalled: true, _neverReplied: true }).logs.join(' ')), true);

check('a 31-day lead with no reply disables it',
  i => /apptEngineOff:true/.test(build(i, { leadAgeDays: 31 }).logs.join(' ')), true);

check('a 30-day lead with no reply does NOT — the boundary matches the directive above it',
  i => /apptEngineOff:false/.test(build(i, { leadAgeDays: 30 }).logs.join(' ')), true);

check('a REPLY re-enables it even on an old stalled lead — the customer answered',
  i => /apptEngineOff:false/.test(build(i, LOLITA, { replied: true }).logs.join(' ')), true);

// ── ROBUSTNESS: THE v9.7.422 SHAPE THIS GATE DELIBERATELY AVOIDS ────────────
console.log('\nthe gate cannot be undefined or throw — it reads data, not a hoisted var:');

check('an empty lead object is handled',
  i => /apptEngineOff:false/.test(build(i, {}).logs.join(' ')), true);
check('a missing _hasCustomerReplied helper does not throw',
  i => build(i, LOLITA, { replied: undefined }).lines.length > 0, true);
check('a non-numeric leadAgeDays does not throw',
  i => /apptEngineOff:/.test(build(i, { leadAgeDays: 'nonsense' }).logs.join(' ')), true);

// ── SCOPE: THE OTD BLOCK IS NOT TOUCHED ─────────────────────────────────────
console.log('\nout of scope, and asserted so:');

check('the OTD block still closes with two appointment times',
  i => /\(5\) Close with two specific appointment times\./.test(i.src), true);
check('...and still says to close again with a time on pushback',
  i => /then close again with a time/.test(i.src), true);

// ── (v9.7.631) THE TWO GATES ARE INDEPENDENT ────────────────────────────────
// This block now carries two of them — the v9.7.611 appointment gate and the v9.7.631 sold-unit
// fact arbitration — and they modify overlapping lines. Two gates on one block is how a build
// accidentally makes one imply the other, so all four combinations are pinned here rather than
// left to be discovered. The suite that owns the sold gate (fact-arbitration) covers its wording;
// what is asserted here is only that neither gate moves the other.
console.log('\nthe appointment gate and the sold gate do not interfere:');
const fresh = { leadAgeDays: 0, _isStalled: false, _neverReplied: false };
const stale = { leadAgeDays: 45, _isStalled: true, _neverReplied: true };
check('sold does not switch the appointment engine off',
  i => /apptEngineOff:false/.test(build(i, fresh, { soldUnit: true }).logs.join(' ')), true);
check('...and not-sold does not switch it on',
  i => /apptEngineOff:true/.test(build(i, stale, { soldUnit: false }).logs.join(' ')), true);
check('an appointment-off lead with an available unit still promises it is ready',
  i => /I will have everything ready when you arrive/.test(text(build(i, stale, { soldUnit: false }))), true);
check('...and a sold unit drops that promise even when the engine is ON',
  i => /I will have everything ready when you arrive/.test(text(build(i, fresh, { soldUnit: true }))), false);
check('both gates at once: no appointment ask AND no availability promise',
  i => {
    const t = text(build(i, stale, { soldUnit: true }));
    return /Do NOT close with an appointment ask/.test(t)
        && !/I will have everything ready when you arrive/.test(t)
        && /anchored on a CONFIRMED alternative/.test(t);
  }, true);
check('...and the justification survives both, which is the point of each split',
  i => /REQUIRED in EVERY format/.test(text(build(i, stale, { soldUnit: true }))), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
