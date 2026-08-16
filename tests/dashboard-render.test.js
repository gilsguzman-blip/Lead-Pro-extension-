#!/usr/bin/env node
'use strict';
/**
 * dashboard-render.test.js — end-to-end for the dashboard's 👍/👎 readers (dashboard v1.2).
 *
 * Runs the REAL pipeline: the 8/15 day → the shipped proxy aggregate() → the shipped dashboard
 * reader functions, sliced out of the HTML. Nothing is reimplemented on either side, so this
 * fails if either half drifts.
 *
 * THE INCIDENT: on 8/15 the dashboard's tile read "EXPLICIT 👎: 27" and its per-store column read
 * 16/4/4/2/1, while the daily report — same KV rows — correctly showed 0 explicit. Both tiles were
 * reading `ratings.up` / `ratings.down`, which cannot carry the explicit/implicit distinction;
 * only `signal` can, and the proxy has done that separation since v7.49/v7.51.
 *
 * COMPATIBILITY MATTERS HERE: top-level implicitDown is new in proxy v7.53. The dashboard must
 * render correctly against an older deployed proxy too, so the derive-from-ratings.down fallback
 * is exercised explicitly below — a renderer that only works against the newest worker would fail
 * silently the moment the deploy order is reversed.
 *
 *   usage: dashboard-render.test.js <dashboard.html> <proxy-worker.js>
 */
const fs = require('fs');
const vm = require('vm');

const [HTML, WORKER] = process.argv.slice(2);
if (!HTML || !WORKER) {
  console.error('usage: dashboard-render.test.js <dashboard.html> <proxy-worker.js>');
  process.exit(2);
}

// ── the dashboard's readers, verbatim out of the page ────────────────────────────────────
const html = fs.readFileSync(HTML, 'utf8');
const dctx = {};
vm.createContext(dctx);
for (const name of ['explicitDownOf', 'implicitDownOf', 'explicitUpOf', 'implicitUpOf',
                    'engagedOf', 'shippedRateOf', 'firstTryRateOf']) {
  const decl = 'function ' + name;
  const i = html.indexOf(decl);
  if (i < 0) { console.error('could not locate ' + name + ' in ' + HTML); process.exit(2); }
  let depth = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) break; }
  }
  vm.runInContext(html.slice(i, j + 1), dctx);
}
const R = {
  exDown: vm.runInContext('explicitDownOf', dctx),
  imDown: vm.runInContext('implicitDownOf', dctx),
  exUp:   vm.runInContext('explicitUpOf',   dctx),
  imUp:   vm.runInContext('implicitUpOf',   dctx),
  engaged:  vm.runInContext('engagedOf',       dctx),
  shipped:  vm.runInContext('shippedRateOf',   dctx),
  firstTry: vm.runInContext('firstTryRateOf',  dctx),
};

// ── the shipped proxy aggregate(), verbatim ──────────────────────────────────────────────
const wsrc = fs.readFileSync(WORKER, 'utf8');
const wctx = { console: { log() {}, warn() {} } };
vm.createContext(wctx);
{
  const hStart = wsrc.indexOf('function _newBucket() {');
  const hEnd = wsrc.indexOf('\n}', wsrc.indexOf('function _decorateBuckets(map) {')) + 2;
  const i = wsrc.indexOf('function aggregate(entries) {');
  if (hStart < 0 || i < 0) { console.error('could not locate aggregate() in ' + WORKER); process.exit(2); }
  let depth = 0, j = wsrc.indexOf('{', i);
  for (; j < wsrc.length; j++) {
    if (wsrc[j] === '{') depth++;
    else if (wsrc[j] === '}') { depth--; if (!depth) break; }
  }
  vm.runInContext(wsrc.slice(hStart, hEnd), wctx);
  vm.runInContext('var aggregate = ' + wsrc.slice(i, j + 1).replace(/^function aggregate/, 'function'), wctx);
}
const aggregate = vm.runInContext('aggregate', wctx);

// ── the real 8/15 day ────────────────────────────────────────────────────────────────────
const DAY = [
  { store: 'Community Honda Lafayette', rating: 'down',    signal: 'implicit_regen_no_copy', n: 11, regenCount: 1 },
  { store: 'Community Honda Lafayette', rating: 'down',    signal: 'implicit_chip_no_copy',  n: 5,  chipCount: 1 },
  { store: 'Community Honda Lafayette', rating: 'neutral', signal: 'implicit_regen_copy',    n: 3,  regenCount: 1 },
  { store: 'Community Toyota Baytown',  rating: 'down',    signal: 'implicit_regen_no_copy', n: 4,  regenCount: 1 },
  { store: 'Community Toyota Baytown',  rating: 'neutral', signal: 'implicit_regen_copy',    n: 2,  regenCount: 1 },
  { store: 'Community Kia Baytown',     rating: 'down',    signal: 'implicit_regen_no_copy', n: 4,  regenCount: 1 },
  { store: 'Community Kia Baytown',     rating: 'neutral', signal: 'implicit_regen_copy',    n: 2,  regenCount: 1 },
  { store: 'Community Honda Baytown',   rating: 'down',    signal: 'implicit_regen_no_copy', n: 2,  regenCount: 1 },
  { store: 'Community Honda Baytown',   rating: 'neutral', signal: 'implicit_regen_copy',    n: 1,  regenCount: 1 },
  { store: 'Audi Lafayette',            rating: 'down',    signal: 'implicit_regen_no_copy', n: 1,  regenCount: 1 },
];
const entries = [];
for (const g of DAY) for (let k = 0; k < g.n; k++) entries.push({
  id: 'g' + entries.length, ts: '2026-08-15T14:00:00.000Z', rating: g.rating, signal: g.signal,
  regenCount: g.regenCount || 0, chipCount: g.chipCount || 0, chipsUsed: g.chipCount ? ['direct'] : [],
  meta: { store: g.store, persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' }
});

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name);
         console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got)); }
}

const a = aggregate(entries);
const stores = ['Community Honda Lafayette','Community Toyota Baytown','Community Kia Baytown',
                'Community Honda Baytown','Audi Lafayette'];

console.log('\ndashboard v1.2 — what the tiles will actually render for 8/15');
console.log('page: ' + HTML + '\nproxy: ' + WORKER + '\n');

console.log('THE TILES:');
eq('EXPLICIT 👎 renders 0, not 27', R.exDown(a), 0);
eq('EXPLICIT 👍 renders 0, not 156', R.exUp(a), 0);
eq('the 👎 disclosure line shows 27 regenerated/chipped-unsent', R.imDown(a), 27);
eq('the 👍 disclosure line shows the implicit copies', R.imUp(a), a.implicitUp);
eq('explicit + implicit still equals the blended total the old tile showed',
  R.exDown(a) + R.imDown(a), a.ratings.down);

console.log('\nTHE PER-STORE COLUMN, which showed 16/4/4/2/1 under a 👎:');
eq('explicit 👎 per store', stores.map(s => R.exDown(a.byStore[s])), [0, 0, 0, 0, 0]);
eq('no-copy per store', stores.map(s => R.imDown(a.byStore[s])), [16, 4, 4, 2, 1]);

console.log('\nCOMPATIBILITY — an older proxy with no top-level implicitDown (v7.49–v7.52):');
const older = Object.assign({}, a);
delete older.implicitDown;                       // what v7.52 returns
eq('the tile is unaffected', R.exDown(older), 0);
eq('the disclosure derives 27 from ratings.down - explicitDown', R.imDown(older), 27);
const olderBucket = Object.assign({}, a.byStore['Community Honda Lafayette']);
delete olderBucket.implicitDown;                 // pre-v7.51 bucket shape
eq('a pre-v7.51 bucket derives its no-copy count too', R.imDown(olderBucket), 16);
eq('and a bucket with neither field reports 0 rather than NaN',
  R.imDown({ total: 5, up: 5 }), 0);

console.log('\nAN EXPLICIT THUMB IS STILL SHOWN — the split is not a mute:');
const withThumbs = aggregate(entries.concat([
  { id: 'x1', ts: '2026-08-15T15:00:00.000Z', rating: 'down', signal: 'explicit', regenCount: 0, chipCount: 0,
    chipsUsed: [], meta: { store: 'Audi Lafayette', persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' } },
  { id: 'x2', ts: '2026-08-15T15:05:00.000Z', rating: 'up', signal: 'explicit', regenCount: 0, chipCount: 0,
    chipsUsed: [], meta: { store: 'Audi Lafayette', persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' } },
]));
eq('one real thumbs-down reaches the tile', R.exDown(withThumbs), 1);
eq('one real thumbs-up reaches the tile', R.exUp(withThumbs), 1);
eq('...on the right store row', R.exDown(withThumbs.byStore['Audi Lafayette']), 1);
eq('...without inflating the no-copy count', R.imDown(withThumbs), 27);
eq('...and that store still shows its 1 no-copy separately',
  R.imDown(withThumbs.byStore['Audi Lafayette']), 1);

console.log('\nGUARDS — the readers never throw on a missing or empty payload:');
eq('undefined', [R.exDown(undefined), R.imDown(undefined), R.exUp(undefined), R.imUp(undefined)], [0, 0, 0, 0]);
eq('empty object', [R.exDown({}), R.imDown({}), R.exUp({}), R.imUp({})], [0, 0, 0, 0]);
eq('a bucket whose explicitDown exceeds down cannot go negative',
  R.imDown({ down: 1, explicitDown: 3 }), 0);

console.log('\nNO BLENDED FIELD IS RENDERED ANYWHERE — source audit:');
const script = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
const offenders = script.split('\n')
  .map((l, n) => [n + 1, l])
  .filter(([, l]) => !l.trim().startsWith('//'))
  .filter(([, l]) => /ratings\??\.\s*(up|down)|\bd\.down\b|\bdata\.down\b/.test(l))
  // the compatibility fallback inside implicitDownOf is the one legitimate reader of ratings.down
  .filter(([, l]) => !/const down = \(d\.ratings \? d\.ratings\.down : d\.down\) \|\| 0;/.test(l));
eq('zero remaining reads of ratings.up / ratings.down / bucket.down', offenders.map(o => o[0]), []);

// ── RATES (dashboard v1.3) ───────────────────────────────────────────────────────────────
// A store shaped like Honda Lafayette on 8/15: 85 signals, 59 first-try, 5 neutral (copied after a
// regen — those shipped), 16 down, and 5 sessions that produced nothing anyone used. The old page
// rendered 59/85 = 69%; the report rendered 64/80 = 80% shipped and 59/80 = 74% first-try.
const HONDA_LAF = [];
const pushN = (n, o) => { for (let k = 0; k < n; k++) HONDA_LAF.push(Object.assign(
  { id: 'h' + HONDA_LAF.length, ts: '2026-08-15T14:00:00.000Z', regenCount: 0, chipCount: 0, chipsUsed: [],
    meta: { store: 'Community Honda Lafayette', persona: 'bdc', leadSource: 'Facebook', scenario: 'standard' } }, o)); };
pushN(59, { rating: 'up',         signal: 'implicit_copy' });
pushN(5,  { rating: 'neutral',    signal: 'implicit_regen_copy', regenCount: 1 });
pushN(16, { rating: 'down',       signal: 'implicit_regen_no_copy', regenCount: 1 });
pushN(3,  { rating: 'abandoned',  signal: 'no_interaction' });
pushN(2,  { rating: 'incomplete', signal: 'no_interaction' });
const ha = aggregate(HONDA_LAF);
const hb = ha.byStore['Community Honda Lafayette'];

console.log('\nRATES — the engaged denominator, matching the report:');
eq('85 signals in, as on the real day', hb.total, 85);
eq('engaged is 80 — the 3 abandoned and 2 incomplete are excluded', R.engaged(hb), 80);
eq('shipped rate is 80%, not the 69% the old page showed', R.shipped(hb), 80);
eq('first-try is 74%', R.firstTry(hb), 74);
eq('the headline tile agrees with the store row on identical rows',
  [R.shipped(ha), R.firstTry(ha)], [80, 74]);
eq('neutral is IN the shipped numerator — a draft copied after a regen still went out',
  R.shipped(hb) > R.firstTry(hb), true);

console.log('\n   nothing to measure renders an em-dash, not 0%:');
eq('a bucket of only incomplete sessions has no rate', R.shipped({ total: 4, incomplete: 4 }), null);
eq('...and no first-try either', R.firstTry({ total: 4, incomplete: 4 }), null);
eq('a bucket of only abandoned sessions likewise', R.shipped({ total: 3, abandoned: 3 }), null);
eq('an empty payload does not throw', [R.shipped(undefined), R.firstTry(undefined), R.engaged(undefined)], [null, null, 0]);

console.log('\n   compatibility — payloads without the engaged pair still compute correctly:');
const rawBucket = { total: 85, up: 59, weak_up: 0, neutral: 5, down: 16, abandoned: 3, incomplete: 2 };
eq('derived from raw counts when engagedShippedRate is absent', R.shipped(rawBucket), 80);
eq('...and first-try too', R.firstTry(rawBucket), 74);
eq('a byDay row (pre-v7.54: shipped/firstTry present, engaged pair absent)',
  R.shipped({ total: 85, shipped: 64, firstTry: 59, abandoned: 3, incomplete: 2 }), 80);
eq('a byDay row with no incomplete field at all falls back to what it has',
  R.shipped({ total: 82, shipped: 64, firstTry: 59, abandoned: 3 }), 81);

console.log('\n   the old formulas are genuinely different — this is not a no-op:');
const oldStoreRate = Math.round(100 * ((hb.up||0) + (hb.weak_up||0)) / hb.total);
const oldSourceRate = Math.round(100 * (hb.up||0) / hb.total);
eq('old store formula (up+weak_up)/total gave 69%', oldStoreRate, 69);
eq('old lead-source formula up/total gave 69% too, by dropping weak_up as well', oldSourceRate, 69);
eq('new formula differs from both', R.shipped(hb) !== oldStoreRate, true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
