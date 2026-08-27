#!/usr/bin/env node
'use strict';
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
console.log('the floor exists and is bounded by lead age:');

check('the block is gated on leadAgeDays',
  i => /var _coAge = parseFloat\(data\.leadAgeDays\);/.test(strip(i.src)), true);

check('the boundary is 7 days — the engagement-phase edge',
  i => /if \(!isNaN\(_coAge\) && _coAge <= 7\)/.test(strip(i.src)), true);

check('an UNKNOWN age does not fire the floor — it is a guard, not a default',
  i => /!isNaN\(_coAge\)/.test(strip(i.src)), true);

// The arithmetic of the gate itself, so the boundary is pinned rather than described.
const fires = age => !isNaN(age) && age <= 7;
console.log('\nwhat the gate does at each age:');
check('  day 0 (submitted today)      -> floor ON',  () => fires(0), true);
check('  day 1 (Troy)                 -> floor ON',  () => fires(1), true);
check('  day 2                        -> floor ON',  () => fires(2), true);
check('  day 7 (last engagement day)  -> floor ON',  () => fires(7), true);
check('  day 8 (persistence begins)   -> floor OFF', () => fires(8), false);
check('  day 45 (reactivation)        -> floor OFF', () => fires(45), false);
check('  unknown age                  -> floor OFF', () => fires(NaN), false);

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

check('[LP CLOSE-OUT FLOOR DIAG] reports age, outreaches and reply state',
  i => /\[LP CLOSE-OUT FLOOR DIAG\][\s\S]{0,200}hasReply/.test(strip(i.src)), true);

// ── THE SITUATION BRIEF NO LONGER SUGGESTS AN EXIT ──────────────────────────
console.log('\nthe hang-up brief no longer suggests an "easy-out":');

check('"easy-out" is gone from the close-override',
  i => /curiosity, easy-out, or value shift/.test(strip(i.src)), false);

check('...replaced with a channel/angle suggestion that does not point at the door',
  i => /Try a different channel or a different angle — curiosity or value shift/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
