#!/usr/bin/env node
'use strict';
/**
 * splitframe-lead.test.js — SPLIT-FRAME vehicle adoption, lead-level (v9.7.551 / v9.7.550).
 *
 * LIVE INCIDENT: Juan Aguirre, lead 2068821407 (Community Toyota Baytown, 8/17). His lead has no
 * vehicle of interest — his own row in the LeadSelector grid has an empty Vehicle cell. Lead Pro
 * adopted "2023 TOYOTA COROLLA" from a co-resident ID-less frame and told him the Corolla he asked
 * about had sold. He never asked about one.
 *
 * THREE THINGS WENT WRONG, and log113 names all of them:
 *
 *   1. THE DONOR IS A SERVICE RECORD. The adopted frame is the Autosoft (Service) record —
 *      Status Complete, created 4/16/24 — carrying the Corolla Juan brought in for service. PASS 1
 *      already refuses these: "[Lead Pro] Frame rejected — service-record source (not a sales
 *      lead): Autosoft" is right there at log113 line 32. But it refuses with a `continue` inside
 *      its own loop, so the frame stays in `sorted` and its vehicle still reached this block. The
 *      v9.7.544 comment describes this exact thing happening on Maci Alvarado ("rejected as a
 *      LEAD, while its vehicle still reached the merge") — that build closed the receiving side
 *      and left the donor side open. Same donor class, twice.
 *
 *   2. "PANEL RENDERED EMPTY" WAS INDISTINGUISHABLE FROM "NO PANEL". v9.7.544 required
 *      panelText truthy AND rawLen > 0. Juan's frame reports sel_gid1:true — the element EXISTS —
 *      with panelText "" and rawLen 0. Empty string is falsy, so both halves failed and the guard
 *      that should have caught this was inert.
 *
 *   3. "ZERO COMPETING LEAD FRAMES" NEVER MEANT "ONE LEAD IN PLAY". It counted frames carrying a
 *      DIFFERENT autoLeadId. A donor with no id at all contributes nothing to it. Juan's customer
 *      record carries FOUR leads in the LeadSelector grid.
 *
 * NOT A CUSTOMER-ID PROBLEM, and worth stating because it is the obvious wrong fix: the Corolla
 * lead belongs to Julian Aguirre, Juan's 2023 co-buyer, on the SAME customer record by design.
 * A customerId check cannot separate them. The discriminator has to be lead-level.
 *
 * Every block is sliced out of each shipped popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: splitframe-lead.test.js <popup.js> [popup.js...]'); process.exit(2); }

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('          if (_aid && _pass1HadActiveFrame && !m.vehicle) {');
  const b = src.indexOf("              } else if (_sfCandidates.length) {", a);
  if (a < 0 || b < 0) throw new Error('could not locate the split-frame block in ' + file);
  const block = src.slice(a, b) + '              }\n            } catch(e) {}\n          }';

  const ctx = { console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  const run = vm.runInContext(
    '(function(sorted, _aid, m){\n' +
    '  var _pass1HadActiveFrame = true; var _log = [];\n' +
    '  var console = { log: function(){ _log.push(Array.prototype.join.call(arguments, "")); },\n' +
    '                  warn: function(){} };\n' +
    block +
    '\n  return { vehicle: m.vehicle || "", stockNum: m.stockNum || "", log: _log }; })', ctx);
  return { name: path.basename(path.dirname(file)), run, src };
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
const F = (r) => ({ result: r });

// ── Juan Aguirre's real seven frames, from log113 ─────────────────────────────────────────
// frame 1200: leadId 2068821407, no panel element at all
// frame 1201: leadId 2068821407, panel element EXISTS (sel_gid1 true) and reads empty; this is
//             also the frame rendering the LeadSelector grid — four leads on the record
// the donor:  lead null, Autosoft (Service), panel-sourced "2023 TOYOTA COROLLA"
const JUAN = () => [
  F({ autoLeadId: '2068821407', dealerId: '6189', vehicle: '', _voiFromPanel: false,
      _voiDiag: { panelText: '(no panel element)', rawLen: 0,
                  sel_gid1: false, sel_gid2: false, sel_spanClass: false, sel_spanAny: false } }),
  F({ autoLeadId: '2068821407', dealerId: '6189', vehicle: '', _voiFromPanel: false,
      _leadSelectorCount: 4,
      _leadSelectorIds: ['2068821407', '1474156609', '1434107959', '158542771'],
      _voiDiag: { panelText: '', rawLen: 0,
                  sel_gid1: true, sel_gid2: false, sel_spanClass: true, sel_spanAny: true } }),
  F({ autoLeadId: null, vehicle: '', _voiFromPanel: false }),
  F({ autoLeadId: null, dealerId: null, vehicle: '2023 TOYOTA COROLLA', vehicleRaw: '2023 TOYOTA COROLLA',
      _voiFromPanel: true, _isServiceFrame: true, leadSource: 'Autosoft' }),
  F({ autoLeadId: null, vehicle: '', _voiFromPanel: false }),
  F({ autoLeadId: null, dealerId: '6189', vehicle: '', _voiFromPanel: false }),
  F({ autoLeadId: null, vehicle: '', _voiFromPanel: false }),
];

console.log('\nv9.7.551 — SPLIT-FRAME adoption is a lead-level decision');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('THE INCIDENT — Juan Aguirre, 8/17:');
eq('no vehicle is adopted', i => i.run(JUAN(), '2068821407', {}).vehicle, '');
eq('the log says REFUSED, not ACCEPTED',
  i => { const l = i.run(JUAN(), '2068821407', {}).log.join(' | ');
         return [/REFUSED/.test(l), /ACCEPTED/.test(l)]; }, [true, false]);
// The service filter runs first, so on Juan's REAL frames the donor never reaches the candidate
// list and the log names the most specific disqualifier rather than the panel one. That is the
// right message — the empty-panel wording is asserted on its own below, where it is the operative
// reason. All three facts appear on this one line either way.
eq('the reason names the service record — the most specific disqualifier',
  i => /were SERVICE records/.test(i.run(JUAN(), '2068821407', {}).log.join(' ')), true);
eq('...and the same line still reports the empty active panel',
  i => /activePanelEmpty:true/.test(i.run(JUAN(), '2068821407', {}).log.join(' ')), true);
eq('the line reports how many leads are on the record',
  i => /leadsOnRecord:4/.test(i.run(JUAN(), '2068821407', {}).log.join(' ')), true);
eq('...and that a service donor was rejected',
  i => /serviceDonorsRejected:1/.test(i.run(JUAN(), '2068821407', {}).log.join(' ')), true);

console.log('\n   each of the three fixes stops it on its own:');
// (1) service donor only — panel absent, single lead on record
const SERVICE_ONLY = () => [
  F({ autoLeadId: '2068821407', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
      _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
  F({ autoLeadId: null, vehicle: '2023 TOYOTA COROLLA', _voiFromPanel: true,
      _isServiceFrame: true, leadSource: 'Autosoft' }),
];
eq('service donor alone → refused', i => i.run(SERVICE_ONLY(), '2068821407', {}).vehicle, '');
eq('...and says so', i => /were SERVICE records/.test(i.run(SERVICE_ONLY(), '2068821407', {}).log.join(' ')), true);
eq('xTimeLegacy is caught too',
  i => i.run([SERVICE_ONLY()[0], F({ autoLeadId: null, vehicle: '2017 KIA SOUL', _voiFromPanel: true,
      leadSource: 'xTimeLegacy' })], '2068821407', {}).vehicle, '');
eq('CDK is caught too',
  i => i.run([SERVICE_ONLY()[0], F({ autoLeadId: null, vehicle: '2017 KIA SOUL', _voiFromPanel: true,
      leadSource: 'CDK Service' })], '2068821407', {}).vehicle, '');

// (2) rendered-empty panel only — donor is a clean sales frame, single lead on record
const EMPTY_PANEL_ONLY = () => [
  F({ autoLeadId: '2068821407', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
      _voiDiag: { panelText: '', rawLen: 0, sel_gid1: true, sel_spanAny: true } }),
  F({ autoLeadId: null, vehicle: '2023 TOYOTA COROLLA', _voiFromPanel: true, leadSource: 'Cargurus' }),
];
eq('rendered-but-empty panel alone → refused', i => i.run(EMPTY_PANEL_ONLY(), '2068821407', {}).vehicle, '');
eq('the v9.7.544 shape (Maci: panelText "(New)", rawLen 5) still refuses',
  i => i.run([
    F({ autoLeadId: '2019154122', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
        _voiDiag: { panelText: '(New)', rawLen: 5, sel_gid1: true, sel_spanAny: true } }),
    F({ autoLeadId: null, vehicle: '2017 KIA SOUL', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2019154122', {}).vehicle, '');

// (3) multi-lead only — clean donor, panel genuinely absent
const MULTI_ONLY = () => [
  F({ autoLeadId: '2068821407', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 4,
      _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
  F({ autoLeadId: null, vehicle: '2023 TOYOTA COROLLA', _voiFromPanel: true, leadSource: 'Cargurus' }),
];
eq('four leads on the record alone → refused', i => i.run(MULTI_ONLY(), '2068821407', {}).vehicle, '');
eq('...and the reason names the lead count',
  i => /carries 4 leads/.test(i.run(MULTI_ONLY(), '2068821407', {}).log.join(' ')), true);

console.log('\nTHE CASE THE BLOCK EXISTS FOR — do not over-correct:');
// v9.7.383: single-lead customer, the panel frame's own autoLeadId genuinely failed to publish.
const LEGIT = () => [
  F({ autoLeadId: '2064909098', dealerId: '21135', vehicle: '', _voiFromPanel: false,
      _leadSelectorCount: 1, _leadSelectorIds: ['2064909098'],
      _voiDiag: { panelText: '(no panel element)', rawLen: 0,
                  sel_gid1: false, sel_gid2: false, sel_spanClass: false, sel_spanAny: false } }),
  F({ autoLeadId: null, dealerId: '21135', vehicle: '2014 Ford Mustang', vehicleRaw: '2014 Ford Mustang',
      stockNum: 'P7455', _voiFromPanel: true, leadSource: 'Cargurus' }),
];
eq('single-lead customer, no panel element, clean donor → ADOPTS',
  i => i.run(LEGIT(), '2064909098', {}).vehicle, '2014 Ford Mustang');
eq('...and brings the stock number with it', i => i.run(LEGIT(), '2064909098', {}).stockNum, 'P7455');
eq('...and logs ACCEPTED', i => /ACCEPTED/.test(i.run(LEGIT(), '2064909098', {}).log.join(' ')), true);
eq('an UNKNOWN lead count (no frame rendered the grid) does not block adoption',
  i => i.run([
    F({ autoLeadId: '2064909098', vehicle: '', _voiFromPanel: false,
        _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
    F({ autoLeadId: null, vehicle: '2014 Ford Mustang', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2064909098', {}).vehicle, '2014 Ford Mustang');
eq('a frame with no _voiDiag at all cannot prove the panel rendered — adoption still allowed',
  i => i.run([
    F({ autoLeadId: '2064909098', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1 }),
    F({ autoLeadId: null, vehicle: '2014 Ford Mustang', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2064909098', {}).vehicle, '2014 Ford Mustang');

console.log('\nPRE-EXISTING GUARDS ARE UNCHANGED:');
eq('a competing frame with a different leadId still blocks',
  i => i.run([
    F({ autoLeadId: '2064909098', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
        _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
    F({ autoLeadId: '9999999999', vehicle: '', _voiFromPanel: false }),
    F({ autoLeadId: null, vehicle: '2014 Ford Mustang', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2064909098', {}).vehicle, '');
eq('a dealer conflict still blocks',
  i => i.run([
    F({ autoLeadId: '2064909098', dealerId: '21135', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
        _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
    F({ autoLeadId: null, dealerId: '6189', vehicle: '2014 Ford Mustang', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2064909098', { dealerId: '21135' }).vehicle, '');
eq('two candidates still ABSTAIN rather than pick one',
  i => i.run([
    F({ autoLeadId: '2064909098', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
        _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
    F({ autoLeadId: null, vehicle: '2014 Ford Mustang', _voiFromPanel: true, leadSource: 'Cargurus' }),
    F({ autoLeadId: null, vehicle: '2020 Honda Civic', _voiFromPanel: true, leadSource: 'Cargurus' }),
  ], '2064909098', {}).vehicle, '');
eq('a text-scanned (non-panel) vehicle is still not a candidate',
  i => i.run([
    F({ autoLeadId: '2064909098', vehicle: '', _voiFromPanel: false, _leadSelectorCount: 1,
        _voiDiag: { panelText: '(no panel element)', rawLen: 0, sel_gid1: false, sel_spanAny: false } }),
    F({ autoLeadId: null, vehicle: '2014 Ford Mustang', _voiFromPanel: false, leadSource: 'Cargurus' }),
  ], '2064909098', {}).vehicle, '');
eq('a lead that already has a vehicle is never touched',
  i => i.run(JUAN(), '2068821407', { vehicle: '2026 Toyota RAV4' }).vehicle, '2026 Toyota RAV4');

console.log('\nTHE RESCUE PATH CARRIES THE SAME DONOR RULE:');
eq('the rescue relaxation excludes service donors',
  i => /_rescueServiceDonor/.test(i.src) &&
       /_otherLeadFrameCount === 0 && !_rescueServiceDonor/.test(i.src), true);
eq('...and logs a REFUSED line of its own',
  i => /SPLIT-FRAME vehicle REFUSED \(rescue\)/.test(i.src), true);

console.log('\nTHE GRID COUNT IS SCRAPED, NOT INVENTED:');
eq('the scraper counts LeadSelector rows',
  i => /querySelectorAll\('tr\[class\*="LeadSelector_LeadId_"\]'\)/.test(i.src), true);
eq('and returns the count and ids on the result object',
  i => /_isServiceFrame,_leadSelectorCount,_leadSelectorIds,/.test(i.src), true);
eq('and reports them frame-side via _lpD, not console.log',
  i => /_lpD\('\[LP LEAD-GRID DIAG\]/.test(i.src), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
