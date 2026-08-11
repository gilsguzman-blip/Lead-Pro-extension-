#!/usr/bin/env node
'use strict';
/**
 * worker-aggregate.test.js — regression tests for the "EXPLICIT 👍" tile bug (Worker v7.49).
 *
 * The tile rendered aggregate().ratings.up under a label claiming it was the explicit
 * thumbs-up count. It never was: the extension's _lpFeedbackDeriveRating returns 'up'
 * for BOTH an explicit thumbs-up and a copied-as-is draft, separated only by `signal`.
 * So ratings.up === implicit_copy + explicit_up, always.
 *
 * Regression cases are the two real production days reported from the dashboards.
 * Functions are sliced out of the shipped worker file and evaluated.
 *
 *   usage: worker-aggregate.test.js <worker.js>
 */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: worker-aggregate.test.js <worker.js>'); process.exit(2); }

const src = fs.readFileSync(FILE, 'utf8');
function fnSrc(name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error('missing function ' + name);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(i, j + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(['aggregate', '_newBucket', '_tallyBucket', '_bucketRates', '_decorateBuckets']
  .map(fnSrc).join('\n'), ctx);
const aggregate = vm.runInContext('aggregate', ctx);

const rows = (n, rating, signal, store) =>
  Array.from({ length: n }, () => ({ rating, signal, meta: { store: store || 'Honda Lafayette' } }));

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got)); }
}

console.log('\nWorker v7.49 — explicit/implicit split in aggregate()\n');

// ── Real production day: 2026-08-08 ────────────────────────────────────────────
// implicit_copy=244, implicit_regen_copy=21, explicit=7 (5 up + 2 down). Tile showed 249.
const AUG08 = [
  ...rows(244, 'up', 'implicit_copy'),
  ...rows(21, 'neutral', 'implicit_regen_copy'),
  ...rows(5, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
];
const a8 = aggregate(AUG08);
console.log('2026-08-08 (reported tile: 249):');
eq('ratings.up still reproduces the blended 249', a8.ratings.up, 249);
eq('explicitUp is the TRUE thumbs-up count (5)', a8.explicitUp, 5);
eq('explicitDown is 2', a8.explicitDown, 2);
eq('implicitUp accounts for the difference (244)', a8.implicitUp, 244);
eq('split reconstructs the old blend', a8.explicitUp + a8.implicitUp, a8.ratings.up);

// ── Real production day: 2026-08-10 ────────────────────────────────────────────
// implicit_copy=445, explicit=65 (63 up + 2 down), implicit_regen_copy=48, no_interaction=1.
const AUG10 = [
  ...rows(445, 'up', 'implicit_copy'),
  ...rows(63, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
  ...rows(48, 'neutral', 'implicit_regen_copy'),
  ...rows(1, 'neutral', 'no_interaction'),
];
const a10 = aggregate(AUG10);
console.log('\n2026-08-10 (reported tile: 508):');
eq('ratings.up still reproduces the blended 508', a10.ratings.up, 508);
eq('explicitUp is the TRUE thumbs-up count (63)', a10.explicitUp, 63);
eq('explicitDown is 2', a10.explicitDown, 2);
eq('implicitUp accounts for the difference (445)', a10.implicitUp, 445);
eq('total matches the dashboard (559)', a10.total, 559);

// ── The old inference breaks once implicit rejections land ─────────────────────
// A renderer could previously infer explicit-up as (signals.explicit - ratings.down),
// valid only while EVERY down was explicit. Extension v9.7.540 makes implicit downs
// reachable for the first time, so that subtraction starts undercounting.
console.log('\npost-v9.7.540 arc — the old inference is no longer safe:');
const AFTER = [
  ...rows(400, 'up', 'implicit_copy'),
  ...rows(60, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
  ...rows(35, 'down', 'implicit_regen_no_copy'),   // newly reachable
  ...rows(12, 'down', 'implicit_chip_no_copy'),    // newly reachable
  ...rows(90, 'abandoned', 'no_interaction'),      // the new denominator
];
const aF = aggregate(AFTER);
eq('old inference (signals.explicit - ratings.down) is now WRONG', aF.signals.explicit - aF.ratings.down, 13);
eq('explicitUp stays correct (60)', aF.explicitUp, 60);
eq('explicitDown stays correct (2)', aF.explicitDown, 2);

console.log('\nabandoned rows are counted, not silently dropped:');
eq('ratings.abandoned = 90', aF.ratings.abandoned, 90);
eq('engaged excludes them (509)', aF.engaged, 509);
eq('all-rows shippedRate (460/599 = 77%)', aF.shippedRate, 77);
eq('engaged-basis rate for series continuity (460/509 = 90%)', aF.engagedShippedRate, 90);
eq('bucket total equals the sum of its rating fields', (() => {
  const b = aF.byStore['Honda Lafayette'];
  return b.up + b.weak_up + b.neutral + b.down + b.abandoned === b.total;
})(), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
