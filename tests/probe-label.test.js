#!/usr/bin/env node
'use strict';
// (v7.69) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('probe-label.test.js');

/**
 * probe-label.test.js — proxy v7.69. THE LOG CONTRADICTED THE ROW IT WAS WRITTEN BESIDE.
 *
 * The 8/28 worker logs read 129 of 216 comprehension probes as
 *
 *   [COMMIT-COMP] day-lock | NO-CUSTOMER-TEXT | ... | probe:FAILED the customer has never
 *   written anything on this lead
 *
 * Nothing failed. A lead where the customer has never written a word cannot have named a day or
 * mentioned an off-brand make; the absence IS a determinate "none". Extension v9.7.574 returns it
 * WITHOUT spending an API call, marks it vacuous:true and sets delta NO-CUSTOMER-TEXT; proxy v7.66
 * stores `vacuous` for the express purpose of splitting "nothing to read" from "probe broke"
 * structurally; reporter v1.19 gives it its own tile and keeps it out of the agreement rate.
 *
 * Every layer was right except the one a human actually reads. This log line derived its label
 * from probeOk alone and never looked at the `vacuous` field the same handler stores thirty lines
 * above it — and a vacuous row carries probeOk:false. So the majority state of an ordinary BDC day
 * printed as breakage.
 *
 * It cost a real wrong answer: reading these logs I told Gil ~60% of probes were failing and
 * proposed a precondition to skip them. There was nothing to skip. The work was already done in
 * v9.7.574 and the only defect was this string.
 *
 * Drives the SHIPPED template expression — sliced out of the worker and evaluated, not restated.
 */
const fs = require('fs');
const path = require('path');

const WORKERS = process.argv.slice(2).filter(a => /\.js$/.test(a) && fs.existsSync(a));
if (!WORKERS.length) { console.error('usage: probe-label.test.js <worker.js> [worker.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got));
  }
}

// Slice the ${...} expression out of the shipped template literal by brace-matching, so the test
// runs the real thing. A hand-copied expression would pass forever after the worker changed.
function extractLabel(src) {
  const marker = '| probe:${';
  const a = src.indexOf(marker);
  if (a < 0) throw new Error('probe label not found');
  let i = a + marker.length, depth = 1, start = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  if (depth !== 0) throw new Error('unbalanced ${} in probe label');
  const expr = src.slice(start, i);
  // eslint-disable-next-line no-new-func
  return new Function('cc', 'return (' + expr + ');');
}

const impls = WORKERS.map(w => {
  const src = fs.readFileSync(w, 'utf8');
  return { name: path.basename(w), label: extractLabel(src) };
});

console.log('\nproxy v7.69 — a log line must agree with the row beside it');
console.log('workers under test: ' + impls.map(i => i.name).join(', '));
console.log('');

const REAL = 'the customer has never written anything on this lead';
const each = (name, cc, assertFn) => {
  const results = impls.map(i => { try { return assertFn(i.label(cc)); } catch (e) { return 'THREW: ' + e.message; } });
  check(name, results, results.map(() => true));
};

console.log('the four probe states are named distinctly:');

each('a row with no probeOk at all is still called out as pre-v9.7.564',
  { probeOk: undefined }, s => s === 'unreported (pre-v9.7.564)');

each('a genuine success reads ok',
  { probeOk: true }, s => s === 'ok');

each('a genuine failure still reads FAILED, with its reason',
  { probeOk: false, vacuous: false, probeFailReason: 'probe timed out' },
  s => s.indexOf('FAILED') === 0 && s.indexOf('probe timed out') > 0);

console.log('\nthe 129 rows from 8/28 — nothing to read is not a failure:');

each('a vacuous row is NOT called a failure',
  { probeOk: false, vacuous: true, probeFailReason: REAL },
  s => s.indexOf('FAILED') < 0);

each('...it says nothing to read instead',
  { probeOk: false, vacuous: true, probeFailReason: REAL },
  s => /nothing to read/.test(s));

each('...and still carries the detector\'s own reason, which differs per detector',
  { probeOk: false, vacuous: true, probeFailReason: REAL },
  s => s.indexOf(REAL) > 0);

each('verbal-commit\'s different empty reason survives too — it reads call notes, not customer text',
  { probeOk: false, vacuous: true,
    probeFailReason: 'no call note carried any content to read (all boilerplate or empty)' },
  s => /nothing to read/.test(s) && s.indexOf('boilerplate') > 0);

console.log('\nvacuous must not swallow a real failure:');

each('probeOk:false with vacuous absent is a FAILURE, not nothing-to-read',
  { probeOk: false, probeFailReason: 'non-JSON body' },
  s => s.indexOf('FAILED') === 0);

each('probeOk:true wins even if vacuous were somehow set',
  { probeOk: true, vacuous: true }, s => s === 'ok');

each('a missing reason still produces a readable label rather than undefined',
  { probeOk: false, vacuous: true },
  s => s.indexOf('undefined') < 0 && /nothing to read/.test(s));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
