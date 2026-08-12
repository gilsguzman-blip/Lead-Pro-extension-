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

console.log('\nincomplete sessions (extension v9.7.541) sit outside quality math:');
const A11 = [
  ...rows(102, 'up', 'implicit_copy'),
  ...rows(42, 'up', 'explicit'),
  ...rows(1, 'down', 'explicit'),
  ...rows(2, 'down', 'implicit_regen_no_copy'),
  ...rows(6, 'abandoned', 'no_interaction'),
  ...rows(28, 'incomplete', 'no_interaction'),
];
const a11 = aggregate(A11);
eq('total counts every session (181)', a11.total, 181);
eq('produced excludes incomplete (153)', a11.produced, 153);
eq('engaged excludes abandoned too (147)', a11.engaged, 147);
eq('engagedShippedRate = 144/147 = 98%', a11.engagedShippedRate, 98);
eq('usedRate = 144/153 = 94%', a11.usedRate, 94);
eq('explicitUp untouched by the new bucket (42)', a11.explicitUp, 42);
eq('bucket total still reconciles with its rating fields', (() => {
  const b = a11.byStore['Honda Lafayette'];
  return b.up + b.weak_up + b.neutral + b.down + b.abandoned + b.incomplete === b.total;
})(), true);


// ── Real day 2026-08-11: BY STORE 👎 column merged explicit with implicit no-copy ──────
// Report showed Honda Baytown 👎7 and Kia Baytown 👎6, reading as the worst rejection rates
// of the day. Only 2 explicit thumbs-down occurred, both Toyota Baytown.
console.log('\n2026-08-11 — per-store 👎 must separate explicit from implicit no-copy:');
const AUG11_STORES = [
  // Toyota Baytown: the ONLY explicit rejections all day, plus one regen-then-abandon
  ...rows(2, 'down', 'explicit', 'Toyota Baytown'),
  ...rows(1, 'down', 'implicit_regen_no_copy', 'Toyota Baytown'),
  // every other store: regen/chip-then-abandoned only, zero real pushback
  ...rows(7, 'down', 'implicit_regen_no_copy', 'Honda Baytown'),
  ...rows(4, 'down', 'implicit_regen_no_copy', 'Kia Baytown'),
  ...rows(2, 'down', 'implicit_chip_no_copy',  'Kia Baytown'),
  ...rows(1, 'down', 'implicit_regen_no_copy', 'Honda Lafayette'),
  ...rows(2, 'down', 'implicit_regen_no_copy', 'unknown'),
  // shipped volume so the buckets are realistic
  ...rows(170, 'up', 'implicit_copy', 'Honda Lafayette'),
  ...rows(49, 'up', 'explicit', 'Toyota Baytown'),
];
const st = aggregate(AUG11_STORES).byStore;
eq('Toyota Baytown — explicit 👎 = 2', st['Toyota Baytown'].explicitDown, 2);
eq('Toyota Baytown — no-copy = 1', st['Toyota Baytown'].implicitDown, 1);
eq('Toyota Baytown — merged total was 3', st['Toyota Baytown'].down, 3);
eq('Honda Baytown — explicit 👎 = 0 (showed 7)', st['Honda Baytown'].explicitDown, 0);
eq('Honda Baytown — no-copy = 7', st['Honda Baytown'].implicitDown, 7);
eq('Kia Baytown — explicit 👎 = 0 (showed 6)', st['Kia Baytown'].explicitDown, 0);
eq('Kia Baytown — no-copy = 6', st['Kia Baytown'].implicitDown, 6);
eq('Honda Lafayette — explicit 👎 = 0', st['Honda Lafayette'].explicitDown, 0);
eq('unknown — explicit 👎 = 0', st['unknown'].explicitDown, 0);
eq('explicit 👎 across all stores = 2, matching the tile',
  Object.values(st).reduce((a, b) => a + b.explicitDown, 0), 2);
eq('no-copy across all stores = 17', Object.values(st).reduce((a, b) => a + b.implicitDown, 0), 17);
eq('every store still reconciles: explicit + implicit === merged down',
  Object.values(st).every(b => b.explicitDown + b.implicitDown === b.down), true);


// ── Retroactive: 8/11 rows are stored as 'abandoned' (v9.7.540 wrote them, v9.7.541 was
// not deployed yet). Re-rendering that day must still produce the corrected math.
console.log('\nretroactive — pre-v9.7.541 rows re-render correctly:');
const AS_STORED_811 = [
  ...rows(102, 'up', 'implicit_copy'),
  ...rows(42, 'up', 'explicit'),
  ...rows(1, 'down', 'explicit'),
  ...rows(2, 'down', 'implicit_regen_no_copy'),
  ...rows(6, 'abandoned', 'no_interaction'),                  // real abandons: meta present
  ...Array.from({ length: 28 }, () => ({                      // never rendered a draft: meta EMPTY
    rating: 'abandoned', signal: 'no_interaction', meta: {}
  })),
];
const rr = aggregate(AS_STORED_811);
eq('28 meta-less rows reclassified as incomplete', rr.ratings.incomplete, 28);
eq('only the 6 genuine abandons remain', rr.ratings.abandoned, 6);
eq('produced excludes them (153)', rr.produced, 153);
eq('engaged (147)', rr.engaged, 147);
eq('usedRate corrected on re-render (94%, was 80%)', rr.usedRate, 94);
eq('explicit counts untouched by the rewrite (42 / 1)', [rr.explicitUp, rr.explicitDown], [42, 1]);
eq('total is preserved — nothing dropped (181)', rr.total, 181);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
