#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('close-out-floor.test.js');

/**
 * close-out-floor.test.js — v9.7.593. A TWO-DAY-OLD LEAD IS NOT A CLOSE-OUT.
 *
 * ── THE DRAFT ─────────────────────────────────────────────────────────────────────────────
 * Troy Noel, lead 2073356549, day 1, generated on v9.7.592:
 *
 *     "Troy, are you still considering the 2026 Honda Accord Hybrid Sport-L,
 *      or should I close this out for now?"
 *
 * A lead that opened yesterday, offered an exit. Gil's words: "a two day old lead should
 * certainly not be a close out tone."
 *
 * ── NOTHING INSTRUCTED IT ─────────────────────────────────────────────────────────────────
 * _isStalled was false, so PHASE 5 never engaged. The close-out came from tone — three correct
 * pressures stacking into a wrong sum: the situation brief suggested an "easy-out", the
 * anti-restate block said to acknowledge the silence plainly, and the relationship reading said
 * "not a hot lead, soft re-engage".
 *
 * That is why the fix is an explicit floor rather than a reworded directive. No single input was
 * wrong, so there was no single input to correct.
 *
 * ── WHY 7 DAYS ────────────────────────────────────────────────────────────────────────────
 * It matches the phase boundary the system prompt already uses: first-touch 0-1, engagement 2-7,
 * persistence 8+. Close-out is the PHASE 5 move, the last rung of a long ladder; inside the
 * engagement window there is no ladder yet. Seven outreaches over two days is our own cadence
 * firing, not a customer going quiet.
 *
 * ── WHAT THE FLOOR MUST NOT DO ────────────────────────────────────────────────────────────
 * A customer who asks to stop must always be able to stop. The floor lives inside the
 * exit/pause-gated section, so a STOP, an opt-out or a pause signal never reaches it — those
 * paths return before this block runs. Asserted below as a structural property of the file, since
 * getting that wrong would trap a customer who asked to be left alone.
 *
 * Both builds must agree.
 */
const fs = require('fs');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: close-out-floor.test.js <popup.js> [popup.js...]'); process.exit(2); }

const impls = BUILDS.map(f => ({ name: path.basename(path.dirname(f)), src: fs.readFileSync(f, 'utf8') }));
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

// Comments stripped: a post-mortem comment quoting the banned phrasing must not satisfy an
// assertion about the code. This has bitten four times.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

console.log('\nv9.7.593 — a two-day-old lead is not a close-out');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE GATE ────────────────────────────────────────────────────────────────
console.log('the floor exists and asks the one eligibility rule:');

// (v9.7.595) THESE ASSERTIONS ARE DELIBERATELY REPLACED. v9.7.593 gated this block on a hardcoded
// `_coAge <= 7`. That caught Troy's day-1 lead but left the 9-day case from the same day's export
// uncovered, and disagreed with the three other close-out gates in the file (isStalled at 2, the
// director leg at 5, PHASE 5 at a touch count with no age check at all). Gil's rule — "a combo of
// days and lack of response" — is now one resolver that all four ask. The rule itself is covered
// in close-out-eligibility.test.js; this suite covers the floor's wiring and its prompt text.

check('the block asks _lpCloseOutEligible rather than carrying its own threshold',
  i => /var _coElig = _lpCloseOutEligible\(data\);/.test(strip(i.src)), true);

check('...and the hardcoded 7-day boundary is gone',
  i => /_coAge <= 7/.test(strip(i.src)), false);

check('the ban fires whenever the lead is NOT eligible',
  i => /if \(!_coElig\.eligible\)/.test(strip(i.src)), true);

// (v9.7.595) INVERTED FROM v9.7.593, and the inversion is the safer direction. The old floor
// skipped an unknown age (`!isNaN(_coAge)`), so a lead whose age could not be read got NO ban —
// absence of evidence silently permitted a withdrawal. The resolver returns not-eligible on any
// unreadable field, so unknown now BLOCKS. A close-out cannot be walked back; it should require
// positive evidence, not merely the absence of a reason to refuse.
check('an UNKNOWN age now DOES fire the floor — unknown never authorises a withdrawal',
  i => /!isNaN\(_coAge\)/.test(strip(i.src)), false);

check('the floor states the reason in the prompt, so the agent can see the gate',
  i => /not at a point where withdrawing is the right move/.test(strip(i.src)), true);

check('[LP CLOSE-OUT GATE DIAG] reports the verdict, the reason and every input',
  i => /\[LP CLOSE-OUT GATE DIAG\][\s\S]{0,260}sinceReply/.test(strip(i.src)), true);

// (v9.7.595) The old block here asserted a LOCAL `fires = age => age <= 7` helper. It passed
// without touching the shipped code, and once the rule changed it would have kept passing while
// describing behaviour that no longer exists — a green test for a deleted feature. It now drives
// the SHIPPED resolver against the exact leads that produced this build.
const vm2 = require('vm');
function shippedGate(src) {
  const h = src.indexOf('function _lpCloseOutEligible(');
  let d = 0, st = false, e = -1;
  for (let i = h; i < src.length; i++) {
    if (src[i] === '{') { d++; st = true; }
    else if (src[i] === '}') { d--; if (st && d === 0) { e = i + 1; break; } }
  }
  const sb = { String, RegExp, parseFloat, isNaN };
  vm2.createContext(sb);
  vm2.runInContext(src.slice(h, e), sb);
  return o => vm2.runInContext('_lpCloseOutEligible', sb)(o).eligible;
}
const never = (age, out) => ({ leadAgeDays: age, hasCustomerReply: false, convState: 'active-follow-up',
  relationshipSignals: { totalOutboundCount: out, lastInboundAgeDays: null } });

console.log('\nthe shipped gate, at the ages that produced this build (floor ON = not eligible):');
check('  day 1, 7 outreaches  (Troy)      -> floor ON',  i => shippedGate(i.src)(never(1, 7)),  false);
check('  day 2, 5 outreaches  (Jordyn)    -> floor ON',  i => shippedGate(i.src)(never(2, 5)),  false);
check('  day 4, 5 outreaches  (Andrea)    -> floor ON',  i => shippedGate(i.src)(never(4, 5)),  false);
check('  day 9, 6 outreaches  (Tania)     -> floor ON',  i => shippedGate(i.src)(never(9, 6)),  false);
check('  day 21, 5 outreaches             -> floor OFF', i => shippedGate(i.src)(never(21, 5)), true);
check('  day 41, 8 outreaches (accepted)  -> floor OFF', i => shippedGate(i.src)(never(41, 8)), true);
check('  day 25 but only 2 outreaches     -> floor ON',  i => shippedGate(i.src)(never(25, 2)), false);
check('  unknown age                      -> floor ON',  i => shippedGate(i.src)(never(undefined, 9)), false);

// ── WHAT IT BANS ────────────────────────────────────────────────────────────
console.log('\nit bans the specific phrasings the draft reached for:');

check('the heading names the prohibition plainly',
  i => /DO NOT OFFER TO CLOSE THIS LEAD OUT:/.test(strip(i.src)), true);

for (const phrase of ['should I close this out', 'I will stop reaching out',
                      'I will take you off my list', 'last time I will bother you']) {
  check('  bans "' + phrase + '"',
    i => strip(i.src).indexOf(phrase) >= 0, true);
}

check('...and bans variations rather than only the literal strings',
  i => /or any variation that hands them an exit/.test(strip(i.src)), true);

check('it names WHY the silence is not a signal — our cadence, not their disinterest',
  i => /OUR cadence running, not the customer going cold/.test(strip(i.src)), true);

// ── WHAT IT MUST STILL ALLOW ────────────────────────────────────────────────
console.log('\nwhat it deliberately still allows:');

check('acknowledging the quiet is explicitly still permitted',
  i => /Acknowledging that it has been quiet is fine; withdrawing is not/.test(strip(i.src)), true);

check('it asks for a forward move, not just a prohibition',
  i => /Move the conversation forward/.test(strip(i.src)), true);

// ── THE CUSTOMER'S OWN EXIT MUST ALWAYS WIN ─────────────────────────────────
// Structural: the floor sits inside the exit/pause-gated follow-up section, so a customer who
// asked to stop never reaches it. If this ever inverts, a STOP would be answered with a pitch.
console.log('\na customer who asks to stop is never trapped by the floor:');

check('the floor sits INSIDE the exit/pause-gated section',
  i => {
    const s = strip(i.src);
    const floor = s.indexOf('DO NOT OFFER TO CLOSE THIS LEAD OUT:');
    const endGate = s.indexOf('end exit/pause-gated follow-up push');
    return floor > 0 && endGate > floor;
  }, true);

check('...and the section is still gated on the exit/pause signals',
  i => /_hasExitSignal|hasExitSignal|isPauseSignal/.test(strip(i.src)), true);

// ── THE DIAGNOSTIC ──────────────────────────────────────────────────────────
console.log('\nthe floor is observable when it fires:');

// (v9.7.595) Renamed FLOOR -> GATE, because it is no longer a floor: it reports the verdict of a
// shared rule rather than a one-sided age cut-off. The old name is asserted GONE so a stale
// grep for it cannot quietly pass against a diag that no longer exists.
check('the old [LP CLOSE-OUT FLOOR DIAG] name is retired',
  i => /\[LP CLOSE-OUT FLOOR DIAG\]/.test(strip(i.src)), false);

check('[LP CLOSE-OUT GATE DIAG] reports eligibility, reason, age, outreaches and reply state',
  i => {
    const m = strip(i.src).match(/\[LP CLOSE-OUT GATE DIAG\][\s\S]{0,300}/);
    const t = m ? m[0] : '';
    return { eligible: /eligible:/.test(t), reason: /reason/.test(t),
             age: /age:/.test(t), outreaches: /outreaches:/.test(t), replied: /replied:/.test(t) };
  }, { eligible: true, reason: true, age: true, outreaches: true, replied: true });

// ── THE SITUATION BRIEF NO LONGER SUGGESTS AN EXIT ──────────────────────────
console.log('\nthe hang-up brief no longer suggests an "easy-out":');

check('"easy-out" is gone from the close-override',
  i => /curiosity, easy-out, or value shift/.test(strip(i.src)), false);

check('...replaced with a channel/angle suggestion that does not point at the door',
  i => /Try a different channel or a different angle — curiosity or value shift/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
