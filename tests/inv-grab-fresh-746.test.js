#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('inv-grab-fresh-746.test.js');
// (v9.7.746) Kia Baytown lead 2091863573, 9/30 (log269, dump 50a1f7eb; log270, dump 6431bf75). The side panel loaded
// Kia's inventory at 10:00 with VG053284 (a 2027 Telluride EX, sold 9/28) still in it. The feed was re-uploaded after
// that without it, but the panel's snapshot was under its 30-minute age limit, so the 10:23 grab never asked again:
// "I was looking at the Kia Telluride Ex in Jade Green" was pinned to the sold unit and the draft said "the 2027 Kia
// Telluride EX in Jade Green is here". Gil: "VG053284 sold on the 28th. I refreshed the feed today just before the
// grab ... I even shift/ctrl/R and refreshed and grabbed again and it still says it's available." Reloading Lead Pro
// fixed it (log270). Now: GRAB re-reads any inventory more than a minute old, and a unit is only "confirmed in stock"
// or pinned from the customer's words from inventory that arrived during that grab.
// Executes the shipped _lpPrefetchValueFacts, _lpFeedUnitCheck, _lpInvFreshness and populateFromData. Placeholder data.
//
// Usage: node tests/inv-grab-fresh-746.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: inv-grab-fresh-746.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const UNIT = { stock: 'TEST001A', stockNum: 'TEST001A', vin: 'VINTEST001A', vehicle: '2027 Kia Telluride EX', year: 2027, make: 'Kia', model: 'Telluride EX', condition: 'new', color: 'Black Jade Green' };
const INV = { units: [UNIT, { stock: 'TEST002A', stockNum: 'TEST002A', vehicle: '2026 Kia Sorento S', year: 2026, make: 'Kia', model: 'Sorento S', condition: 'new', color: 'Wolf Gray' }] };
const ent = (tag, title, body) => '[09/30/2026 8:05 AM] [' + tag + '] ' + title + '\n  ' + body + '\n';
const BRIEF = 'AGENT CONTEXT — READ THIS FIRST.\nCONVERSATION TRANSCRIPT (newest first):\n---\n'
  + ent('CUSTOMER', 'Inbound Text Message', 'I was looking at the Kia Telluride Ex in Jade Green') + '---\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const sb = loadPopup(f, { withAuth: true });
  sb.__inv = INV;
  // The cache as the panel holds it: inventory that arrived `settledAgo` ms ago; a grab that began `grabAgo` ms ago.
  const setCache = (settledAgo, grabAgo) => {
    const now = Date.now();
    sb.__c = { vf: null, inv: INV, fetchedAt: now - settledAgo - 50, invSettledAt: now - settledAgo, pending: false, _settled: 2 };
    sb.__g = grabAgo == null ? 0 : now - grabAgo;
    vm.runInContext('_lpValueFactCache["6190"] = globalThis.__c; window._lpGrabStartedAt = globalThis.__g;', sb);
  };
  const lead = { dealerId: '6190', stockNum: 'TEST001A', vehicle: '2027 Kia Telluride EX' };

  console.log(' 1. a unit is "confirmed in stock" only from inventory that arrived during this grab:');
  check('log269 shape: inventory from 23 minutes ago, grab now -> NOT confirmed, and the reason says why', () => {
    setCache(23 * 60000, 100); const r = sb._lpFeedUnitCheck(lead); return [r.inFeed, r.confirmed, /predates this grab/.test(r.why)]; }, [true, false, true]);
  check('...and the freshness check used by the sold-pivot comparables agrees', () => { setCache(23 * 60000, 100); return sb._lpInvFreshness('6190').fresh; }, false);
  check('control: inventory that arrived after the grab began -> confirmed', () => { setCache(200, 1000); return sb._lpFeedUnitCheck(lead).confirmed; }, true);
  check('control: no grab under way (no GRAB click in this session) -> as before, confirmed', () => { setCache(23 * 60000, null); return sb._lpFeedUnitCheck(lead).confirmed; }, true);

  console.log(' 2. no unit is pinned from the customer\'s words out of an old snapshot:');
  const pin = (settledAgo, grabAgo) => {
    setCache(settledAgo, grabAgo);
    const d = { name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Gubagoo Virtual Retailing',
      convState: 'active-follow-up', leadAgeDays: 0, totalNoteCount: 8, hasOutbound: true, hasCustomerReply: true, relationshipSignals: {},
      conversationBrief: BRIEF, history: '', context: '', pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0 };
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__logs.length = 0;
    sb.populateFromData(d);
    return { d, c: vm.runInContext('leadContext', sb), logs: sb.__logs.slice() };
  };
  const stale = pin(23 * 60000, 100);
  check('log269 shape: "Kia Telluride Ex" is NOT pinned to the one EX in a 23-minute-old snapshot', () =>
    [stale.d.vehicle, stale.d.stockNum || '', /confirmed in stock/.test(stale.c)], ['', '', false]);
  check('...and the diag says why', () => stale.logs.some(l => /\[LP CHAT-VOI DIAG\] NOT promoted -- the inventory in hand predates this grab/.test(l)), true);
  const fresh = pin(200, 1000);
  check('control: the same words with this grab\'s inventory -> pinned, as before', () => [fresh.d.vehicle, fresh.d.stockNum], ['2027 Kia Telluride EX', 'TEST001A']);

  console.log(' 3. GRAB re-reads inventory more than a minute old:');
  const fetched = (ageMs, maxAge) => {
    const calls = [];
    sb.__calls = calls; sb.__age = ageMs; sb.__max = maxAge;
    vm.runInContext('_lpValueFactCache["6190"] = { vf: {}, inv: globalThis.__inv, fetchedAt: Date.now() - globalThis.__age, invSettledAt: Date.now() - globalThis.__age, pending: false };'
      + 'window._leadProWorkerBase = "https://example.invalid";'
      + 'fetch = function (u) { globalThis.__calls.push(String(u)); return new Promise(function () {}); };'
      + (maxAge == null ? '_lpPrefetchValueFacts("6190");' : '_lpPrefetchValueFacts("6190", globalThis.__max);'), sb);
    return calls.filter(u => /\/inventory\?/.test(u)).length;
  };
  check('a 2-minute-old snapshot, asked with the grab\'s one-minute limit -> inventory fetched again', () => fetched(120000, 60000), 1);
  check('control: the same snapshot under the load-time 30-minute limit -> not fetched (as before)', () => fetched(120000, null), 0);
  check('the GRAB button stamps the grab and refreshes every store with the one-minute limit', () =>
    /window\._lpGrabStartedAt = Date\.now\(\);\s*Object\.keys\(DEALER_ID_MAP\)\.forEach\(function \(_gd\) \{ _lpPrefetchValueFacts\(_gd, 60000\); \}\);\s*\} catch \(_eGr\) \{\}\s*grabLead\(\);/.test(src), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
