#!/usr/bin/env node
'use strict';
/**
 * edge-bypass.test.js — v9.7.584. THE REGENERATE BUTTON RETURNED THE DRAFT IT WAS ASKED TO REPLACE.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────
 * The proxy's edge cache is keyed on SHA-256(centralDate + systemText + userText). A plain
 * Regenerate sets no directive and changes no lead state, so both texts are BYTE-IDENTICAL to the
 * draft the agent is asking to replace. Same key, same entry, same draft — returned in ~100ms.
 * A regen on an unchanged lead could not produce anything different. Structurally, not occasionally.
 *
 * The CHIP path already handled this, and its comment says why: "Chip clicks always bypass edge
 * cache — agent explicitly wants fresh output." That was the ONLY assignment of the bypass flag in
 * the entire build. A chip and a regen are the same request — "this draft is wrong, give me another"
 * — and only one of them was honoured.
 *
 * ── WHY IT READ AS "REGEN DOES NOTHING" RATHER THAN AN ODDITY ─────────────────────────────
 * EDGE_CACHE_TTL is 120s, and the key carries "CURRENT TIME: <h>:<mm> Central" so it turns over
 * every clock minute. The reachable window is therefore short — and it is EXACTLY the window in
 * which a person reads a draft and clicks Regenerate.
 *
 * ── MEASURED, 8/26 ────────────────────────────────────────────────────────────────────────
 * Every abandoned session that day returned byte-identical text or nothing; every session that got a
 * genuine change was kept. 11 of 11, no exceptions. Median latency across all requests was 207ms
 * against a PRIMARY call average of 3230ms — most traffic never reached the model at all.
 *
 * ── WHAT THIS SUITE PINS ──────────────────────────────────────────────────────────────────
 * The bypass decision is EXECUTED out of the shipped file, not scanned for. Source-text assertions
 * have twice this week stayed green through a live outage in this repo, once by matching the buggy
 * identifier verbatim.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: edge-bypass.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '    var _inventoryBypass    =';
// END must exist in the PRE-FIX build too, or the non-vacuity run cannot even load it and prints
// nothing — which reads exactly like "the suite does not catch the bug". A vacuous check of a
// vacuous check; this repo has made that mistake before. This comment follows the bypass in both.
const END   = '    // (v9.7.462/457 fix) 90s client-side timeout';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('edge-bypass block not found in ' + file);
  // The block reads lastScrapedData, window and _isRegenSession, and writes payload.noEdgeCache.
  // The END anchor sits AFTER the `if` and after the diag, so the decision is inside the slice in
  // both the fixed and the pre-fix build. The diag's console.log is stubbed below.
  const fn = new vm.Script(
    '(function(lastScrapedData, window, _isRegenSession){\n var payload = {};\n' +
    ' var console = { log: function(){} };\n' +
    src.slice(a, b) +
    '\nreturn { bypass: !!payload.noEdgeCache, state: !!_stateBypass }; })'
  ).runInNewContext({});
  return { name: path.basename(path.dirname(file)), run: fn, src };
}

const impls = BUILDS.map(extract);
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

// An ordinary lead with nothing special about its state.
const PLAIN = {};
const call = (i, scraped, win, regen) => i.run(scraped || PLAIN, win || {}, !!regen).bypass;

console.log('\nv9.7.584 — a regen asks for a different draft, so it must not be served the same one');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE FIX ───────────────────────────────────────────────────────────────────
console.log('the regen itself:');

check('A REGEN BYPASSES THE EDGE CACHE — this is the whole fix',
  i => call(i, PLAIN, {}, true), true);

check('...and a FIRST-PASS draft on the same lead still uses the cache',
  i => call(i, PLAIN, {}, false), false);

check('a regen bypasses even when nothing about the lead state has changed',
  i => i.run(PLAIN, {}, true), { bypass: true, state: false });

// ── The chip path, which was already right ────────────────────────────────────
console.log('\nthe chip path is unchanged — it was already correct:');

check('a chip still bypasses',
  i => call(i, PLAIN, { _lpBypassEdgeCache: true }, false), true);

check('a chip that is ALSO a regen bypasses once, not twice — the flags are an OR',
  i => call(i, PLAIN, { _lpBypassEdgeCache: true }, true), true);

// ── The lead-state legs must all survive ──────────────────────────────────────
console.log('\nevery pre-existing state bypass still fires — this is an addition, not a rewrite:');

const STATE_LEGS = [
  ['inventoryWarning',    { inventoryWarning: true }],
  ['vehiclePendingSale',  { vehiclePendingSale: true }],
  ['hasExitSignal',       { hasExitSignal: true }],
  ['hasPauseSignal',      { hasPauseSignal: true }],
  ['isSmsOptOutOnly',     { isSmsOptOutOnly: true }],
  ['isShowroomFollowUp',  { isShowroomFollowUp: true }],
  ['showroomVisitToday',  { showroomVisitToday: true }],
  ['hasCustomerReply',    { hasCustomerReply: true }],
  ['hasApptSet',          { hasApptSet: true }]
];
for (const [label, scraped] of STATE_LEGS) {
  check('  ' + label + ' still bypasses on a NON-regen',
    i => call(i, scraped, {}, false), true);
}

check('a lead with none of those flags is still cache-eligible on a first pass',
  i => i.run(PLAIN, {}, false), { bypass: false, state: false });

// ── Non-vacuity, stated in the suite rather than assumed ──────────────────────
console.log('\nthe control that makes the first assertion mean something:');

check('regen is the ONLY difference between the two headline cases',
  i => {
    const off = i.run(PLAIN, {}, false);
    const on  = i.run(PLAIN, {}, true);
    // Same lead, same window, same everything except the regen flag.
    return { firstPass: off.bypass, regen: on.bypass, stateIdentical: off.state === on.state };
  }, { firstPass: false, regen: true, stateIdentical: true });

// ── The diagnostic ────────────────────────────────────────────────────────────
console.log('\nthe decision is reported, so bypass volume is countable:');

check('the diag names which leg fired rather than just that one did',
  i => ({
    regen: /' \| regen:' \+ !!_isRegenSession/.test(i.src),
    chip:  /' chip:' \+ !!window\._lpBypassEdgeCache/.test(i.src),
    state: /_customerReplied && 'customerReplied'/.test(i.src)
  }), { regen: true, chip: true, state: true });

check('it reports the eligible case too — a diag that only fires on bypass cannot show a ratio',
  i => /'BYPASS' : 'cache eligible'/.test(i.src), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
