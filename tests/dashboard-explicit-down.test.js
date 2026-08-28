#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('dashboard-explicit-down.test.js');

/**
 * dashboard-explicit-down.test.js — the 8/15 contract for any renderer of the "EXPLICIT 👎" tile.
 *
 * REPORTED: the live LeadPro Dashboard showed EXPLICIT 👎: 27 and per-store 👎 of 16/4/4/2/1 on
 * 8/15, while the daily report — reading the same KV rows — correctly showed 0 explicit. The
 * proposed location for the fix was the leadpro-proxy Worker's aggregation.
 *
 * IT IS NOT THERE. The proxy already emits the split, and has since v7.49 (tiles) and v7.51
 * (per-bucket columns, whose own header says it exists "so a renderer's 👎 column can stop merging
 * a thumbs-down with a regen-then-abandoned session"). This suite proves that against the real
 * day: the shipped aggregate() returns explicitDown 0 and ratings.down 27 for 8/15, and every
 * per-store bucket returns explicitDown 0 alongside implicitDown 16/4/4/2/1. A renderer showing 27
 * is reading ratings.down; the field it wants is explicitDown, which is already on the wire.
 *
 * FIXTURE PROVENANCE: the 35 rows are the real 8/15 export (leadpro-feedback-pairs). That export
 * omits `signal`, so it is reconstructed here exactly as the extension's _lpFeedbackDeriveSignalType
 * would — and note that the reconstruction cannot manufacture the answer: ALL 27 down rows carry a
 * regen or a chip, so not one of them is even a candidate for an explicit thumb. That is an
 * independent corroboration of the report's 0, from data that never carried the field.
 *
 *   usage: dashboard-explicit-down.test.js <proxy-worker.js>
 */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: dashboard-explicit-down.test.js <proxy-worker.js>'); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');

// Slice the shipped aggregate() by brace-walking from its declaration.
const decl = 'function aggregate(entries) {';
const i = src.indexOf(decl);
if (i < 0) { require('./lib/fatal-guard.js').bail('dashboard-explicit-down.test.js', 'could not locate aggregate() in ' + FILE); }
let depth = 0, j = src.indexOf('{', i);
for (; j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (!depth) break; }
}
const ctx = { console: { log() {}, warn() {} } };
vm.createContext(ctx);
// aggregate() calls the four bucket helpers defined just above it — load them verbatim first.
const hStart = src.indexOf('function _newBucket() {');
const hEnd = src.indexOf('\n}', src.indexOf('function _decorateBuckets(map) {')) + 2;
if (hStart < 0 || hEnd < 2) { require('./lib/fatal-guard.js').bail('dashboard-explicit-down.test.js', 'could not locate the bucket helpers in ' + FILE); }
vm.runInContext(src.slice(hStart, hEnd), ctx);
vm.runInContext('var aggregate = ' + src.slice(i, j + 1).replace(/^function aggregate/, 'function'), ctx);
const aggregate = vm.runInContext('aggregate', ctx);

// ── the real 8/15 day, as counts per (rating, signal, store) ──────────────────────────────
// Transcribed from the export: 27 down (13 regen+chip, 9 regen only, 5 chip only) and 8 neutral
// (all regen, none chipped), across the five rooftops.
const DAY = [
  // Community Honda Lafayette — 16 down, 3 neutral
  { store: 'Community Honda Lafayette', rating: 'down',    signal: 'implicit_regen_no_copy', n: 11, regenCount: 1 },
  { store: 'Community Honda Lafayette', rating: 'down',    signal: 'implicit_chip_no_copy',  n: 5,  chipCount: 1 },
  { store: 'Community Honda Lafayette', rating: 'neutral', signal: 'implicit_regen_copy',    n: 3,  regenCount: 1 },
  // Community Toyota Baytown — 4 down, 2 neutral
  { store: 'Community Toyota Baytown',  rating: 'down',    signal: 'implicit_regen_no_copy', n: 4,  regenCount: 1 },
  { store: 'Community Toyota Baytown',  rating: 'neutral', signal: 'implicit_regen_copy',    n: 2,  regenCount: 1 },
  // Community Kia Baytown — 4 down, 2 neutral
  { store: 'Community Kia Baytown',     rating: 'down',    signal: 'implicit_regen_no_copy', n: 4,  regenCount: 1 },
  { store: 'Community Kia Baytown',     rating: 'neutral', signal: 'implicit_regen_copy',    n: 2,  regenCount: 1 },
  // Community Honda Baytown — 2 down, 1 neutral
  { store: 'Community Honda Baytown',   rating: 'down',    signal: 'implicit_regen_no_copy', n: 2,  regenCount: 1 },
  { store: 'Community Honda Baytown',   rating: 'neutral', signal: 'implicit_regen_copy',    n: 1,  regenCount: 1 },
  // Audi Lafayette — 1 down
  { store: 'Audi Lafayette',            rating: 'down',    signal: 'implicit_regen_no_copy', n: 1,  regenCount: 1 },
];
const entries = [];
for (const g of DAY) {
  for (let k = 0; k < g.n; k++) {
    entries.push({
      id: 'gen_' + g.store.replace(/\W/g, '') + '_' + g.rating + '_' + k,
      ts: '2026-08-15T14:00:00.000Z', rating: g.rating, signal: g.signal,
      regenCount: g.regenCount || 0, chipCount: g.chipCount || 0, chipsUsed: g.chipCount ? ['direct'] : [],
      meta: { store: g.store, persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' }
    });
  }
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name);
         console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got)); }
}

const a = aggregate(entries);

console.log('\nthe 8/15 contract — EXPLICIT 👎 must be 0, not 27');
console.log('file under test: ' + FILE + '\n');

console.log('the fixture is the real day:');
eq('35 rows total', a.total, 35);
eq('27 down ratings', a.ratings.down, 27);
eq('8 neutral (copied after a regen — these shipped)', a.ratings.neutral, 8);

console.log('\nwhat the proxy already returns:');
eq('explicitDown is 0 — the number the tile should show', a.explicitDown, 0);
eq('implicitDown is 27 — regenerated or chipped, then left unsent', a.implicitDown, 27);
eq('ratings.down is 27 — what a renderer showing "EXPLICIT 👎: 27" is reading instead',
  a.ratings.down, 27);
eq('explicitUp is 0 as well (the 👍 tile has the same defect)', a.explicitUp, 0);
eq('the two down fields sum to ratings.down, so nothing is lost by splitting',
  a.explicitDown + a.implicitDown, a.ratings.down);

console.log('\nper-store — the 👎 column, which showed 16/4/4/2/1:');
const stores = ['Community Honda Lafayette','Community Toyota Baytown','Community Kia Baytown',
                'Community Honda Baytown','Audi Lafayette'];
eq('every store reports explicitDown 0',
  stores.map(s => a.byStore[s].explicitDown), [0, 0, 0, 0, 0]);
eq('...while implicitDown carries the counts the dashboard is showing',
  stores.map(s => a.byStore[s].implicitDown), [16, 4, 4, 2, 1]);
eq('...and bucket.down still holds the blended total for any consumer that wants it',
  stores.map(s => a.byStore[s].down), [16, 4, 4, 2, 1]);
eq('per-store implicitDown sums to the day total',
  stores.reduce((t, s) => t + a.byStore[s].implicitDown, 0), 27);

console.log('\nthe split is emitted for the other breakdowns too (v7.51):');
eq('byPersona carries explicitDown', typeof a.byPersona.bdc.explicitDown, 'number');
eq('byLeadSource carries explicitDown', typeof a.byLeadSource.Facebook.explicitDown, 'number');
eq('byScenario/byFlag bucket shape includes the split',
  ['explicitUp','explicitDown','implicitDown'].every(k => k in a.byStore['Audi Lafayette']), true);

console.log('\nan explicit thumb is still counted as explicit — the split is not a mute:');
const withThumbs = entries.concat([
  { id: 'x1', ts: '2026-08-15T15:00:00.000Z', rating: 'down', signal: 'explicit', regenCount: 0, chipCount: 0,
    chipsUsed: [], meta: { store: 'Audi Lafayette', persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' } },
  { id: 'x2', ts: '2026-08-15T15:05:00.000Z', rating: 'up', signal: 'explicit', regenCount: 0, chipCount: 0,
    chipsUsed: [], meta: { store: 'Audi Lafayette', persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' } },
]);
const b = aggregate(withThumbs);
eq('one real thumbs-down lands in explicitDown', b.explicitDown, 1);
eq('one real thumbs-up lands in explicitUp', b.explicitUp, 1);
eq('...and on the right store bucket', b.byStore['Audi Lafayette'].explicitDown, 1);
eq('...without disturbing the implicit counts', b.implicitDown, 27);
eq('ratings.down rises to 28, which is why the blended field is the wrong one to render',
  b.ratings.down, 28);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
