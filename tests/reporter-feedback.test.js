#!/usr/bin/env node
'use strict';
/**
 * reporter-feedback.test.js — regression tests for the "EXPLICIT 👍" tile (reporter v1.8).
 *
 * The reporter does NOT share the proxy's aggregate() — it reads KV directly and
 * re-implements the aggregation inside runReport(). So the identical defect existed
 * independently in both workers. This suite exercises the reporter's own copy by
 * slicing the aggregation loop out of the shipped file and running the two real
 * production days through it.
 *
 *   usage: reporter-feedback.test.js <reporter.js>
 */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: reporter-feedback.test.js <reporter.js>'); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');

// Slice the aggregation: from the ratings map through the feedbackData assignment.
const START = "        const ratings  = { up:0";
const END   = "      }\n    } else {";
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0) { console.error('could not locate the aggregation block'); process.exit(2); }
const BLOCK = src.slice(a, b);

const ctx = {};
vm.createContext(ctx);
const aggregate = vm.runInContext(
  '(function(entries){ let feedbackData=null; const dateLabel="2026-08-10";\n' +
  BLOCK.replace(/^\s*const total = entries\.length;/m, 'const total = entries.length;') +
  '\n return feedbackData; })', ctx);

const rows = (n, rating, signal, store) =>
  Array.from({ length: n }, (_, i) => ({
    rating, signal, ts: '2026-08-10T18:00:00.000Z', regenCount: 0, chipCount: 0, chipsUsed: [],
    meta: { store: store || 'Honda Lafayette' }
  }));

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got)); }
}

console.log('\nReporter v1.8 — Explicit 👍/👎 tiles\n');

// ── Real production day: 2026-08-08. Tile showed 249; true explicit up = 5. ────
const AUG08 = [
  ...rows(244, 'up', 'implicit_copy'),
  ...rows(21, 'neutral', 'implicit_regen_copy'),
  ...rows(5, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
];
const f8 = aggregate(AUG08);
console.log('2026-08-08 (tile showed 249, true explicit 👍 = 5):');
eq('blended ratings.up still reproduces the old 249', f8.ratings.up, 249);
eq('tile now renders explicitUp = 5', f8.explicitUp, 5);
eq('explicitDown = 2', f8.explicitDown, 2);
eq('implicitUp disclosed separately = 244', f8.implicitUp, 244);

// ── Real production day: 2026-08-10. Tile showed 508; true explicit up = 63. ───
const AUG10 = [
  ...rows(445, 'up', 'implicit_copy'),
  ...rows(63, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
  ...rows(48, 'neutral', 'implicit_regen_copy'),
  // A no-interaction session cannot have shipped, so it carries no shipped rating. Modelling
  // it this way is what reproduces the dashboard's 99% exactly (556/559), which is the check
  // that this fixture matches the real day rather than merely summing to 559.
  ...rows(1, undefined, 'no_interaction'),
];
const f10 = aggregate(AUG10);
console.log('\n2026-08-10 (tile showed 508, true explicit 👍 = 63):');
eq('blended ratings.up still reproduces the old 508', f10.ratings.up, 508);
eq('tile now renders explicitUp = 63', f10.explicitUp, 63);
eq('explicitDown = 2', f10.explicitDown, 2);
eq('implicitUp disclosed separately = 445', f10.implicitUp, 445);
eq('total matches the dashboard = 559', f10.total, 559);
eq('no abandoned rows yet, so engaged === total', f10.engaged, 559);
eq('shippedRate unchanged from the pre-fix report (99%)', f10.shippedRate, 99);

// ── Post-v9.7.540: implicit rejections and abandons arrive ────────────────────
console.log('\npost-v9.7.540 — implicit rejections must not masquerade as explicit 👎:');
const AFTER = [
  ...rows(400, 'up', 'implicit_copy'),
  ...rows(60, 'up', 'explicit'),
  ...rows(2, 'down', 'explicit'),
  ...rows(35, 'down', 'implicit_regen_no_copy'),
  ...rows(12, 'down', 'implicit_chip_no_copy'),
  ...rows(90, 'abandoned', 'no_interaction'),
];
const fA = aggregate(AFTER);
eq('explicit 👎 tile stays at the 2 real thumb clicks', fA.explicitDown, 2);
eq('implicit rejections counted separately (47)', fA.implicitDown, 47);
eq('explicit 👍 tile unaffected by the new volume (60)', fA.explicitUp, 60);
eq('abandoned recognised, not dropped (90)', fA.abandoned, 90);
eq('engaged excludes abandoned (509)', fA.engaged, 509);
eq('shippedRate stays on the engaged basis (460/509 = 90%)', fA.shippedRate, 90);
eq('usedRate exposes the all-generates view (460/599 = 77%)', fA.usedRate, 77);
eq('every rejection still reaches the sessions table (49)', fA.downSessions.length, 49);

// ── The real first day of the flush: 2026-08-11 ───────────────────────────────
// 34 abandoned rows, 28 of them with NO meta -> those never rendered a draft and must not
// count as rejections. Modelled as extension v9.7.541 now reports them: 'incomplete'.
console.log('\n2026-08-11 — incomplete sessions excluded from quality math:');
const AUG11 = [
  ...rows(102, 'up', 'implicit_copy'),
  ...rows(42, 'up', 'explicit'),
  ...rows(1, 'down', 'explicit'),
  ...rows(2, 'down', 'implicit_regen_no_copy'),
  ...rows(6, 'abandoned', 'no_interaction'),                       // draft produced, unused
  ...rows(28, 'incomplete', 'no_interaction', 'unknown'),          // never rendered a draft
];
const f11 = aggregate(AUG11);
eq('explicit 👍 = 42', f11.explicitUp, 42);
eq('explicit 👎 = 1', f11.explicitDown, 1);
eq('total still counts every session (181)', f11.total, 181);
eq('produced excludes incomplete (153)', f11.produced, 153);
eq('engaged excludes abandoned too (147)', f11.engaged, 147);
eq('shippedRate unchanged at 98% (144/147)', f11.shippedRate, 98);
eq('usedRate is now of drafts PRODUCED, not all sessions (144/153 = 94%)', f11.usedRate, 94);
eq('incomplete surfaced on its own (28)', f11.incomplete, 28);
eq('the phantom store has zero engaged sessions', (() => {
  const u = f11.byStore['unknown'];
  return (u.total || 0) - (u.abandoned || 0) - (u.incomplete || 0);
})(), 0);


// ── Real day 2026-08-11: the BY STORE 👎 column ────────────────────────────────
console.log('\n2026-08-11 — BY STORE 👎 split (report showed Honda Bay 7, Kia Bay 6):');
const AUG11_STORES = [
  ...rows(2, 'down', 'explicit', 'Toyota Baytown'),
  ...rows(1, 'down', 'implicit_regen_no_copy', 'Toyota Baytown'),
  ...rows(7, 'down', 'implicit_regen_no_copy', 'Honda Baytown'),
  ...rows(4, 'down', 'implicit_regen_no_copy', 'Kia Baytown'),
  ...rows(2, 'down', 'implicit_chip_no_copy',  'Kia Baytown'),
  ...rows(1, 'down', 'implicit_regen_no_copy', 'Honda Lafayette'),
  ...rows(2, 'down', 'implicit_regen_no_copy', 'unknown'),
  ...rows(170, 'up', 'implicit_copy', 'Honda Lafayette'),
  ...rows(49, 'up', 'explicit', 'Toyota Baytown'),
];
const fs11 = aggregate(AUG11_STORES).byStore;
eq('Toyota Baytown explicit 👎 = 2', fs11['Toyota Baytown'].explicitDown, 2);
eq('Honda Baytown explicit 👎 = 0, no-copy 7', [fs11['Honda Baytown'].explicitDown, fs11['Honda Baytown'].implicitDown], [0, 7]);
eq('Kia Baytown explicit 👎 = 0, no-copy 6', [fs11['Kia Baytown'].explicitDown, fs11['Kia Baytown'].implicitDown], [0, 6]);
eq('Honda Lafayette explicit 👎 = 0', fs11['Honda Lafayette'].explicitDown, 0);
eq('unknown explicit 👎 = 0', fs11['unknown'].explicitDown, 0);
eq('store explicit sum = 2, matching the tile', Object.values(fs11).reduce((a,b)=>a+b.explicitDown,0), 2);
eq('every store reconciles to the old merged count', Object.values(fs11).every(b => b.explicitDown + b.implicitDown === b.down), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
