#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('close-out-eligibility.test.js');

/**
 * close-out-eligibility.test.js — v9.7.595. ONE RULE FOR WHEN A LEAD MAY BE OFFERED A CLOSE-OUT.
 *
 * Gil, 8/27: "The close out is a combo of days and lack of response."
 *
 * ── FOUR GATES THAT DISAGREED ─────────────────────────────────────────────────────────────
 *   isStalled (scraper)          age >= 2
 *   director stall leg           age > 5 && !hasCustomerReply
 *   close-out floor (v9.7.593)   bans close-out at age <= 7
 *   PHASE 5 ladder               touch count >= 5, NO age check at all
 *
 * The last one is how Andrea Pardon reached a graceful close-out on a FOUR-DAY-OLD lead.
 * v9.7.583 measured that and deliberately did not change it, writing that re-thresholding the
 * fleet needed data first. The 8/27 feedback export is that data.
 *
 * ── WHAT THE DATA SAID ────────────────────────────────────────────────────────────────────
 * 8 of 21 rated drafts offered to close the lead out. The two Gil flagged as wrong were 2 days
 * and 9 days old. Every close-out he accepted was 41, 60, 63, 63 or 68 days. So the boundary
 * belongs in the gap the evidence actually shows — above 9, at or below 41.
 *
 * ── BOTH HALVES ARE REQUIRED ──────────────────────────────────────────────────────────────
 * That is the whole point of the rule. Age alone is not silence: a 25-day lead we touched twice
 * has not been worked. Silence alone is not age: five touches in three days is our own cadence
 * firing, which is exactly what produced Troy's day-1 close-out.
 *
 *   customer asked to stop    -> eligible at ANY age
 *   never replied             -> age >= 21 AND >= 5 real outreaches
 *   replied, then went quiet  -> >= 30 days since their last reply
 *
 * ── UNKNOWN IS NOT ELIGIBLE ───────────────────────────────────────────────────────────────
 * A close-out is the one message that cannot be walked back. Absence of evidence must not
 * authorise it, so any unreadable field returns not-eligible. This is the opposite of the
 * v9.7.586 defect, where an unavailable field became a positive claim about a customer.
 *
 * Driven against the SHIPPED resolver. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: close-out-eligibility.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sb = { String, RegExp, parseFloat, isNaN };
  vm.createContext(sb);
  for (const name of ['_lpCloseOutEligible', '_lpResolveDirectorMode']) {
    const h = src.indexOf('function ' + name + '(');
    if (h < 0) throw new Error(name + ' not found in ' + file);
    let d = 0, started = false, end = -1;
    for (let i = h; i < src.length; i++) {
      if (src[i] === '{') { d++; started = true; }
      else if (src[i] === '}') { d--; if (started && d === 0) { end = i + 1; break; } }
    }
    vm.runInContext(src.slice(h, end), sb);
  }
  return {
    name: path.basename(path.dirname(file)),
    src,
    elig: d => vm.runInContext('_lpCloseOutEligible', sb)(d),
    mode: d => vm.runInContext('_lpResolveDirectorMode', sb)(d)
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
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

// A lead as the resolver reads it.
const lead = (age, opts) => Object.assign({
  leadAgeDays: age, hasCustomerReply: false, convState: 'active-follow-up',
  relationshipSignals: { totalOutboundCount: 7, lastInboundAgeDays: null }
}, opts || {});
const ok = (i, d) => i.elig(d).eligible;

console.log('\nv9.7.595 — days AND lack of response, one rule, four consumers');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE REAL LEADS FROM THE 8/27 EXPORT ─────────────────────────────────────
// Every case below is a row from leadprofeedback_20260827. The two Gil flagged must now be
// blocked; the ones he accepted must still pass. This is the whole rule, stated as evidence.
console.log("the 8/27 export — the two Gil flagged as wrong:");

check('Jordyn, 2 days, never replied — BLOCKED',
  i => ok(i, lead(2, { relationshipSignals: { totalOutboundCount: 5, lastInboundAgeDays: null } })), false);

check('Tania, 9 days, never replied — BLOCKED',
  i => ok(i, lead(9, { relationshipSignals: { totalOutboundCount: 6, lastInboundAgeDays: null } })), false);

check("...and Troy's day-1 lead, the one that started this — BLOCKED",
  i => ok(i, lead(1, { relationshipSignals: { totalOutboundCount: 7, lastInboundAgeDays: null } })), false);

check('Andrea, 4 days at PHASE 5 touch count — BLOCKED (the v9.7.583 deferral)',
  i => ok(i, lead(4, { relationshipSignals: { totalOutboundCount: 5, lastInboundAgeDays: null } })), false);

console.log('\nthe ones Gil accepted — all must still be allowed:');
for (const age of [41, 60, 63, 68]) {
  check('  ' + age + ' days, never replied, 8 outreaches',
    i => ok(i, lead(age, { relationshipSignals: { totalOutboundCount: 8, lastInboundAgeDays: null } })), true);
}

// ── BOTH HALVES REQUIRED ────────────────────────────────────────────────────
console.log('\nage alone is not enough, and silence alone is not enough:');

check('25 days but only 2 outreaches — not worked, BLOCKED',
  i => ok(i, lead(25, { relationshipSignals: { totalOutboundCount: 2, lastInboundAgeDays: null } })), false);

check('12 outreaches but only 3 days old — our cadence, BLOCKED',
  i => ok(i, lead(3, { relationshipSignals: { totalOutboundCount: 12, lastInboundAgeDays: null } })), false);

check('21 days AND 5 outreaches — both met, ALLOWED',
  i => ok(i, lead(21, { relationshipSignals: { totalOutboundCount: 5, lastInboundAgeDays: null } })), true);

check('the boundary is inclusive on both — 20d/5 blocked, 21d/4 blocked',
  i => [ok(i, lead(20, { relationshipSignals: { totalOutboundCount: 5, lastInboundAgeDays: null } })),
        ok(i, lead(21, { relationshipSignals: { totalOutboundCount: 4, lastInboundAgeDays: null } }))],
  [false, false]);

// ── REPLIED THEN QUIET ──────────────────────────────────────────────────────
console.log('\na customer who actually engaged gets longer:');

const replied = (since) => lead(90, { hasCustomerReply: true,
  relationshipSignals: { totalOutboundCount: 9, lastInboundAgeDays: since } });

check('replied 30 days ago — ALLOWED',   i => ok(i, replied(30)), true);
check('replied 45 days ago — ALLOWED',   i => ok(i, replied(45)), true);
check('replied 29 days ago — BLOCKED',   i => ok(i, replied(29)), false);
check('replied 2 days ago — BLOCKED',    i => ok(i, replied(2)),  false);

check('a 90-day lead that replied last week is still BLOCKED — age does not override the reply',
  i => ok(i, replied(7)), false);

check("...which is the point: they engaged, so the clock is theirs, not the lead's",
  i => i.elig(replied(7)).reason.indexOf('30d quiet window') >= 0, true);

// ── THE CUSTOMER'S OWN EXIT ─────────────────────────────────────────────────
// This must stay first in the resolver. A person who asks to be left alone is never made to
// wait 21 days for us to agree with them.
console.log("\nthe customer's own exit always wins, at any age:");

check('an exit signal on a 1-day-old lead — ALLOWED',
  i => ok(i, lead(1, { hasExitSignal: true })), true);

check('a pause signal on a 1-day-old lead — ALLOWED',
  i => ok(i, lead(1, { hasPauseSignal: true })), true);

check('convState "exit" — ALLOWED',
  i => ok(i, lead(0, { convState: 'exit' })), true);

check('convState "pause" — ALLOWED',
  i => ok(i, lead(0, { convState: 'pause' })), true);

check('...and the reason names them, not us',
  i => i.elig(lead(1, { hasExitSignal: true })).reason, 'customer signalled exit or pause');

// ── UNKNOWN IS NOT ELIGIBLE ─────────────────────────────────────────────────
// The inverse of the v9.7.586 defect, where an unavailable field became a positive claim.
console.log('\nunknown never authorises a withdrawal:');

check('unknown lead age — BLOCKED',
  i => ok(i, lead(undefined, { relationshipSignals: { totalOutboundCount: 9, lastInboundAgeDays: null } })), false);

check('unknown outreach count on a never-replied lead — BLOCKED',
  i => ok(i, lead(60, { relationshipSignals: {} })), false);

check('replied but the reply date is unknown — BLOCKED',
  i => ok(i, lead(60, { hasCustomerReply: true, relationshipSignals: { totalOutboundCount: 9 } })), false);

check('a completely empty object — BLOCKED, and does not throw',
  i => ok(i, {}), false);

check('null and undefined — BLOCKED, and do not throw',
  i => [ok(i, null), ok(i, undefined)], [false, false]);

check('every not-eligible verdict carries a reason a human can read',
  i => [lead(2), lead(9), {}, lead(60, { relationshipSignals: {} })]
        .every(d => (i.elig(d).reason || '').length > 10), true);

// ── THE DIRECTOR LEG SHARES THE RULE ────────────────────────────────────────
// The stall hint says "Give them a clean, easy out" — so the posture that offers an exit must
// answer to the same gate. These drive the SHIPPED _lpResolveDirectorMode.
console.log('\nthe Director stall mode answers to the same rule:');

const dir = (age, opts) => Object.assign({
  leadAgeDays: age, hasCustomerReply: false, convState: 'active-follow-up', hasOutbound: true,
  relationshipSignals: { totalOutboundCount: 6, lastInboundAgeDays: null }
}, opts || {});

check('9 days never replied is no longer "stall" — this was Tania',
  i => i.mode(dir(9)), 'active');

check('6 days never replied is no longer "stall" — this was Jordyn',
  i => i.mode(dir(6)), 'active');

check('30 days never replied with 6 outreaches IS still stall',
  i => i.mode(dir(30)), 'stall');

check('an exit signal is still stall at any age',
  i => i.mode(dir(2, { hasExitSignal: true })), 'stall');

check('a fresh lead is still first_touch',
  i => i.mode(dir(0)), 'first_touch');

// ── WIRING ──────────────────────────────────────────────────────────────────
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
console.log('\nall four gates read the one rule:');

check('the director leg no longer carries its own age threshold',
  i => /\(age > 5 && !d\.hasCustomerReply\)/.test(strip(i.src)), false);

check('the floor no longer carries a hardcoded 7',
  i => /_coAge <= 7/.test(strip(i.src)), false);

check('the floor asks the resolver',
  i => /var _coElig = _lpCloseOutEligible\(data\);/.test(strip(i.src)), true);

check('PHASE 5 asks the resolver — the v9.7.583 deferral, resolved',
  i => /var _p5Elig = _lpCloseOutEligible\(data\);/.test(strip(i.src)), true);

check('...and falls back to PHASE 4 rather than withdrawing',
  i => /if \(!_p5Elig\.eligible\)[\s\S]{0,120}PHASE 4 -- PATTERN INTERRUPT/.test(strip(i.src)), true);

check('the PHASE 4 fallback explicitly bans the exit offer',
  i => /Do NOT offer to close the file, stop contact, or ask whether to keep it open/.test(strip(i.src)), true);

check('both gate diagnostics report the verdict AND the reason',
  i => [/\[LP CLOSE-OUT GATE DIAG\][\s\S]{0,140}reason/.test(strip(i.src)) ||
        /\[LP CLOSE-OUT GATE DIAG\][\s\S]{0,140}_coElig\.reason/.test(strip(i.src)),
        /\[LP STALLED PHASE GATE DIAG\][\s\S]{0,140}reason/.test(strip(i.src))], [true, true]);

check('rungs 1-4 of the ladder are untouched',
  i => ['PHASE 1 -- VALUE / OPTIONS', 'PHASE 2 -- MICRO QUESTION',
        'PHASE 3 -- TIMING CHECK', 'PHASE 4 -- PATTERN INTERRUPT']
        .every(p => strip(i.src).indexOf(p) >= 0), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
