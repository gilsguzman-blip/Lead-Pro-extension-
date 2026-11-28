#!/usr/bin/env node
'use strict';
// (v9.7.606) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('inventory-freshness.test.js');

/**
 * inventory-freshness.test.js — v9.7.606. WE TOLD A CUSTOMER A CAR WAS IN STOCK. IT WASN'T.
 *
 * LIVE, 8/31. Varun Lele, Community Honda Lafayette, lead 2058167084. His 2026 CR-V Hybrid Sport
 * Touring had sold, the SOLD pivot offered a replacement, and the delivered email said:
 *
 *   "A Canyon River Blue 2026 CR-V Hybrid Sport Touring IS IN STOCK, and qualified buyers may be
 *    eligible for 2.49% APR for 24–36 months."
 *
 * Gil checked it against the day's inventory — the one that had just been fed to LP — and the unit
 * is not in it.
 *
 * THE LOG GIVES THE CAUSE IN ITS ORDERING, and no inference is needed:
 *   line 29  [LP VFC DIAG] fetching .../valuefact?dealer=24399     ← this grab's feeds requested
 *   line 37  [LP SOLD PIVOT DIAG] leading with incentive on "…(Canyon River Blue Metallic)"
 *   line 61  [LP VFC DIAG] inventory loaded for dealer 24399 — 221 unit(s)  ← today's data arrives
 *
 * The pivot picked the vehicle, and the APR to quote on it, twenty-four lines BEFORE the current
 * inventory landed. It scored against the previous snapshot.
 *
 * THE ASYMMETRY. The vehicle the customer ASKED about is verified — [LP STOCK CLAIM DIAG] reports
 * confirmedPresent:false and the sold-signal check confirmedAvailable:false, which is why the pivot
 * ran at all. The vehicle we steered him TO got no check: being in a cached feed was treated as
 * proof of presence. The unit records carry no status field at all, so membership is the only
 * signal there is — and a stale snapshot makes it worthless.
 *
 * WHAT THIS DOES NOT DO: filter units, guess at feed semantics, or return to the vague
 * "I'll line up some options" stall that v9.7.498 removed. The unit is still named. Only the claim
 * that it is physically on the lot is withheld when the data behind it is not this grab's.
 *
 * Drives the SHIPPED helper and the SHIPPED directive strings. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: inventory-freshness.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function _lpInvFreshness(dealerId) {');
  if (a < 0) throw new Error('_lpInvFreshness not found');
  const endMark = '\n}';
  const b = src.indexOf(endMark, src.indexOf('catch (e) { return { fresh: false, settled: false, ageMs: -1', a));
  if (b < 0) throw new Error('_lpInvFreshness end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

function freshness(impl, entry) {
  const sb = { Date, _lpValueFactCache: entry === null ? {} : { '24399': entry } };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return vm.runInContext('_lpInvFreshness', sb)('24399');
}

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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const NOW = Date.now();

console.log('\nv9.7.606 — an "in stock" claim needs this grab\'s inventory');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── VARUN'S EXACT TIMING ────────────────────────────────────────────────────
console.log("Varun Lele, 8/31 — the snapshot that produced the claim:");

check('the grab requested at T, inventory still in flight → NOT fresh',
  i => freshness(i, { fetchedAt: NOW, inv: { units: [{}] } }).fresh, false);

check('...and it says so, naming the reason rather than a bare false',
  i => /has not returned yet/.test(freshness(i, { fetchedAt: NOW, inv: { units: [{}] } }).reason), true);

check('inventory that settled BEFORE this grab was requested → NOT fresh',
  i => freshness(i, { fetchedAt: NOW, invSettledAt: NOW - 90000, inv: { units: [{}] } }).fresh, false);

check('...and the reason quantifies how far behind it is',
  i => /predates this grab/.test(freshness(i, { fetchedAt: NOW, invSettledAt: NOW - 90000 }).reason), true);

// ── THE HEALTHY CASE MUST STAY HEALTHY ──────────────────────────────────────
// The risk of this change is over-suppression: a correct in-stock claim being withheld.
console.log('\nwhen this grab\'s inventory is in hand, nothing changes:');

check('settled after the request → fresh',
  i => freshness(i, { fetchedAt: NOW - 4000, invSettledAt: NOW - 1000, inv: { units: [{}] } }).fresh, true);

check('settled at the same millisecond as the request → fresh, not a boundary miss',
  i => freshness(i, { fetchedAt: NOW, invSettledAt: NOW }).fresh, true);

check('a fresh snapshot reports settled and a real age',
  i => { const r = freshness(i, { fetchedAt: NOW - 4000, invSettledAt: NOW - 1000 });
         return [r.settled, r.ageMs >= 0]; }, [true, true]);

// ── ABSENT AND BROKEN STATES ────────────────────────────────────────────────
console.log('\nthe missing cases fail closed, never open:');

check('no cache entry for the dealer → not fresh',
  i => freshness(i, null).fresh, false);
check('a cache entry with no inventory at all → not fresh',
  i => freshness(i, { fetchedAt: NOW }).fresh, false);
check('a cache entry missing fetchedAt entirely cannot throw',
  i => freshness(i, { invSettledAt: NOW }).settled, true);

// ── THE DIRECTIVE THE PROMPT ACTUALLY CARRIES ───────────────────────────────
// A correct helper wired to nothing is the v9.7.561 failure. Assert the strings that reach the model.
console.log('\nthe directive withholds presence on a stale snapshot, and still names the unit:');

check('the unqualified "real, in-stock alternative" is now behind the freshness gate',
  i => /_invFresh\.fresh\s*\n?\s*\?\s*'is a real, in-stock alternative/.test(strip(i.src)), true);

check('the stale wording does not assert the lot',
  i => /appears in our inventory list as a comparable alternative/.test(strip(i.src)), true);

check('the exact sentence that reached Varun is banned by name',
  i => /do NOT[\s\S]{0,120}"is in stock"/.test(strip(i.src)), true);

check('...along with the other presence phrasings',
  i => ['"we have it here"', '"it is available"', '"ready to see"'].every(p => strip(i.src).indexOf(p) >= 0), true);

check('appointment times for an unverified unit are refused',
  i => /do NOT offer\s*'?\s*\+?\s*'?\s*appointment times to come see THIS unit/.test(strip(i.src).replace(/\s+/g, ' ')), true);

check('naming the unit is still REQUIRED — no return to the v9.7.498 vague stall',
  i => /must not become a vague/.test(strip(i.src)), true);

check('the generic PIVOT TO THESE branch is gated too, not just the incentive one',
  i => /PIVOT TO THESE — ' \+ \(_invFresh\.fresh/.test(strip(i.src)), true);

check('the in-transit branch is untouched — it was already honest',
  i => /currently in transit \(VIN allocated, not yet on the lot\)/.test(strip(i.src)), true);

// ── OBSERVABILITY ───────────────────────────────────────────────────────────
console.log('\nthe decision is visible in the log:');
check('[LP INVENTORY FRESHNESS DIAG] reports the verdict and the unit count',
  i => /\[LP INVENTORY FRESHNESS DIAG\][\s\S]{0,200}units:/.test(strip(i.src)), true);
check('...and states the consequence when stale',
  i => /an in-stock claim will NOT be made/.test(strip(i.src)), true);
check('the settle stamp is written when inventory actually lands',
  i => /_c\.invSettledAt = Date\.now\(\);/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
