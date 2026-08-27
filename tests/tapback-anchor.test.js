#!/usr/bin/env node
'use strict';
/**
 * tapback-anchor.test.js — v9.7.590. THE TAPBACK GUARD COULD NEVER REACH THE TAPBACK.
 *
 * ── WHAT A TAPBACK IS, AND WHY IT MATTERS HERE ────────────────────────────────────────────
 * When a customer taps "Love" on an iPhone message, the SMS gateway delivers it as an INBOUND
 * message from her whose body is OUR OWN TEXT, quoted back. The only thing she authored is the
 * verb. Everything in the quotes is ours.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────────────────────
 * The guard was anchored ^\s* — the reaction had to be the very first thing in the string. A real
 * VinSolutions note never is. Verified against the 8/27 DOM dump: the content element opens with
 * routing headers in their own <div>s, so innerText yields
 *
 *     Received from: (832) 459-3726
 *     Received by: Rotaxlyn Hudson
 *     Loved “Great I got you down for 3pm on Saturday , you can message us on here...”
 *
 * The verb is on line THREE. The guard read position zero, saw "R", and gave up. It has therefore
 * almost certainly never fired on live traffic since v9.7.567 — the same failure as the v9.7.586
 * on-premise guard (anchored past the same headers) and the value-fact resolver (waiting on a
 * command string nobody types). A guard that cannot match production is not a guard.
 *
 * ── WHAT IT COST ──────────────────────────────────────────────────────────────────────────
 * Keisha Burgess (lead 2074168344, 8/27 3:48 PM): the scheduler read "Saturday" out of our own
 * sentence and logged "day name IS customer-authored", cutBy "(nothing cut)", customerLen 259 ===
 * rawLen 259. Harmless there — Saturday was genuinely her day from an earlier message. The general
 * case is not: text a customer "How about Monday at 10?", have them tap Love, and LP hard-locks a
 * day and time they never chose. A tapback is the least specific reply a person can send.
 *
 * ── WHY NOT JUST SEARCH ANYWHERE ──────────────────────────────────────────────────────────
 * Because "I loved “Top Gun”, anyway about the car..." would then delete a real customer message —
 * trading a false positive for a false negative, and emptying the transcript is exactly the class
 * v9.7.589 just fixed. The verb must be at a LINE START, with only routing headers before it.
 *
 * Driven against the SHIPPED helper with the note shape taken from the real DOM dump.
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: tapback-anchor.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const h = src.indexOf('    function _lpCustomerAuthoredPart(raw) {');
  if (h < 0) throw new Error('_lpCustomerAuthoredPart not found in ' + file);
  let d = 0, started = false, end = -1;
  for (let i = h; i < src.length; i++) {
    if (src[i] === '{') { d++; started = true; }
    else if (src[i] === '}') { d--; if (started && d === 0) { end = i + 1; break; } }
  }
  const sb = { String, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(src.slice(h, end), sb);
  return {
    name: path.basename(path.dirname(file)),
    part: raw => vm.runInContext('_lpCustomerAuthoredPart', sb)(raw)
  };
}

const impls = BUILDS.map(extract);
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

// Verbatim from the 8/27 DOM dump, headers included, as innerText produces it.
const KEISHA = 'Received from: (832) 459-3726\nReceived by: Rotaxlyn Hudson\n'
  + 'Loved “Great I got you down for 3pm on Saturday , you can message us on here to let us know '
  + 'if there is anything we need to update, you will receive a automated text regarding the appointment shortly”';

const isReaction = (i, t) => !!(i.part(t) || {}).reaction;
const authored   = (i, t) => ((i.part(t) || {}).text || '');

console.log('\nv9.7.590 — the tapback guard can see past the routing headers');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE INCIDENT ──────────────────────────────────────────────────────────────
console.log("Keisha's real note, headers and all — the one that locked Saturday:");

check('it is recognised as a reaction',
  i => isReaction(i, KEISHA), true);

check('...and NOTHING is left as customer-authored — the quote is ours',
  i => authored(i, KEISHA), '');

check('...so "Saturday" is no longer reachable as something she wrote',
  i => /Saturday/i.test(authored(i, KEISHA)), false);

check('the reaction verb is reported, since that IS her signal',
  i => (i.part(KEISHA) || {}).reaction, 'Loved');

// ── EVERY REACTION VERB, BEHIND HEADERS ───────────────────────────────────────
console.log('\nevery reaction verb the guard knows, now behind the headers:');

const HDR = 'Received from: (832) 459-3726\nReceived by: Agent\n';
for (const v of ['Loved', 'Liked', 'Disliked', 'Laughed at', 'Emphasized', 'Emphasised', 'Questioned']) {
  check('  ' + v,
    i => isReaction(i, HDR + v + ' “our prior outbound text”'), true);
}

check('an OUTBOUND-header shape is handled too — same routing lines, other direction',
  i => isReaction(i, 'Sent to: (832) 459-3726\nSent by: Agent\nLoved "our text"'), true);

check('straight quotes work as well as smart quotes',
  i => isReaction(i, HDR + 'Loved "our text"'), true);

// ── BACKWARD COMPATIBILITY ────────────────────────────────────────────────────
console.log('\nthe original bare shape still matches — zero headers is still valid:');

check('a reaction with NO headers at all is unchanged',
  i => isReaction(i, 'Loved “The best time is now. We have some great deals”'), true);

// ── THE FALSE POSITIVE THIS MUST NOT CREATE ───────────────────────────────────
console.log('\nit must not eat a real message — a line-start verb is required:');

check('"I loved “Top Gun”, anyway about the car" is NOT a reaction',
  i => isReaction(i, HDR + 'I loved “Top Gun”, anyway about the car'), false);

check('...and that customer message survives intact',
  i => /about the car/.test(authored(i, HDR + 'I loved “Top Gun”, anyway about the car')), true);

check('a reaction verb used mid-sentence is not a reaction',
  i => isReaction(i, HDR + 'My wife liked "the blue one" better than the black'), false);

check('a plain customer message is untouched',
  i => authored(i, HDR + 'Send me what you have for around $800').indexOf('$800') >= 0, true);

check('a bare word that happens to be a verb, with no quote, is not a reaction',
  i => isReaction(i, HDR + 'Loved it'), false);

// ── PROSE AFTER THE HEADERS MUST NOT LET A LATER REACTION THROUGH ─────────────
console.log('\nonly ROUTING HEADERS may precede it — not customer prose:');

check('a reaction after real customer prose is NOT treated as a whole-note reaction',
  i => isReaction(i, HDR + 'ok sounds good\nLoved “something we said”'), false);

// ── THE OTHER MARKERS STILL WORK ──────────────────────────────────────────────
console.log('\nthe quoted-reply markers this helper already handled are unaffected:');

check('a quoted-reply header still cuts',
  i => {
    const r = i.part('Received from: x\nReceived by: y\nSounds good\nOn Aug 26, 2026, Agent wrote:\nold text');
    return { cut: !!r.cutBy, kept: /Sounds good/.test(r.text), dropped: !/old text/.test(r.text) };
  }, { cut: true, kept: true, dropped: true });

check('empty input is still handled',
  i => i.part(''), { text: '', cutBy: '', cutAt: -1 });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
