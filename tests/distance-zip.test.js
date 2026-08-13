#!/usr/bin/env node
'use strict';
/**
 * distance-zip.test.js — regression tests for v9.7.546 / v9.7.544.
 *
 * LIVE INCIDENT: Billy Broussard, Audi Lafayette (dealerId 21135), 8/13. PageData
 * Buyer.PostalCode is "70526" (Crowley, LA) and '70526' is listed in LOCAL_ZIPS_LAFAYETTE —
 * the ZIP set is correct and the ZIP was scraped correctly. The delivered prompt still carried
 * "🔴 REMOTE / OUT-OF-STATE BUYER: Customer is NOT local." and the SMS opened "I know you're
 * not local."
 *
 * Two defects, in series:
 *
 *   (1) classifyScenario has vetoed distance on a local ZIP since v9.7.348, but buildUserPrompt —
 *       which is what actually RENDERS the directive — never consulted the ZIP set. A 'distance'
 *       entry in activeFlags was an unconditional override there.
 *   (2) isRemoteBuyer scanned `context.substring(0, 1000)` — the AGENT CONTEXT header and our own
 *       notes — so Lead Pro's own prior voicemail ("Since you're not local", logged to the CRM at
 *       10:27 AM) came back as evidence that the customer is remote.
 *
 * Every block is sliced out of each shipped popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: distance-zip.test.js <popup.js> [popup.js...]'); process.exit(2); }

function cut(src, from, to, what, file) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate ' + what + ' in ' + file);
  return src.slice(a, b);
}

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);

  // Shared prerequisites, verbatim: the ZIP sets, the haversine tables, and the two shared
  // "did the customer say it themselves" helpers.
  vm.runInContext(
    cut(src, 'const LOCAL_ZIPS_BAYTOWN', '\nconst STORE_TO_DEALER_ID', 'the geo constants', file) +
    '\n' + cut(src, 'function _lpCustomerText(d){', '\n// (v9.7.429/427) ONE Director-mode', 'the text helpers', file),
    ctx);

  // ── A: the distance-flag decision in buildUserPrompt ────────────────────────────────────
  const decide = vm.runInContext(
    '(function(data){\n' +
    '  var flags = (data.activeFlags || []).slice();\n' +
    cut(src, '  var _geoOutOfState = false;', "  if (flags.includes('trade')) {", 'the prompt distance decision', file) +
    '\n  return { flags: flags, geoOutOfState: _geoOutOfState, inStateFar: _inStateFar,\n' +
    '           localSetHit: _localSetHit, localVeto: _bpLocalVeto, explicitReq: _bpExplicitReq,\n' +
    '           zipVetoedState: _zipVetoedState,\n' +
    '           rendered: flags.indexOf("distance") !== -1 }; })', ctx);

  // ── B: which branch renders — REMOTE vs the softer in-state DISTANCE BUYER ──────────────
  const remote = vm.runInContext(
    '(function(data, opts){\n' +
    '  var _bpLocalVeto = !!opts.localVeto, _geoOutOfState = !!opts.geoOutOfState;\n' +
    cut(src, '    var _manualDistance = ', '    if (flags.includes(\'credit\')', 'the isRemoteBuyer branch', file) +
    '\n  return { manual: _manualDistance, remote: isRemoteBuyer }; })', ctx);

  // ── C: classifyScenario's own local-ZIP veto (the half that was always correct) ─────────
  const scenario = vm.runInContext(
    '(function(data, opts){\n' +
    '  var s = {}; opts = opts || {};\n' +
    '  s.isShowroomFollowUp = !!opts.showroomFollowUp; s.isLeaseMature = !!opts.leaseMature;\n' +
    '  s.isLoyalty = !!opts.loyalty; var hasShowroomVisit = !!opts.showroomVisit;\n' +
    '  var _explicitDistanceReq = _lpExplicitDistanceReq(data.lastInboundMsg);\n' +
    cut(src, '  var _isLocalByZip = false;', '  // (v9.7.401/399 DISTANCE-DONT-STATE-MILES)', 'the scenario distance gate', file) +
    '\n  var manualFlags = data.activeFlags || [];\n' +
    "  if (manualFlags.indexOf('distance') !== -1 && !_isLocalByZip)  { s.isDistanceBuyer = true; }\n" +
    '  return { isLocalByZip: _isLocalByZip, explicitReq: _explicitDistanceReq, isDistanceBuyer: !!s.isDistanceBuyer }; })', ctx);

  // ── D: the PASS-2 address merge, verbatim from the shipped block ────────────────────────
  // Exercised as the merge exercises it: one frame at a time, in `sorted` order, against a
  // partially-built `m`.
  const mergeAddr = vm.runInContext(
    '(function(frames, activeCustomerId, pass1HadActiveFrame){\n' +
    '  var m = {};\n' +
    '  for (var n = 0; n < frames.length; n++) {\n' +
    '    var d = frames[n];\n' +
    '    var _activeCustomerId = activeCustomerId, _pass1HadActiveFrame = pass1HadActiveFrame;\n' +
    '    var _customerVerified = !!(_activeCustomerId && d.customerId && d.customerId === _activeCustomerId);\n' +
    '    var k = "customerState";\n' +
    '    if (true) {\n' +
    cut(src, "                if (_customerVerified || !_pass1HadActiveFrame) {",
             '              } else if (!m[k] && d[k]) {', 'the PASS-2 address branch', file) +
    '    }\n  }\n  return { state: m.customerState || "", zip: m.customerZip || "" }; })', ctx);

  return { name: path.basename(path.dirname(file)), decide, remote, scenario, mergeAddr };
}

const impls = BUILDS.map(build);
let pass = 0, fail = 0;
function eq(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

// ── Billy Broussard's real lead, as it arrived at buildUserPrompt ─────────────────────────
// Crowley LA 70526, Audi Lafayette 21135. The 10:22 note and the 10:27 voicemail are verbatim
// from the delivered prompt; the voicemail is Lead Pro's own prior output, read back in.
const BILLY_CONTEXT =
  'AGENT CONTEXT — READ THIS FIRST. These notes may reflect events that happened AFTER the customer\'s last message.\n' +
  '[08/13/2026 10:22 AM] [NOTE] General Note\n' +
  '  By: Jordyn Guzman no dupe Billy Broussard Eve: (337) 446-3392 billyjbroussard@gmail.com Crowley, LA 70526\n' +
  '[08/13/2026 10:27 AM] [CALL NOTE] Outbound phone call (Machine)\n' +
  '  By: Jordyn Guzman\n' +
  '  Left message-Hi Billy, this is Jordyn, your Audi Concierge at Audi Lafayette. I saw your Audi Partner Lead ' +
  'inquiry on the 2025 Chevrolet Silverado 1500 Custom, and it is here and available to see. Since you’re not ' +
  'local, would you prefer a video walkaround first or to discuss the purchase details\n';

const BILLY = (flags) => ({
  store: 'Audi Lafayette', dealerId: '21135',
  customerState: 'LA', customerZip: '70526',
  vehicle: '2025 Chevrolet Silverado 1500 Custom',
  lastInboundMsg: '', context: BILLY_CONTEXT,
  activeFlags: flags || [], relationshipSignals: { personalContext: [] }
});

console.log('\nv9.7.546 — the local-ZIP veto reaches the prompt; remote is decided on customer text');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('THE REGRESSION — Billy Broussard, PageData PostalCode 70526, dealerId 21135:');
eq('_isLocalByZip is true (the ZIP set was always correct)',
  i => i.scenario(BILLY(), {}).isLocalByZip, true);
eq('s.isDistanceBuyer is false absent an explicit request — even with the chip on',
  i => i.scenario(BILLY(['distance']), {}).isDistanceBuyer, false);
eq('the prompt-side decision agrees: local ZIP is seen',
  i => i.decide(BILLY(['distance'])).localSetHit, true);
eq('the local veto fires',
  i => i.decide(BILLY(['distance'])).localVeto, true);
eq('NO distance block renders — this is the line that shipped "Customer is NOT local"',
  i => i.decide(BILLY(['distance'])).rendered, false);
eq('...and with no chip at all, still nothing',
  i => i.decide(BILLY()).rendered, false);
eq('our own voicemail ("Since you’re not local") no longer proves the customer is remote',
  i => i.remote(BILLY(['distance']), { localVeto: true, geoOutOfState: false }).remote, false);

// ── Kevin Cordes, the second live incident of the same day ────────────────────────────────
// Community Honda Baytown (6191), Cars.com Finance Intent, marked Duplicate by the system.
// Buyer panel: "Baytown, TX 77521" — the store's own town, and '77521' is in LOCAL_ZIPS_BAYTOWN.
// His CELL is (337) 400-5105, a Lafayette LOUISIANA area code, which is the whole trap: the
// phone looks out-of-area and the address is across the street. The delivered drafts read
// "Since you're out of state" and "Since you're not local". Nothing in the geo path can produce
// that — TX customer at a TX rooftop, ZIP in the local set — so the flag came from activeFlags
// and was honoured verbatim, exactly as on Billy.
const KEVIN = (flags) => ({
  store: 'Community Honda Baytown', dealerId: '6191',
  customerState: 'TX', customerZip: '77521',
  phone: '(337) 400-5105',
  vehicle: '2018 Chevrolet Silverado 1500 LT',
  lastInboundMsg: '',
  context: 'AGENT CONTEXT — READ THIS FIRST.\n' +
           '[08/13/2026 9:53 AM] [AGENT] Outbound Text Message\n' +
           '  Good morning Kevin My name is Mario please let me how I can help with your next car purchase\n',
  activeFlags: flags || [], relationshipSignals: { personalContext: [] }
});

console.log('\nTHE SECOND INCIDENT — Kevin Cordes, Baytown TX 77521 at dealerId 6191:');
eq('a Louisiana area code does not make a Baytown address remote — _isLocalByZip true',
  i => i.scenario(KEVIN(), {}).isLocalByZip, true);
eq('in-state at his own rooftop — _geoOutOfState false',
  i => i.decide(KEVIN(['distance'])).geoOutOfState, false);
eq('the local veto fires', i => i.decide(KEVIN(['distance'])).localVeto, true);
eq('NO distance block renders — this is "Since you\'re out of state"',
  i => i.decide(KEVIN(['distance'])).rendered, false);
eq('scenario agrees — s.isDistanceBuyer false with the chip on',
  i => i.scenario(KEVIN(['distance']), {}).isDistanceBuyer, false);

console.log('\nthe veto is a ZIP fact, not a blanket mute — a customer who ASKS still wins:');
const BILLY_ASKS = Object.assign(BILLY(['distance']), {
  lastInboundMsg: 'Can you ship the vehicle to me? I would rather not make the drive.'
});
eq('explicit remote request detected', i => i.decide(BILLY_ASKS).explicitReq, true);
eq('veto stands down', i => i.decide(BILLY_ASKS).localVeto, false);
eq('distance block renders', i => i.decide(BILLY_ASKS).rendered, true);
eq('scenario agrees — local ZIP overridden by the customer\'s own words',
  i => i.scenario(BILLY_ASKS, {}).isDistanceBuyer, true);
eq('and it routes to the REMOTE branch, not the drive-in one',
  i => i.remote(BILLY_ASKS, { localVeto: false, geoOutOfState: false }).remote, true);

console.log('\ngenuine distance buyers are untouched:');
const OUT_OF_STATE = {
  store: 'Community Honda Baytown', dealerId: '6191',
  customerState: 'LA', customerZip: '70506', lastInboundMsg: '', context: '',
  activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('LA customer at a TX rooftop — out of state, distance renders',
  i => i.decide(OUT_OF_STATE).rendered, true);
eq('...and routes REMOTE', i => i.remote(OUT_OF_STATE, { localVeto: false, geoOutOfState: true }).remote, true);
// (v9.7.547) The local-set lookup is now attempted even when the state already reads
// out-of-state — that is what lets the ZIP disagree with a bled state. Here the two agree:
// 70506 is a Lafayette ZIP and this is the Baytown rooftop, so the lookup confirms non-local
// rather than vetoing anything.
eq('the local-set lookup still runs, and confirms the state rather than contradicting it',
  i => i.decide(OUT_OF_STATE).localSetHit, false);
eq('...so no veto is claimed', i => i.decide(OUT_OF_STATE).zipVetoedState, false);

const IN_STATE_FAR = {
  store: 'Community Honda Lafayette', dealerId: '24399',
  customerState: 'LA', customerZip: '71301', lastInboundMsg: '', context: '',
  activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('Alexandria LA 71301 → in-state but outside the local set, distance renders',
  i => i.decide(IN_STATE_FAR).rendered, true);
eq('...flagged in-state-far, not out-of-state', i => i.decide(IN_STATE_FAR).inStateFar, true);
eq('...and routes to the DRIVE-IN branch, not REMOTE (the v9.7.405 Michelle Lacour case)',
  i => i.remote(IN_STATE_FAR, { localVeto: false, geoOutOfState: false }).remote, false);

console.log('\nthe manual chip still works where it should:');
const FAR_CHIPPED = Object.assign({}, IN_STATE_FAR, { activeFlags: ['distance'] });
eq('chip on a non-local ZIP forces REMOTE handling (that is what the override means)',
  i => i.remote(FAR_CHIPPED, { localVeto: false, geoOutOfState: false }).remote, true);
eq('chip on a local ZIP does NOT force it',
  i => i.remote(BILLY(['distance']), { localVeto: true, geoOutOfState: false }).manual, false);
eq('scenario latch on a non-local ZIP still sets the flag',
  i => i.scenario(FAR_CHIPPED, {}).isDistanceBuyer, true);

console.log('\nno ZIP on file — the pre-existing behaviour is unchanged:');
const NO_ZIP = {
  store: 'Audi Lafayette', dealerId: '21135', customerState: 'LA', customerZip: '',
  lastInboundMsg: '', context: '', activeFlags: ['distance'], relationshipSignals: { personalContext: [] }
};
eq('local-set lookup undetermined', i => i.decide(NO_ZIP).localSetHit, null);
eq('no veto — an unknown ZIP cannot prove local', i => i.decide(NO_ZIP).localVeto, false);
eq('the chip still renders the block', i => i.decide(NO_ZIP).rendered, true);

console.log('\nsuppressors on the scenario side are unchanged:');
eq('showroom follow-up suppresses', i => i.scenario(OUT_OF_STATE, { showroomFollowUp: true }).isDistanceBuyer, false);
eq('the customer\'s own remote ask survives a loyalty lead only via the chip path',
  i => i.scenario(Object.assign({}, OUT_OF_STATE, { lastInboundMsg: 'can you ship to me' }), { loyalty: true }).isDistanceBuyer, false);

console.log('\ncustomer text vs agent text — the pollution the second defect allowed:');
const CUSTOMER_SAID = {
  store: 'Community Honda Lafayette', dealerId: '24399', customerState: 'LA', customerZip: '71301',
  lastInboundMsg: 'I am out of state right now, can you ship to me?',
  context: '', activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('the CUSTOMER saying it still trips REMOTE',
  i => i.remote(CUSTOMER_SAID, { localVeto: false, geoOutOfState: false }).remote, true);
const CUSTOMER_IN_TRANSCRIPT = {
  store: 'Community Honda Lafayette', dealerId: '24399', customerState: 'LA', customerZip: '71301',
  lastInboundMsg: '',
  context: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' +
           '[08/12/2026 9:00 AM] [CUSTOMER] Inbound Text Message\n  I am not local, I am in Houston for work\n---\n',
  activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('a customer line deeper in the transcript still trips it (scope moved, not narrowed to lastInbound)',
  i => i.remote(CUSTOMER_IN_TRANSCRIPT, { localVeto: false, geoOutOfState: false }).remote, true);
const AGENT_SAID = {
  store: 'Community Honda Lafayette', dealerId: '24399', customerState: 'LA', customerZip: '71301',
  lastInboundMsg: '',
  context: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' +
           '[08/12/2026 9:00 AM] [AGENT] Outbound Text Message\n  Since you are not local, want a video walkaround?\n---\n',
  activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('OUR OWN prior message saying it does not — this is the Broussard loop',
  i => i.remote(AGENT_SAID, { localVeto: false, geoOutOfState: false }).remote, false);

// ── The mechanism itself: a bled address, and the two places it is now stopped ────────────
// Gil confirmed the Distance chip was never clicked on either 8/13 lead. The scraper never
// assigns d.isDistanceBuyer (only content.js does, and content.js results are not consumed),
// so the auto-detect toggleFlag is dead code — which leaves the geo path as the only way the
// flag could reach the prompt, and a wrong customerState as the only way the geo path fires on
// two customers who are both demonstrably local.
console.log('\nTHE MECHANISM — the customer address was ungated in the PASS-2 merge:');

const frame = (leadId, custId, st, zip) =>
  ({ autoLeadId: leadId, customerId: custId, customerState: st, customerZip: zip });

eq('a chrome/stale frame with NO customerId cannot supply the address once PASS 1 scraped the lead',
  i => i.mergeAddr([frame(null, null, 'TX', '77521')], '1440099537', true),
  { state: '', zip: '' });
eq('...but the verified customer-dashboard frame still can (the v9.7.228 case)',
  i => i.mergeAddr([frame(null, '1440099537', 'LA', '70526')], '1440099537', true),
  { state: 'LA', zip: '70526' });
eq('a DIFFERENT customer\'s frame is refused even though it looks well-formed',
  i => i.mergeAddr([frame(null, '9999999999', 'TX', '77521')], '1440099537', true),
  { state: '', zip: '' });
eq('the bleed shape: stale frame first, real frame second — the real one wins',
  i => i.mergeAddr([frame(null, null, 'TX', '77521'), frame(null, '1440099537', 'LA', '70526')], '1440099537', true),
  { state: 'LA', zip: '70526' });
eq('when PASS 1 found no active frame at all, an unverified frame may still supply it',
  i => i.mergeAddr([frame(null, null, 'LA', '70526')], '', false),
  { state: 'LA', zip: '70526' });

console.log('\n   ...and the address travels as one fact, never half from each frame:');
eq('state and zip come from the same frame',
  i => i.mergeAddr([frame(null, '1440099537', 'LA', '70526'), frame(null, '1440099537', 'TX', '77521')], '1440099537', true),
  { state: 'LA', zip: '70526' });
eq('a state-only frame does not strand a later frame\'s zip against it',
  i => i.mergeAddr([frame(null, '1440099537', 'LA', ''), frame(null, '1440099537', 'TX', '77521')], '1440099537', true),
  { state: 'LA', zip: '' });
eq('a zip-only frame can still fill an empty zip when no state has been taken',
  i => i.mergeAddr([frame(null, '1440099537', '', '70526')], '1440099537', true),
  { state: '', zip: '70526' });

console.log('\nTHE BACKSTOP — if a bled state gets through anyway, the ZIP outranks it:');
const BILLY_BLED_STATE = Object.assign(BILLY(), { customerState: 'TX' }); // Baytown bleed at a Lafayette rooftop
eq('a TX state on a 70526 ZIP at dealer 21135 no longer reads out-of-state',
  i => i.decide(BILLY_BLED_STATE).geoOutOfState, false);
eq('...the contradiction is recorded', i => i.decide(BILLY_BLED_STATE).zipVetoedState, true);
eq('...and no distance block renders', i => i.decide(BILLY_BLED_STATE).rendered, false);
const KEVIN_BLED_STATE = Object.assign(KEVIN(), { customerState: 'LA' }); // Lafayette bleed at Baytown
eq('an LA state on a 77521 ZIP at dealer 6191 no longer reads out-of-state',
  i => i.decide(KEVIN_BLED_STATE).geoOutOfState, false);
eq('...and no distance block renders', i => i.decide(KEVIN_BLED_STATE).rendered, false);

console.log('\n   the arbitration is narrow — it only fires on a ZIP inside the store\'s OWN set:');
const REAL_OUT_OF_STATE = {
  store: 'Community Honda Baytown', dealerId: '6191', customerState: 'LA', customerZip: '70506',
  lastInboundMsg: '', context: '', activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('a genuine LA customer at Baytown (ZIP not in the Baytown set) is still out-of-state',
  i => i.decide(REAL_OUT_OF_STATE).geoOutOfState, true);
eq('...no veto claimed', i => i.decide(REAL_OUT_OF_STATE).zipVetoedState, false);
eq('...distance still renders', i => i.decide(REAL_OUT_OF_STATE).rendered, true);
eq('an out-of-state customer with no ZIP on file is unaffected',
  i => i.decide(Object.assign({}, REAL_OUT_OF_STATE, { customerZip: '' })).geoOutOfState, true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
