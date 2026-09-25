#!/usr/bin/env node
'use strict';
// (v7.70) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('valuefact-freshness.test.js');

/**
 * valuefact-freshness.test.js — proxy v7.70. NOTHING COULD ASK HOW OLD A STORE'S DATA WAS.
 *
 * 9/4 cost a full day on a question that should have taken five seconds: "is the Kia incentive
 * upload actually in Lead Pro?" It was — 110 lines uploaded, 110 in KV model for model, 110 loaded
 * by the extension, and both Sportage programs reached a real customer's draft. Nothing was broken.
 * Answering it was hard because NO SURFACE SHOWS WHAT LEAD PRO HOLDS:
 *
 *   - the Data Tool's summary table is a receipt for the file you just dropped (incResult is
 *     replaced on every Normalize; nothing merges across runs), so a Kia-only upload never appears
 *     beside the four stores from a different run;
 *   - dashboard/index.html has ZERO references to incentives or valuefact — there is no view;
 *   - and the survey script written to answer it printed "—" for every store's date, because
 *     GET /valuefact projected {store, count, incentives} and dropped `generated` — which the POST
 *     writes onto every blob.
 *
 * TWO REPAIRS, both narrow:
 *   (1) the GET returns `generated` and `storedCount`. Additive only — `count` keeps its exact
 *       meaning (lines surviving expiry/year filtering) and `incentives` is untouched, so the
 *       extension's reader behaves identically. storedCount makes the expiry kill-switch legible:
 *       a store whose lines have all lapsed reads 0 of 110 instead of looking like a failed upload.
 *   (2) the POST MERGES the meta blob instead of rebuilding it from the payload. Per-dealer keys
 *       were always correct — verified against live KV, a Kia-only upload cannot touch Toyota's —
 *       but meta claimed the system knew about one store after a single-store publish. Nothing
 *       reads it today, so it cost nothing; it is the only record of what has been published, and
 *       it was wrong in the way that would mislead the first person to open it.
 *
 * Executes the SHIPPED handlers against a fake KV and the REAL Kia payload shape.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv.slice(2).find(a => /cloudflare-worker.*\.js$/.test(a));
if (!PROXY) { console.error('usage: valuefact-freshness.test.js <cloudflare-worker.js>'); process.exit(2); }

const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ── Lift the two SHIPPED handlers and run them over a fake KV ────────────────
function slice(a, b, what) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(what + ' start not found — NOT IN THIS BUILD');
  const j = src.indexOf(b, i);
  if (j < 0) throw new Error(what + ' end not found');
  return src.slice(i, j + b.length);
}

let getBlock, postBlock, extractErr = '';
try {
  getBlock  = slice("    if (request.method === 'GET' && url.pathname.endsWith('/valuefact')) {",
                    "      return corsResponse(JSON.stringify({ ok: true, valuefact: vf }), 200);\n    }", 'GET /valuefact');
  postBlock = slice("    if (request.method === 'POST' && (url.pathname.endsWith('/inventory') || url.pathname.endsWith('/valuefact'))) {",
                    "generated: gen }), 200);\n    }", 'POST upload');
} catch (e) { extractErr = e.message; }

function makeKV(seed) {
  const store = Object.assign({}, seed || {});
  return {
    store,
    get: async k => (k in store ? store[k] : null),
    put: async (k, v) => { store[k] = v; }
  };
}

// Drives the shipped GET handler. `today` is injected so expiry is deterministic.
async function doGet(kv, dealer, today, year) {
  const sb = {
    JSON, String, Array, Object, Boolean, console,
    centralTodayStr: () => today,
    corsResponse: (body, status) => ({ body, status }),
    Response: function (b, i) { return { body: b, init: i }; },
    request: { method: 'GET' },
    url: { pathname: '/valuefact', searchParams: { get: k => (k === 'dealer' ? dealer : (k === 'year' ? (year || null) : null)) } },
    env: { LEADPRO_REGISTRY: kv }
  };
  vm.createContext(sb);
  const out = await vm.runInContext('(async () => { ' + getBlock + ' })()', sb);
  return out ? JSON.parse(out.body) : null;
}

// Drives the shipped POST handler.
async function doPost(kv, payload, pathname) {
  const sb = {
    JSON, String, Array, Object, Date, console,
    corsResponse: (body, status) => ({ body, status }),
    request: { method: 'POST', json: async () => payload },
    url: { pathname: pathname || '/valuefact' },
    env: { LEADPRO_REGISTRY: kv },
    validateLicenseRecord: async () => ({ valid: true })
  };
  vm.createContext(sb);
  const out = await vm.runInContext('(async () => { ' + postBlock + ' })()', sb);
  return out ? JSON.parse(out.body) : null;
}

// Sharon's store, in the shape the Data Tool actually uploads.
const KIA = (gen, expires) => ({
  store: 'Kia Baytown', count: 3, generated: gen,
  incentives: [
    { model: 'Sportage', year: '2026', line: 'Sportage — 4.99% APR for 48-84 mos', expires: expires },
    { model: 'Sportage', year: '2026', line: 'Sportage — $750 Customer Cash',      expires: expires },
    { model: 'Telluride', year: '2027', line: 'Telluride — $750 Conquest Cash',    expires: expires }
  ]
});

(async () => {
console.log('\nproxy v7.70 — a store must be able to say how old its data is');
console.log('worker under test: ' + path.basename(PROXY));
if (extractErr) console.log('  NOTE  extraction failed: ' + extractErr + '\n        assertions below WILL fail, by design.');
console.log('');

if (!extractErr) {
  // ── THE REPAIR ─────────────────────────────────────────────────────────────
  console.log('freshness is answerable from outside the worker:');
  const kv = makeKV({ 'valuefact:6190': JSON.stringify(KIA('2026-09-04', '2026-09-30')) });

  const live = await doGet(kv, '6190', '2026-09-04');
  check('the publish date is returned', live.valuefact.generated, '2026-09-04');
  check('...alongside how many lines are stored', live.valuefact.storedCount, 3);
  check('...and how many are still live', live.valuefact.count, 3);

  // ── NOTHING EXISTING MAY CHANGE ────────────────────────────────────────────
  // The extension reads valuefact.incentives and its length. If either moved, every store in the
  // fleet loses its incentives at once, so both are asserted explicitly.
  console.log('\nevery existing reader behaves identically:');
  check('the incentives array is unchanged in shape', live.valuefact.incentives.length, 3);
  check('...and carries the real line text', live.valuefact.incentives[0].line, 'Sportage — 4.99% APR for 48-84 mos');
  check('the store name still comes back', live.valuefact.store, 'Kia Baytown');
  check('ok is still true', live.ok, true);

  // ── THE KILL-SWITCH IS NOW LEGIBLE ─────────────────────────────────────────
  // "0 of 3" and "nothing uploaded" used to look the same from outside. That distinction is the
  // whole reason a lapsed store is worth surfacing rather than guessing at.
  console.log('\na lapsed store reads as lapsed, not as an empty upload:');
  const lapsed = await doGet(kv, '6190', '2026-10-01');   // every line expired 9/30
  check('no lines survive expiry', lapsed.valuefact.count, 0);
  check('...but the store still reports what it holds', lapsed.valuefact.storedCount, 3);
  check('...and when it was published, so the fix is obvious', lapsed.valuefact.generated, '2026-09-04');

  console.log('\nthe year filter is untouched:');
  const yr = await doGet(kv, '6190', '2026-09-04', '2026');
  check('?year=2026 keeps only the 2026 lines', yr.valuefact.count, 2);
  check('...and still reports the full stored count', yr.valuefact.storedCount, 3);

  console.log('\nthe absent cases still fail closed:');
  const none = await doGet(makeKV({}), '6190', '2026-09-04');
  check('a store with no blob returns null, not a crash', none.valuefact, null);
  const bad = await doGet(makeKV({ 'valuefact:6190': '{not json' }), '6190', '2026-09-04');
  check('a corrupt blob returns null rather than throwing', bad.valuefact, null);
  const older = await doGet(makeKV({ 'valuefact:6190': JSON.stringify({ store: 'Kia', count: 3,
                    incentives: KIA('x','2026-09-30').incentives }) }), '6190', '2026-09-04');
  check('a blob written before `generated` existed reports null, not undefined', older.valuefact.generated, null);

  // ── THE META BLOB ──────────────────────────────────────────────────────────
  // The exact sequence from 9/4: a four-store batch, then a Kia-only upload.
  console.log('\nthe meta blob stops forgetting the stores it is not carrying:');
  // (v9.7.630) `generated` SITS INSIDE `valuefacts`, NOT BESIDE IT. The worker reads
  // `payload.generated` where `payload = body.valuefacts`, and the Data Tool posts
  // `{licenseKey, valuefacts: {generated: TODAY, type, stores}}` (datatool/index.html:968, 986).
  // This fixture had `generated` at the body's top level — a shape nothing sends — so the worker
  // fell through to `new Date()` and the assertion below compared today's date against a
  // hardcoded '2026-09-04'. It passed on 9/4 for exactly that reason and failed on 9/5, which is
  // the only way anyone was ever going to notice. The worker was correct throughout.
  const kv2 = makeKV({});
  await doPost(kv2, { licenseKey: 'k', valuefacts: { generated: '2026-09-04', stores: {
    '6189': { store: 'Toyota Baytown',   count: 1, incentives: [{ line: 'a' }] },
    '6191': { store: 'Honda Baytown',    count: 1, incentives: [{ line: 'b' }] },
    '21135':{ store: 'Audi Lafayette',   count: 1, incentives: [{ line: 'c' }] },
    '24399':{ store: 'Honda Lafayette',  count: 1, incentives: [{ line: 'd' }] }
  } } });
  await doPost(kv2, { licenseKey: 'k', valuefacts: { generated: '2026-09-04', stores: {
    '6190': { store: 'Kia Baytown', count: 3, incentives: KIA('2026-09-04','2026-09-30').incentives }
  } } });

  const meta = JSON.parse(kv2.store['valuefact:meta']);
  check('all five stores are listed after a single-store upload',
    Object.keys(meta.stores).sort(), ['21135','24399','6189','6190','6191']);
  check('...the Kia upload is recorded', meta.stores['6190'].store, 'Kia Baytown');
  check('...and the four from the earlier batch survived it', meta.stores['6189'].store, 'Toyota Baytown');
  check('each store carries its own publish date', meta.stores['6190'].generated, '2026-09-04');
  check('each store carries its own timestamp', typeof meta.stores['6189'].updatedAt, 'number');
  // (v9.7.630) The date must come from the PAYLOAD, never from the clock — pinned with a date
  // that cannot coincide with today, so this can never again pass by calendar accident.
  const kvDate = makeKV({});
  await doPost(kvDate, { licenseKey: 'k', valuefacts: { generated: '2019-01-02', stores: {
    '6190': { store: 'Kia Baytown', count: 1, incentives: [{ line: 'x' }] }
  } } });
  const metaDate = JSON.parse(kvDate.store['valuefact:meta']);
  check('the publish date is the uploaded one, not the server clock',
    metaDate.stores['6190'].generated, '2019-01-02');
  check('...and it reaches the per-dealer blob too',
    JSON.parse(kvDate.store['valuefact:6190']).generated, '2019-01-02');
  // The fallback is still correct behaviour when the upload genuinely omits it.
  const kvNoDate = makeKV({});
  await doPost(kvNoDate, { licenseKey: 'k', valuefacts: { stores: {
    '6190': { store: 'Kia Baytown', count: 1, incentives: [{ line: 'x' }] }
  } } });
  check('an upload with no date falls back to today, in ISO form',
    /^\d{4}-\d{2}-\d{2}$/.test(JSON.parse(kvNoDate.store['valuefact:meta']).stores['6190'].generated), true);

  // The behaviour that was never broken, asserted so a future meta change cannot quietly break it.
  console.log('\nper-dealer data was never the problem, and still is not:');
  check("Kia's own key holds its lines", JSON.parse(kv2.store['valuefact:6190']).count, 3);
  check("Toyota's key is untouched by the Kia upload", JSON.parse(kv2.store['valuefact:6189']).store, 'Toyota Baytown');
  check("...and Audi's", JSON.parse(kv2.store['valuefact:21135']).store, 'Audi Lafayette');
  const after = await doGet(kv2, '6190', '2026-09-04');
  check('a GET after both uploads reads Kia back whole', after.valuefact.count, 3);

  console.log('\ninventory uploads share the merge and are unaffected otherwise:');
  const kv3 = makeKV({});
  await doPost(kv3, { licenseKey: 'k', generated: '2026-09-04', inventory: { stores: {
    '6189': { store: 'Toyota Baytown', count: 1, units: [{ stock: 'A' }] } } } }, '/inventory');
  await doPost(kv3, { licenseKey: 'k', generated: '2026-09-04', inventory: { stores: {
    '6190': { store: 'Kia Baytown', count: 1, units: [{ stock: 'B' }] } } } }, '/inventory');
  const imeta = JSON.parse(kv3.store['inventory:meta']);
  check('both stores listed in inventory meta', Object.keys(imeta.stores).sort(), ['6189','6190']);
  check('units still land per dealer', JSON.parse(kv3.store['inventory:6190']).units.length, 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
