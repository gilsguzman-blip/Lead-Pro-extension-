#!/usr/bin/env node
'use strict';
// (v9.7.614) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('friction-state.test.js');

/**
 * friction-state.test.js — v9.7.614. FRICTION WE CAUSED, READ IN CONTEXT.
 *
 * LIVE, 9/3. Pranav Patel, Community Honda Baytown, lead 2055655871. On 8/28 he wrote:
 *
 *   "Nope. I need to know that you have to car and OTD price is $35k. 2026 CR-V Sport. Meteorite
 *    Gray.....I have already drove all the way there and there was No car to see or drive or make
 *    a deal on."
 *
 * The relationship layer reported frustration:false.
 *
 * WHY IT MISSED — and this is the whole reason the detector exists. The existing scan is a list of
 * EMOTION WORDS: frustrated, annoyed, disappointed, upset, fed up, ridiculous, "leave me alone".
 * Pranav used none of them. He described a FACT. In a BDC thread the worst friction is almost
 * always described rather than emoted, and "I drove out and there was no car" is a far stronger
 * signal than "I am frustrated" while carrying no frustration vocabulary at all.
 *
 * ONLY FRICTION WE CAUSED. A customer no-show is theirs and is already counted as priorNoShows —
 * Pranav has one of those too, on 8/28, and it is downstream of this one: he had stopped believing
 * the car was there.
 *
 * AND READ IN CONTEXT, NOT JUST FLAGGED. A flag that always says "apologise" is the same flattening
 * that put eight equal-weight concerns on this lead. The state is computed and the directive
 * changes with it — FRESH / CARRIED / SILENT. Pranav is CARRIED: he came back on 9/02 naming a
 * white Sport at 35k, which is the state Gil's GEM read correctly by hand.
 *
 * Executes the SHIPPED detector. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: friction-state.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      var _fricRx = ');
  if (a < 0) throw new Error('_fricRx not found — v9.7.614 detector missing');
  const endMark = "acknowledge availability honestly.');\n      }";
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('concern block end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

function run(impl, lines, voiColor) {
  const logs = [];
  const sb = {
    String, Date, Array, RegExp, JSON,
    concernScanLines: lines,
    allTranscriptText: lines.join(' '),   // the slice includes the neighbouring trim detector
    customerConcerns: [],
    color: voiColor === undefined ? 'Meteorite Gray Metallic' : voiColor,
    _lpD: (...x) => logs.push(x.join(' '))
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { concerns: vm.runInContext('customerConcerns', sb), logs,
           state: vm.runInContext('_fricState', sb),
           quote: vm.runInContext('_fricQuote', sb) };
}
const first = r => r.concerns[0] || '';

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

// Pranav's real lines.
const TRIP   = '[08/28/2026 10:29 AM] [CUSTOMER] Nope. I need to know that you have to car and OTD price is $35k. 2026 CR-V Sport. Meteorite Gray.....I have already drove all the way there and there was No car to see or drive or make a deal on.';
const WHITE  = '[09/02/2026 3:25 PM] [CUSTOMER] Elsa I am looking for 2026 white CRV Sport trim at 35k.';
const AGENT  = '[09/02/2026 12:59 PM] [AGENT] Hi this is Elsa with Community Honda - I am reaching out because I saw that you had requested information.';

console.log('\nv9.7.614 — friction we caused, and what the conversation should do about it');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE DETECTION THE EMOTION LIST MISSED ───────────────────────────────────
console.log("Pranav Patel — a wasted trip described as fact, with no emotion word in it:");

check('the complaint is detected at all',
  i => run(i, [TRIP]).quote.length > 0, true);

check('...and it contains no frustration vocabulary — that is why the old scan missed it',
  i => /frustrat|annoy|disappoint|upset|fed up|ridiculous|unprofessional/i.test(TRIP), false);

check('the quote captured is his own words about the trip',
  i => /drove all the way there and there was No car/i.test(run(i, [TRIP]).quote), true);

// ── STATE: CARRIED — PRANAV'S ACTUAL SITUATION ──────────────────────────────
console.log('\nCARRIED — he came back on 9/02 with a new ask:');

check('the state is CARRIED',
  i => run(i, [TRIP, WHITE]).state, 'CARRIED');

check('the directive is FIRST in the concern list, ahead of the routine seven',
  i => /^FRICTION WE CAUSED/.test(first(run(i, [TRIP, WHITE]))), true);

check('...and says so explicitly',
  i => /THIS OUTRANKS EVERY OTHER CONCERN BELOW/.test(first(run(i, [TRIP, WHITE]))), true);

check('it limits the acknowledgement to ONE clause, not a paragraph',
  i => /Acknowledge the wasted trip in ONE clause, not a paragraph/.test(first(run(i, [TRIP, WHITE]))), true);

check('...and forbids re-apologising at length for something they stopped raising',
  i => /never re-apologise\s+at length/.test(first(run(i, [TRIP, WHITE]))), true);

check('it requires confirming the vehicle and number BEFORE any visit ask',
  i => /Confirm the specific vehicle and the specific number FIRST/.test(first(run(i, [TRIP, WHITE]))), true);

check('...and names why: asking them in on a promise is what failed last time',
  i => /that is exactly what failed\s+last time/.test(first(run(i, [TRIP, WHITE]))), true);

// ── STATE: FRESH ────────────────────────────────────────────────────────────
console.log('\nFRESH — the complaint IS their latest message:');

check('the state is FRESH when nothing follows it',
  i => run(i, [TRIP]).state, 'FRESH');

check('it tells the model to answer and NOT pitch',
  i => /do NOT pitch, do NOT offer a time/.test(first(run(i, [TRIP]))), true);

check('...and not to change the subject to another vehicle',
  i => /do NOT change the subject to a different vehicle/.test(first(run(i, [TRIP]))), true);

check('the CARRIED wording does not leak into FRESH',
  i => /ONE clause/.test(first(run(i, [TRIP]))), false);

// ── STATE: SILENT ───────────────────────────────────────────────────────────
console.log('\nSILENT — we kept writing, they never answered:');

check('an agent message after the complaint with no customer reply is SILENT',
  i => run(i, [TRIP, AGENT]).state, 'SILENT');

check('it treats the silence as the friction rather than as being busy',
  i => /more likely we lost their trust than that they got busy/.test(first(run(i, [TRIP, AGENT]))), true);

check('...and asks for nothing at all',
  i => /ask for NOTHING — no time, no visit, no second question/.test(first(run(i, [TRIP, AGENT]))), true);

// ── ONLY OUR FRICTION, AND ONLY WHEN IT HAPPENED ────────────────────────────
console.log('\nwhat must NOT fire:');

check('an AGENT describing the same events is not the customer complaining',
  i => run(i, ['[08/28/2026 10:35 AM] [AGENT] he drove out and there was no car on the lot']).quote, '');

check('a customer no-show is theirs, not ours — this detector stays quiet',
  i => run(i, ['[08/28/2026 9:00 AM] [CUSTOMER] sorry I could not make it this morning']).quote, '');

check('an ordinary thread produces no friction directive',
  i => run(i, [WHITE]).concerns.filter(c => /FRICTION WE CAUSED/.test(c)).length, 0);

check('...and logs that it looked and found nothing',
  i => /\[LP FRICTION DIAG\] none/.test(run(i, [WHITE]).logs.join(' ')), true);

// ── THE OTHER SHAPES, EACH FROM A REAL PATTERN ──────────────────────────────
console.log('\nthe other ways a customer describes lost time:');
for (const [label, line] of [
  ['came in, nothing to see',  'I came in Saturday and there was nothing to see'],
  ['went, did not have it',    'I went out there and you didn\'t have it'],
  ['took the morning off',     'I took the morning off for this'],
  ['waited two hours',         'I waited two hours and nobody helped me'],
  ['wasted my time',           'that wasted my time completely']
]) {
  check('  ' + label,
    i => run(i, ['[08/28/2026 10:00 AM] [CUSTOMER] ' + line]).quote.length > 0, true);
}

// ── ROBUSTNESS ──────────────────────────────────────────────────────────────
console.log('\nthe absent cases:');
check('no lines at all', i => run(i, []).quote, '');
check('an undated complaint still detects', i => run(i, ['[CUSTOMER] I drove out and there was no car']).quote.length > 0, true);
check('an unparseable date cannot throw', i => run(i, ['[99/99/9999] [CUSTOMER] I drove there, no car']).quote.length > 0, true);
check('the latest complaint wins when there are two',
  i => /waited two hours/.test(run(i, [TRIP, '[09/01/2026 9:00 AM] [CUSTOMER] I waited two hours again']).quote), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
