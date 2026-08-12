#!/usr/bin/env node
'use strict';
/**
 * sold-scan.test.js — regression tests for s.vehicleSold (v9.7.545).
 *
 * The greedy prose regex scanned the whole assembled context, which contains Lead Pro's
 * own directives. On Sydnee Fuselier's lead the ONLY match in the entire delivered prompt
 * was inside a Lead Pro hypothetical — "If the newest thing we told them was that the
 * vehicle sold, you may not now write as though it is available" — so the SOLD scenario
 * fired on a lead the CRM confirms has no vehicle at all.
 *
 * The regression pair is real: Sydnee (false SOLD, down-voted) and Senthil Subramaniam
 * (genuine SOLD, same day, same dual-directive shape, not flagged).
 *
 * The block is sliced out of each shipped popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: sold-scan.test.js <popup.js> [popup.js...]'); process.exit(2); }

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('  var _ctxSold = ctx;');
  const b = src.indexOf('  s.vehicleInTransit   =');
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate the sold scan in ' + file);
  const ctxObj = { console: { log() {} } };
  vm.createContext(ctxObj);
  const sold = vm.runInContext(
    '(function(data, opts){\n' +
    '  var ctx = (data.context || "").toLowerCase();\n' +
    '  var s = {}; opts = opts || {};\n' +
    '  var _inTransitNow = !!opts.inTransit, _isLeaseMatureEarly = !!opts.leaseMature, _audiAllAvail = !!opts.audiAllAvail;\n' +
    '  s.isLoyalty = !!opts.isLoyalty;\n' +
    src.slice(a, b) +
    '\n  return s.vehicleSold; })', ctxObj);
  return { name: path.basename(path.dirname(file)), sold };
}

const impls = BUILDS.map(build);
let pass = 0, fail = 0;
function eq(name, data, opts, want) {
  const results = impls.map(i => { try { return JSON.stringify(i.sold(data, opts)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + ', got ' + results[0]);
  }
}

// The Lead Pro directive that actually caused the false positive, verbatim in shape.
const LP_HYPOTHETICAL =
  '🧾 WHAT WE HAVE ALREADY TOLD THIS CUSTOMER (our own prior outbound messages, oldest first):\n' +
  '  • [08/08/2026] WE SAID IT WAS AVAILABLE: "Ok let me make sure it is still available for you"\n' +
  '- Do NOT contradict the MOST RECENT of these without saying so plainly. If the newest thing we told them ' +
  'was that the vehicle sold, you may not now write as though it is available, ask whether they are still ' +
  'interested in it, or invite them to come see it.\n';

const TRANSCRIPT = (body) =>
  'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):\n---\n' + body + '\n---\n';

console.log('\nv9.7.545 — sold scan must not read Lead Pro\'s own hypothetical');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('the live false positive:');
eq('Sydnee Fuselier — no vehicle on lead, only LP hypothetical mentions "sold"',
  { vehicle: '', context: LP_HYPOTHETICAL + TRANSCRIPT(
    '[08/10/2026 10:15 AM] [CUSTOMER] Inbound Text Message\n  Hi there, I decided not to go with it. Thank you!\n' +
    '[08/08/2026 9:34 AM] [AGENT] Outbound Text Message\n  32,500') },
  {}, false);
eq('same arc but a vehicle IS on the lead — LP hypothetical still must not trip it',
  { vehicle: '2024 Honda Accord', context: LP_HYPOTHETICAL + TRANSCRIPT(
    '[08/10/2026 10:15 AM] [CUSTOMER] Inbound Text Message\n  Hi there, I decided not to go with it. Thank you!') },
  {}, false);

console.log('\ngenuine sold vehicles must still be detected:');
eq('Senthil Subramaniam — authoritative marker, the path that works',
  { vehicle: '2026 Toyota RAV4 XSE',
    context: '🔴 VEHICLE STATUS: SOLD — and the transcript shows the customer was ALREADY TOLD.\n' + TRANSCRIPT(
      '[08/12/2026 12:15 PM] [AGENT] Email reply to prospect\n  the 2026 RAV4 XSE you selected has sold') },
  {}, true);
eq('agent told the customer in the transcript, no marker present',
  { vehicle: '2024 Honda Accord', context: LP_HYPOTHETICAL + TRANSCRIPT(
    '[08/12/2026 9:00 AM] [AGENT] Outbound Text Message\n  Unfortunately that unit has been sold, I am sorry') },
  {}, true);
eq('"no longer available" said in the transcript',
  { vehicle: '2024 Honda Accord', context: TRANSCRIPT(
    '[08/12/2026 9:00 AM] [AGENT] Outbound Text Message\n  That one is no longer available') },
  {}, true);

console.log('\nthe invariant — no vehicle on the lead means nothing can be sold:');
eq('authoritative marker but no vehicle on the lead',
  { vehicle: '', context: '🔴 VEHICLE STATUS: SOLD\n' + TRANSCRIPT('[08/12/2026] [AGENT] anything') }, {}, false);
eq('transcript says sold but no vehicle on the lead',
  { vehicle: '', context: TRANSCRIPT('[08/12/2026] [AGENT] that vehicle has been sold') }, {}, false);
eq('whitespace-only vehicle counts as no vehicle',
  { vehicle: '   ', context: '🔴 VEHICLE STATUS: SOLD\n' + TRANSCRIPT('[08/12/2026] [AGENT] x') }, {}, false);

console.log('\npre-existing suppressors are unchanged:');
const SOLD_CTX = { vehicle: '2024 Honda Accord', context: '🔴 VEHICLE STATUS: SOLD\n' + TRANSCRIPT('[08/12/2026] [AGENT] x') };
eq('in-transit suppresses (v9.7.519)', SOLD_CTX, { inTransit: true }, false);
eq('loyalty vehicle suppresses', SOLD_CTX, { isLoyalty: true }, false);
eq('lease-mature-early suppresses', SOLD_CTX, { leaseMature: true }, false);
eq('audi-all-available suppresses', SOLD_CTX, { audiAllAvail: true }, false);
eq('live inventory confirmation suppresses (v9.7.509)',
  { vehicle: '2024 Honda Accord', _lpInvConfirmedAvailable: true,
    context: '🔴 VEHICLE STATUS: SOLD\n' + TRANSCRIPT('[08/12/2026] [AGENT] x') }, {}, false);

console.log('\nfallback when the transcript fences are absent:');
eq('no fences — prose scan falls back to the full context',
  { vehicle: '2024 Honda Accord', context: '[08/12/2026] [AGENT] unfortunately that one sold last week' }, {}, true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
