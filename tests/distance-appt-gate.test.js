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
  // (v9.7.654) Two more spans travel with the gate. _lpPauseHold is the helper the gate reads —
  // lifted from the SHIPPED file rather than restated here, so the suite cannot certify a
  // predicate the build does not actually use. The distanceContext chain sits ABOVE the gate's
  // slice and carries the third visit-ask on this block ("encourage the soonest workable time"),
  // so it needs its own span; it is small and self-contained.
  // (v9.7.655) DELIBERATE CHANGE TO A v9.7.654 LIFT. _lpPauseHold became _lpTouchHold and now
  // returns the REASON, and the engine predicate was hoisted out of the block's own IIFE into
  // _lpApptEngineOff so the distanceContext chain (which runs earlier in the function) can read
  // it. Both travel with the block. Every behavioural pause assertion below is unchanged.
  const span = (mark, what) => {
    const a2 = src.indexOf(mark);
    if (a2 < 0) throw new Error(what + ' not found');
    const b2 = src.indexOf('\n}\n', a2);
    if (b2 < 0) throw new Error(what + ' end not found');
    return src.slice(a2, b2 + 2);
  };
  const pauseSrc = span('function _lpTouchHold(d) {', '_lpTouchHold')
    + '\n' + span('function _lpApptEngineOff(d) {', '_lpApptEngineOff');
  // The fourth hand-rolled copy of the exit-or-pause union, now reading the helper.
  const da = src.indexOf('        var _ddExitPause = (typeof _lpTouchHold === \'function\')');
  if (da < 0) throw new Error('_ddExitPause consolidation not found');
  const dEnd = src.indexOf(';\n', da);
  const ddSrc = src.slice(da, dEnd + 1);
  // (v9.7.655) The chain now opens with the exit arm rather than the credit arm, because the
  // credit arm ends "before asking them to drive" and is just as wrong on a goodbye.
  const ca = src.indexOf("    if ((typeof _lpTouchHold === 'function') && _lpTouchHold(data) === 'exit') {");
  if (ca < 0) throw new Error('distanceContext chain not found');
  const cb = src.indexOf('\n    if (isRemoteBuyer) {', ca);
  if (cb < 0) throw new Error('distanceContext chain end not found');
  return {
    name: path.basename(path.dirname(file)), src,
    code: src.slice(a, b + endMark.length),
    pause: pauseSrc,
    dd: ddSrc,
    ctx: src.slice(ca, cb)
  };
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
  // (v9.7.654) The SHIPPED helper is loaded for every case, including the twenty-three that
  // predate it. None of their fixtures carries a convState, so all of them read false and their
  // output is byte-identical — which is the point: the guard runs on the old cases too.
  vm.runInContext(holds(impl, opts), sb);
  vm.runInContext(impl.code, sb);
  return { lines: vm.runInContext('lines', sb).filter(Boolean), logs };
}

// (v9.7.655) The two shipped helpers, optionally neutered. pauseOff pins the hold to none;
// engineOff pins the engine predicate to false. Each is asserted to actually change the source
// before it is relied on.
const HOLD_OFF   = "if (c === 'exit'  || !!(d && d.hasExitSignal))  return 'exit';";
const ENGINE_OFF = 'function _lpApptEngineOff(d) {';
function holds(impl, opts) {
  let p = impl.pause;
  if (opts && opts.pauseOff)  p = p.replace(HOLD_OFF, '').replace("if (c === 'pause' || !!(d && d.hasPauseSignal)) return 'pause';", '');
  if (opts && opts.engineOff) p = p.replace(ENGINE_OFF, ENGINE_OFF + ' return false;');
  return p;
}

// (v9.7.654) The distanceContext chain, executed on its own. It runs BEFORE the gate in the
// shipped file and assigns the '- CONTEXT: ...' line the block appends at the end.
function context(impl, data, opts) {
  opts = opts || {};
  const sb = {
    String, parseFloat, data, flags: opts.flags || ['distance'],
    distanceContext: '', _dbSoldUnit: !!opts.soldUnit,
    // (v9.7.655) The chain now reaches _lpApptEngineOff, which reads this the same way the gate
    // does. Supplied here for the same reason and with the same default.
    _hasCustomerReplied: opts.replied === undefined ? undefined : () => !!opts.replied
  };
  vm.createContext(sb);
  vm.runInContext(holds(impl, opts), sb);
  vm.runInContext(impl.ctx, sb);
  return vm.runInContext('distanceContext', sb);
}

// (v9.7.655) The hold reason, read straight off the shipped helper.
function hold(impl, data) {
  const sb = { String, d: data, __out: null };
  vm.createContext(sb);
  vm.runInContext(impl.pause + '\n__out = _lpTouchHold(d);', sb);
  return sb.__out;
}

// (v9.7.655) The consolidated exit-or-pause predicate, executed on its own.
function ddExitPause(impl, data, opts) {
  const sb = { String, data, _ddConvLow: ((data && data.convState) || '').toLowerCase(), _ddExitPause: null };
  vm.createContext(sb);
  if (!(opts && opts.noHelper)) vm.runInContext(impl.pause, sb);
  vm.runInContext(impl.dd, sb);
  return vm.runInContext('_ddExitPause', sb);
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

// ── (v9.7.654) PAUSE OWNS WHETHER THIS TOUCH MAY ASK FOR ANYTHING ──────────
// Antonio Cadena, Community Kia Baytown, lead 2079566626, 9/10. Alyssa's 3:48 PM note — "Said he
// will let me know when he can come down" — put the lead in convState 'pause', and the prompt
// duly carried "CUSTOMER NEEDS SPACE — NO PUSH ... Do NOT offer an appointment. NO QUESTIONS of
// any kind." THIS block, 3,000 characters later and in stronger wording, carried "REQUIRED in
// EVERY format", "1 sentence justifying the trip is MANDATORY", "THEN the appointment ask" and a
// CONTEXT line telling the model to "encourage the soonest workable time".
//
// v9.7.611 gated this same text on the appointment engine. Its gate tests stalled and
// never-replied; it does not test pause, and pause is the state that owns the pressure ceiling.
console.log('\nAntonio Cadena, 9/10 — a paused distance buyer:');
const PAUSED = { leadAgeDays: 3, _isStalled: false, _neverReplied: false, convState: 'pause', vehicle: '2022 Ram 1500 Laramie' };

check('the gate reads the engine as OFF on a paused lead',
  i => /apptEngineOff:true/.test(build(i, PAUSED, { inStateFar: true, replied: true }).logs.join(' ')), true);

// THE ORDERING IS THE FIX. A paused lead has replied by definition — that is how we know they
// want room — so a pause test placed after the _dbReplied short-circuit would be dead code on
// every lead it exists for. This case is that assertion: replied:true and the engine still off.
check('...even though the customer HAS replied, which is what pause means',
  i => /apptEngineOff:true/.test(build(i, PAUSED, { replied: true }).logs.join(' ')), true);

// (v9.7.655) CHANGED DELIBERATELY FROM pauseHold:true. The hold now carries a reason, because
// "pauseHold" was about to read false on an exiting lead that is held HARDER than a paused one.
// Same property, stated more precisely.
check('the log reports the hold and names it as pause',
  i => /hold:pause/.test(build(i, PAUSED, { replied: true }).logs.join(' ')), true);

check('the email no longer closes with the appointment ask',
  i => /THEN the appointment ask/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), false);

check('the in-state clause no longer invites them in',
  i => /invite it once you have given them a concrete reason/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), false);

check('the header stops mandating a visit ask',
  i => /The visit ask must be worth their time/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), false);

// The v9.7.611 split holds: the JUSTIFICATION is not scheduling and a distance buyer must never
// feel they might drive far for nothing, paused or not.
check('the SMS justification is still MANDATORY — the split is deliberate',
  i => /SMS: 1 sentence justifying the trip is MANDATORY/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), true);

check('...and so is the every-format requirement',
  i => /REQUIRED in EVERY format: One specific reason the visit is worth their time/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), true);

// A directive that asserts a fact it does not own is the failure this build fixes elsewhere, so
// the reason clause has to be true on the lead it is printed on.
console.log('\nthe stated reason has to be true on the lead it prints on:');

check('a paused lead is told the PAUSE directives forbid the ask',
  i => /the PAUSE directives on this lead forbid an appointment ask/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), true);

check('...and is NOT told the appointment engine is disabled, which is false here',
  i => /the appointment engine is disabled for this lead/.test(text(build(i, PAUSED, { inStateFar: true, replied: true }))), false);

check('Lolita keeps her original wording, to the byte',
  i => /Do NOT invite them in on this touch — the appointment engine is disabled for this lead, and the pre-staging is context for when they are ready, not an ask\./.test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('...and her log reports no hold at all — she is engine-off, not held',
  i => /hold:none/.test(build(i, LOLITA, { inStateFar: true }).logs.join(' ')), true);

// ── WHAT THE HELPER READS ───────────────────────────────────────────────────
// hasPauseSignal is a hard-coded false since v9.7.189 and the live signal reaches the prompt only
// as convState. The flag is still tested as a second door in case a later path sets it truthy.
console.log('\nthe pause hold reads the field that actually carries the state:');

check('convState pause holds', i => /apptEngineOff:true/.test(build(i, { convState: 'pause' }).logs.join(' ')), true);
check('case does not matter', i => /apptEngineOff:true/.test(build(i, { convState: 'PAUSE' }).logs.join(' ')), true);
check('hasPauseSignal alone holds', i => /apptEngineOff:true/.test(build(i, { hasPauseSignal: true }).logs.join(' ')), true);
check('an ordinary follow-up does not', i => /apptEngineOff:false/.test(build(i, { convState: 'active-follow-up' }).logs.join(' ')), true);
// (v9.7.655) INVERTED DELIBERATELY. This assertion existed to record that exit was a known,
// named gap v9.7.654 chose not to close. It is closed now, so the assertion states the new rule
// rather than the old omission.
check('an exit lead IS held — the gap v9.7.654 recorded here is closed',
  i => /apptEngineOff:true/.test(build(i, { convState: 'exit' }).logs.join(' ')), true);
check('a lead with no convState at all does not throw',
  i => /apptEngineOff:false/.test(build(i, {}).logs.join(' ')), true);

// ── THE THIRD VISIT-ASK ON THIS BLOCK ───────────────────────────────────────
console.log('\nthe CONTEXT line stops naming a time on a paused lead:');

check('a normal distance buyer still gets the v9.7.611 wording, unchanged',
  i => context(i, { vehicle: '2022 Ram 1500 Laramie', leadAgeDays: 4 }),
  'Customer is interested in the 2022 Ram 1500 Laramie. Confirm it is available and encourage the soonest workable time so the trip is worth it — do NOT promise to hold or set aside an in-stock unit (we do not reserve on-lot cars). If it is in transit/inbound, securing it before arrival is appropriate.');

check('a paused lead is not told to encourage the soonest workable time',
  i => /encourage the soonest workable time/.test(context(i, PAUSED)), false);

check('...it is told the opposite, and why',
  i => /Do NOT encourage a time, a visit or the soonest workable anything on this touch/.test(context(i, PAUSED)), true);

check('availability is still stated — that is a fact this block may state',
  i => /Confirming it is here is fine and worth saying/.test(context(i, PAUSED)), true);

check('the no-hold rule survives the pause arm',
  i => /do NOT promise to hold or set aside an in-stock unit/.test(context(i, PAUSED)), true);

check('a SOLD unit still wins over the pause arm — a sold car is never claimed available',
  i => /is SOLD/.test(context(i, PAUSED, { soldUnit: true })), true);

check('a lead with no vehicle produces no CONTEXT line at all',
  i => context(i, { convState: 'pause' }), '');

console.log('\nnon-vacuity (v9.7.654):');

check('neuter D actually pinned the hold off',
  i => holds(i, { pauseOff: true }) !== i.pause, true);
check('D: a paused lead gets its appointment ask back',
  i => /THEN the appointment ask/.test(text(build(i, PAUSED, { inStateFar: true, replied: true, pauseOff: true }))), true);
check('D: ...and the invite clause with it',
  i => /invite it once you have given them a concrete reason/.test(text(build(i, PAUSED, { inStateFar: true, replied: true, pauseOff: true }))), true);
check('D: ...and the CONTEXT line names a time again',
  i => /encourage the soonest workable time/.test(context(i, PAUSED, { pauseOff: true })), true);
check('D (control): the shipped helper suppresses all three',
  i => {
    const t = text(build(i, PAUSED, { inStateFar: true, replied: true }));
    return !/THEN the appointment ask/.test(t)
        && !/invite it once you have given them a concrete reason/.test(t)
        && !/encourage the soonest workable time/.test(context(i, PAUSED));
  }, true);

// ── (v9.7.655) THE TWO PATHS v9.7.654 GATED THE OTHER THREE CLAUSES FOR, BUT NOT THIS LINE ──
// v9.7.611 gated the header, the in-state invite clause and the email ask on the appointment
// engine. The CONTEXT line was never gated, so on a zero-contact or reactivation lead three
// clauses said no appointment and a fourth said "encourage the soonest workable time". Each path
// was checked against the directive that owns it rather than assumed from the pause fix.
console.log('\nzero-contact — the CONTEXT line stops naming a time:');
const LOLITA_V = { leadAgeDays: 54, _isStalled: true, _neverReplied: true, vehicle: '2022 Ram 1500 Laramie' };

check('the CONTEXT line no longer tells a never-replied lead to encourage a time',
  i => /encourage the soonest workable time/.test(context(i, LOLITA_V)), false);

check('...it says the opposite',
  i => /Do NOT encourage a time, a visit or the soonest workable anything on this touch/.test(context(i, LOLITA_V)), true);

// The ZERO-CONTACT block states "DO NOT include appointment times in ANY format", so the engine
// really is the owner here and naming it is true.
check('...and names the appointment engine, which is what is true of her',
  i => /every other directive on this lead disables the appointment engine/.test(context(i, LOLITA_V)), true);

check('...and does NOT claim she asked for room, which she never did',
  i => /PAUSE state/.test(context(i, LOLITA_V)), false);

check('the no-hold rule survives the rewrite',
  i => /do NOT promise to hold or set aside an in-stock unit/.test(context(i, LOLITA_V)), true);

// v9.7.611's split is re-examined and upheld, not inherited: she may still come in.
check('the justification requirement still ships on a zero-contact lead',
  i => /REQUIRED in EVERY format: One specific reason the visit is worth their time/.test(text(build(i, LOLITA, { inStateFar: true }))), true);

check('...and the mandatory SMS sentence with it',
  i => /SMS: 1 sentence justifying the trip is MANDATORY/.test(text(build(i, LOLITA, { inStateFar: true }))), true);

console.log('\nreactivation — same directive, same answer:');
const REACT = { leadAgeDays: 45, _isStalled: false, _neverReplied: false, vehicle: '2022 Ram 1500 Laramie' };

check('a 45-day lead with no reply reads the engine as off',
  i => /apptEngineOff:true/.test(build(i, REACT).logs.join(' ')), true);

check('its CONTEXT line drops the time',
  i => /encourage the soonest workable time/.test(context(i, REACT)), false);

check('...and names the engine',
  i => /every other directive on this lead disables the appointment engine/.test(context(i, REACT)), true);

check('the justification still ships on a reactivation lead too',
  i => /REQUIRED in EVERY format: One specific reason the visit is worth their time/.test(text(build(i, REACT, { inStateFar: true }))), true);

// ── THE ARM THAT DELIBERATELY PERMITS A TIME IS UNTOUCHED ───────────────────
// The 31-day block has a second arm — SOFT TIME CLOSE ONLY — for a long-gap lead that HAS
// replied, and it explicitly allows a tentative time. The reply short-circuit already leaves the
// engine on for it. Breaking that is the real risk of this change, so it is pinned.
console.log('\nthe soft-time-close arm still gets its time:');

check('a 45-day lead that HAS replied keeps the engine on',
  i => /apptEngineOff:false/.test(build(i, REACT, { replied: true }).logs.join(' ')), true);

check('...and its CONTEXT line is the original v9.7.611 wording, to the byte',
  i => context(i, REACT, { replied: true }),
  'Customer is interested in the 2022 Ram 1500 Laramie. Confirm it is available and encourage the soonest workable time so the trip is worth it — do NOT promise to hold or set aside an in-stock unit (we do not reserve on-lot cars). If it is in transit/inbound, securing it before arrival is appropriate.');

check('...and its email still closes with the appointment ask',
  i => /Open with the vehicle\/option confirmation, THEN the appointment ask/.test(text(build(i, REACT, { inStateFar: true, replied: true }))), true);

check('the 30-day boundary still leaves the CONTEXT line alone',
  i => /encourage the soonest workable time/.test(context(i, { leadAgeDays: 30, vehicle: 'X' })), true);

check('...and 31 days does not',
  i => /encourage the soonest workable time/.test(context(i, { leadAgeDays: 31, vehicle: 'X' })), false);

// ── EXIT IS A DIFFERENT ANSWER, NOT A STRONGER ONE ──────────────────────────
// The exit directive this file ships reads: "write a gracious close only ... Do NOT pivot to
// alternatives, do NOT offer appointment times, do NOT ask ANY question ... They said no; respect
// it and end the message." The v9.7.611 reasoning for keeping the justification does not reach
// here: there is no trip to justify, because they are not coming.
console.log('\nan exiting distance buyer is asked for nothing at all:');
const EXITED = { leadAgeDays: 5, convState: 'exit', vehicle: '2022 Ram 1500 Laramie' };
const exitText = i => text(build(i, EXITED, { inStateFar: true, replied: true }));

check('the hold reads exit', i => hold(i, EXITED), 'exit');
check('the engine is off', i => /apptEngineOff:true/.test(build(i, EXITED, { replied: true }).logs.join(' ')), true);
check('the log names the reason', i => /hold:exit/.test(build(i, EXITED, { replied: true }).logs.join(' ')), true);

check('no CONTEXT line is produced at all — the exit directive owns the close',
  i => context(i, EXITED, { replied: true }), '');

check('the visit-justification requirement is withheld',
  i => /REQUIRED in EVERY format/.test(exitText(i)), false);

check('the mandatory SMS sentence is withheld',
  i => /1 sentence justifying the trip is MANDATORY/.test(exitText(i)), false);

check('neither email arm ships',
  i => /Open with the vehicle\/option confirmation/.test(exitText(i)), false);

check('none of the four worth-the-trip examples ship',
  i => /I will have everything ready when you arrive|pre-fill most of the paperwork|trade-in numbers ready before you arrive|staged and ready specifically for you/.test(exitText(i)), false);

check('the drive-far-for-nothing line goes too — there is no drive',
  i => /might drive far for nothing/.test(exitText(i)), false);

// A directive block that simply goes quiet invites the model to fill the gap.
check('the withholding is stated rather than left as an absence',
  i => /THIS LEAD IS EXITING\. The EXIT directive owns this message/.test(exitText(i)), true);

check('the header says there is nothing to ask',
  i => /There is nothing to ask of them on this touch/.test(exitText(i)), true);

// What MUST survive: a goodbye that mentions the drive they are now not making is worse.
check('the DISTANCE HARD RULE survives — never name the miles or the drive',
  i => /do NOT name the miles, the drive, the trip, or the travel in ANY wording/.test(exitText(i)), true);

check('...and so does the stop-by prohibition',
  i => /NEVER say "stop by", "swing by", or "come see us"/.test(exitText(i)), true);

check('the in-state clause says the hard rule is ALL it means on this touch',
  i => /On this touch that is ALL it means: the distance stays a silent fact, and there is nothing to pre-stage and nobody to invite, because this lead is exiting/.test(exitText(i)), true);

// FOUND BY RENDERING THE BLOCK, NOT BY READING THE DIFF: the first version appended the
// prohibition to a sentence whose own first half instructs the model to pre-stage, so one line
// told it to do and not do the same thing. The exit arm is the whole clause now.
check('...and does NOT also tell it to pre-stage, which the live arm does',
  i => /make what you offer obviously worth their time with concrete pre-staging/.test(exitText(i)), false);

check('...nor promise that the reason names what is ready for them',
  i => /The reason names what is READY FOR THEM/.test(exitText(i)), false);

check('...and does NOT promise a visit later, which the paused arm does',
  i => /the pre-staging is context for when they are ready/.test(exitText(i)), false);

check('a raw exit signal with no convState holds the same way',
  i => hold(i, { hasExitSignal: true }), 'exit');

check('exit beats pause when a lead carries both',
  i => hold(i, { convState: 'pause', hasExitSignal: true }), 'exit');

check('an exiting lead produces no CONTEXT line even with the credit flag up',
  i => context(i, EXITED, { replied: true, flags: ['distance', 'credit'] }), '');

check('...nor when the unit is sold',
  i => context(i, EXITED, { replied: true, soldUnit: true }), '');

// The credit arm ends "before asking them to drive", which is the same defect one clause over.
console.log('\nthe credit arm stops asking them to drive when the engine is off:');

check('an engine-off credit lead is told not to ask them in',
  i => /do NOT ask them to drive in on this touch/.test(context(i, LOLITA_V, { flags: ['distance', 'credit'] })), true);

check('a live credit lead keeps the original wording',
  i => context(i, { leadAgeDays: 4, vehicle: 'X' }, { flags: ['distance', 'credit'], replied: true }),
  'Customer has credit sensitivity AND is a distance buyer — the trip must feel financially worthwhile. Lead with financing confidence before asking them to drive.');

// ── THE HELPER ITSELF ───────────────────────────────────────────────────────
console.log('\nthe hold reads one field and returns one reason:');

check('an ordinary lead is not held', i => hold(i, { convState: 'active-follow-up' }), '');
check('case does not matter on exit', i => hold(i, { convState: 'EXIT' }), 'exit');
check('a raw pause flag still holds', i => hold(i, { hasPauseSignal: true }), 'pause');
check('degenerate input returns no hold',
  i => [hold(i, null), hold(i, undefined), hold(i, {})], ['', '', '']);

// ── THE FOURTH COPY OF THE SAME PREDICATE, RETIRED ──────────────────────────
// The deadline/deal-condition detector carried its own inline exit-or-pause union. Equivalence
// is proved across all sixteen combinations of the four inputs rather than by eye — a parallel
// hand-maintained definition of one question is the shape that produced v9.7.629/.630/.634/.635.
console.log('\nthe deadline detector reads the same predicate, provably:');
const COMBOS = [];
for (const cs of ['', 'exit', 'pause', 'active-follow-up']) {
  for (const es of [false, true]) {
    for (const ps of [false, true]) {
      COMBOS.push({ convState: cs, hasExitSignal: es, hasPauseSignal: ps });
    }
  }
}
const ORIGINAL = d => {
  const c = ((d && d.convState) || '').toLowerCase();
  return (c === 'exit' || c === 'pause' || !!(d && d.hasExitSignal) || !!(d && d.hasPauseSignal));
};

check('all 32 input combinations agree with the expression it replaced',
  i => COMBOS.filter(c => ddExitPause(i, c) !== ORIGINAL(c)).length, 0);

check('...and the fallback agrees too, if the helper is ever missing',
  i => COMBOS.filter(c => ddExitPause(i, c, { noHelper: true }) !== ORIGINAL(c)).length, 0);

check('it is genuinely exercised — some combinations are true and some false',
  i => {
    const t = COMBOS.filter(c => ddExitPause(i, c) === true).length;
    return t > 0 && t < COMBOS.length;
  }, true);

console.log('\nnon-vacuity (v9.7.655):');

check('neuter E actually pinned the engine predicate false',
  i => holds(i, { engineOff: true }) !== i.pause, true);
check('E: a zero-contact lead is told to encourage a time again',
  i => /encourage the soonest workable time/.test(context(i, LOLITA_V, { engineOff: true })), true);
check('E: and so is a reactivation lead',
  i => /encourage the soonest workable time/.test(context(i, REACT, { engineOff: true })), true);
check('E (control): the shipped predicate suppresses both',
  i => /encourage the soonest workable time/.test(context(i, LOLITA_V))
    || /encourage the soonest workable time/.test(context(i, REACT)), false);

check('F: pinning the hold off restores the whole visit apparatus to an exiting lead',
  i => {
    const t = text(build(i, EXITED, { inStateFar: true, replied: true, pauseOff: true }));
    return /REQUIRED in EVERY format/.test(t) && /1 sentence justifying the trip is MANDATORY/.test(t);
  }, true);
check('F (control): the shipped hold withholds both',
  i => {
    const t = exitText(i);
    return /REQUIRED in EVERY format/.test(t) || /1 sentence justifying the trip is MANDATORY/.test(t);
  }, false);
check('F: ...and gives the exiting lead its CONTEXT line back',
  i => context(i, EXITED, { replied: true, pauseOff: true }).length > 0, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
