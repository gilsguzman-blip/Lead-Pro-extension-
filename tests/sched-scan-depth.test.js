#!/usr/bin/env node
'use strict';
/**
 * sched-scan-depth.test.js — v9.7.588. A TWO-CHARACTER REPLY ERASED A DAY, A TIME, AND A RIDE.
 *
 * ── THE INCIDENT, AS A CONTROLLED PAIR ────────────────────────────────────────────────────
 * Keisha Burgess (Community Kia Baytown, lead 2074168344, 8/27). Two grabs eight minutes apart,
 * same lead, opposite results:
 *
 *   12:56  note[0] = "...I'm still coming Saturday and what your name so I can ask for you"
 *          → [LP SCHED DAY DIAG] LOCKED — day name IS customer-authored, day: Saturday
 *          → prompt carried "CUSTOMER NAMED A SPECIFIC DAY — HARD CONSTRAINT" and "NOT TODAY"
 *
 *   13:04  note[0] = "3pm"
 *          → no day name, loop broke, constraint never found
 *          → prompt carried "SUGGESTED APPOINTMENT TIMES: 3:15 PM today / 4:00 PM today"
 *
 * ── WHY, AND HOW IT WAS ESTABLISHED ───────────────────────────────────────────────────────
 * The loop walks notes newest-first and used to `break` at the FIRST inbound note regardless of
 * what it contained. Two wrong diagnoses were made before the right one, both corrected against
 * artifacts rather than argument:
 *   • "it stops at the first inbound note"  — right, but initially unproven.
 *   • "noteEls only had 1 element"          — WRONG. It came from an awk scan for /\bbreak\b/,
 *     and \b in awk ERE is a BACKSPACE, not a word boundary, so the break went unfound.
 * The DOM dump settled it: the notes list holds 32 items, 16 Inbound and 11 Outbound, matching the
 * relationship reading exactly. noteEls was never short. The loop simply stopped.
 *
 * These inbound notes sat below the break and were never read:
 *     [2] "...I'm still coming Saturday and what your name..."
 *     [6] "...Sometime around 2:30 pm"
 *     [7] "...I'll will uber there"
 * The last one is not a scheduling detail. The 11:22 call note says "she doesn't have a vehicle so
 * he can't come in" — she had solved that herself, and LP could not see it.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────────────────────
 * Break once a CONSTRAINT is found rather than once an inbound note is seen. Newest-first ordering
 * keeps override semantics for free: the first constraint found is the most recent one stated, so a
 * later "actually Monday works" still beats an earlier Saturday. Every assignment in the loop is
 * already guarded on !customerScheduleConstraint, so scanning on cannot overwrite a fresher
 * constraint with a staler one.
 *
 * Driven against the SHIPPED loop with Keisha's REAL note sequence. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sched-scan-depth.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '    var schedCustomerNotes = [];';
const END   = '    // Detect when customer has explicitly declined an alternative the agent offered.';

// A minimal DOM good enough to drive the shipped loop: each note exposes a direction attribute,
// a title node and a content node, which is exactly what the loop reads.
function makeDoc(notes) {
  const els = notes.map(n => ({
    getAttribute: a => (a === 'data-direction' ? n.dir : ''),
    querySelector: sel => ({
      innerText: /title/.test(sel) ? n.title : n.body
    })
  }));
  return { querySelectorAll: sel => (/notes-and-history-item/.test(sel) ? els : []) };
}

// The loop calls _lpCustomerAuthoredPart, which lives in the inlineScraper scope alongside it.
// It is SLICED OUT OF THE SHIPPED FILE rather than stubbed: this suite exists because a day name
// was attributed to the wrong author once already (the v9.7.560 quoted-reply incident), and a
// hand-written stand-in for the attribution helper would quietly re-open exactly that hole.
function helperSrc(src) {
  const h = src.indexOf('    function _lpCustomerAuthoredPart(raw) {');
  if (h < 0) throw new Error('_lpCustomerAuthoredPart not found');
  let d = 0, started = false;
  for (let i = h; i < src.length; i++) {
    if (src[i] === '{') { d++; started = true; }
    else if (src[i] === '}') { d--; if (started && d === 0) return src.slice(h, i + 1); }
  }
  throw new Error('_lpCustomerAuthoredPart never closed');
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('sched loop not found in ' + file);
  const fn = new vm.Script(
    '(function(document, _pastVisitDay){\n' +
    ' var customerScheduleConstraint = "", customerSaidNotToday = false;\n' +
    ' var diags = []; var _lpD = function(){ diags.push(JSON.stringify(Array.prototype.slice.call(arguments))); };\n' +
    ' var noteEls = Array.from(document.querySelectorAll(".notes-and-history-item")||[]);\n' +
    helperSrc(src) + '\n' +
    src.slice(a, b) +
    '\nreturn { constraint: customerScheduleConstraint, notesRead: schedCustomerNotes.length,' +
    ' gates: diags.filter(function(d){ return d.indexOf("SCHED GATE") >= 0; }).length, diags: diags }; })'
  ).runInNewContext({ Array, String, RegExp, Math, JSON, Date, Object, parseInt, parseFloat });
  return { name: path.basename(path.dirname(file)), run: (notes) => fn(makeDoc(notes), false) };
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

const IN  = b => ({ dir: 'inbound',  title: 'Inbound Text Message',  body: 'Received from: (832) 459-3726\nReceived by: Agent\n' + b });
const OUT = b => ({ dir: 'outbound', title: 'Outbound Text Message', body: 'Sent to: (832) 459-3726\nSent by: Agent\n' + b });

// Keisha's real note order at 13:04, verbatim from the DOM dump, newest first.
const KEISHA_1304 = [
  IN('3pm'),
  OUT('? My name is Jose Arevalo my General Manager that has been working on your approval his name is Ever'),
  IN("Don't really like that one send me 3 more options I'm still coming Saturday and what your name so I can ask for you"),
  IN('Let me look hang tight'),
  OUT('$1042 down, and we can have someone pick you up to save $ on uber'),
  OUT('400$ of down payment you do not have at the moment on a credit card would that be a possibility'),
  IN('Set me up for this Saturday to come in for the car. Sometime around 2:30 pm'),
  IN("I'll will uber there")
];
// The 12:56 shape: the Saturday message is note[0].
const KEISHA_1256 = KEISHA_1304.slice(2);

const has = (i, notes, re) => re.test(i.run(notes).constraint || '');

console.log('\nv9.7.588 — the scan stops on a CONSTRAINT, not on the first inbound note');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE INCIDENT ──────────────────────────────────────────────────────────────
console.log("Keisha's real note order — the pair that read two different ways:");

check('12:56 shape (Saturday is note[0]) — locks Saturday, as it always did',
  i => has(i, KEISHA_1256, /Saturday/i), true);

check('13:04 shape ("3pm" is note[0]) — STILL locks Saturday, which is the fix',
  i => has(i, KEISHA_1304, /Saturday/i), true);

check('...and it reaches past the break to do it — more than one note is examined',
  i => i.run(KEISHA_1304).gates > 1, true);

check('the constraint found is the DAY one, not a time preference scraped off "3pm"',
  i => /CUSTOMER SPECIFIED DAY/.test(i.run(KEISHA_1304).constraint || ''), true);

// ── The probe is no longer starved ────────────────────────────────────────────
console.log('\nthe day-lock probe stops being handed a single note:');

check('customer notes collected rise above the one note the break allowed',
  i => i.run(KEISHA_1304).notesRead > 1, true);

// ── OVERRIDE SEMANTICS MUST SURVIVE ───────────────────────────────────────────
console.log('\nnewest-first still wins — a fresher day beats a staler one:');

check('a NEWER "Monday" overrides an older "Saturday"',
  i => /Monday/i.test(i.run([
    IN('actually Monday works better for me'),
    IN("I'm still coming Saturday")
  ]).constraint || ''), true);

check('...and the older Saturday does NOT leak through alongside it',
  i => /Saturday/i.test(i.run([
    IN('actually Monday works better for me'),
    IN("I'm still coming Saturday")
  ]).constraint || ''), false);

// ── It must still stop, and stop early when it can ────────────────────────────
console.log('\nit still short-circuits — this is not "always scan everything":');

check('a constraint in note[0] stops the scan there, exactly as before',
  i => i.run([IN("I'm still coming Saturday"), IN('and 2:30 pm'), IN('uber there')]).gates, 1);

check('a lead with no constraint anywhere finds none and does not invent one',
  i => i.run([IN('ok'), IN('thanks'), OUT('sent')]).constraint, '');

check('outbound notes are still skipped — an agent naming a day is not the customer naming one',
  i => has(i, [OUT('can you come Saturday?'), OUT('or Monday?')], /Saturday|Monday/i), false);

// ── The scan is now reportable ────────────────────────────────────────────────
console.log('\nthe scan depth is reported, so a short read is visible next time:');

check('the diag names what was available, what was scanned, and what was found',
  i => {
    const d = i.run(KEISHA_1304).diags.filter(x => x.indexOf('SCHED SCAN DIAG') >= 0).join('');
    return { available: /"notesAvailable":8/.test(d),
             read:      /"customerNotesRead":\d+/.test(d),
             found:     /CUSTOMER SPECIFIED DAY/.test(d) };
  }, { available: true, read: true, found: true });

check('...and it reports the empty case rather than staying silent',
  i => /\(none found\)/.test(i.run([IN('ok'), OUT('sent')]).diags.join('')), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
