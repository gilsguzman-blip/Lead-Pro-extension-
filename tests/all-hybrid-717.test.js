#!/usr/bin/env node
'use strict';
// (v9.7.717) log247, Community Toyota Baytown: the unit on the lead was a "2026 Toyota Camry SE" (stock
// TU350975), the customer's TrueCar build a "2026 Toyota Camry Hybrid SE". The variant check read the
// missing word as a different powertrain and the draft said "the 2026 Camry SE we have is not a Hybrid".
// Gil: "All 2026 and above Toyota Camrys are Hybrids now as well as RAV4 and Siennas."
// Rule (v9.7.719): Camry, Sienna and RAV4 from 2026 are hybrid-only; a name with no marker is a
// hybrid for them. Executes the shipped _lpPowertrainOf, _lpMatchByModel (the incentive gate) and
// populateFromData.
//
// Usage: node tests/all-hybrid-717.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: all-hybrid-717.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const pt = (s) => vm.runInContext('_lpPowertrainOf', sb)(s);

  console.log(' 1. the powertrain of a name with no marker:');
  // (v9.7.719) Gil: all three are hybrid-only from 2026 (was Camry 2025 / Sienna 2021 in v9.7.717).
  check('2026 Camry SE and a yearless "Camry" program line -> Hybrid',
    () => ['2026 Toyota Camry SE', 'Camry'].map(pt), ['Hybrid', 'Hybrid']);
  check('2026 Sienna XLE and 2026 RAV4 XLE -> Hybrid', () => ['2026 Toyota Sienna XLE', '2026 Toyota RAV4 XLE'].map(pt), ['Hybrid', 'Hybrid']);
  check('control: before 2026 a name with no marker is judged by its marker (2025 Camry, 2022 Sienna, 2025 RAV4)',
    () => ['2025 Toyota Camry LE', '2022 Toyota Sienna XLE', '2025 Toyota RAV4 XLE'].map(pt), ['Gas', 'Gas', 'Gas']);
  check('control: a plug-in stays a plug-in, and other nameplates are untouched',
    () => ['2026 Toyota RAV4 Plug-in Hybrid XSE', '2026 Honda Accord SE', '2026 Toyota Corolla LE'].map(pt), ['Plug-in Hybrid', 'Gas', 'Gas']);

  console.log(' 2. the incentive gate:');
  const pick = (lead, lines) => vm.runInContext('_lpMatchByModel', sb)(lead, lines, (x) => x, 2, true);
  check('a 2026 Camry SE lead keeps the "Camry Hybrid" program (it was gated out as gas-vs-hybrid)',
    () => pick('2026 Toyota Camry SE', ['Camry Hybrid', 'Corolla Hybrid']), ['Camry Hybrid']);
  check('control: a 2024 Camry SE (gas) still does not take the hybrid program', () => pick('2024 Toyota Camry SE', ['Camry Hybrid']), []);
  check('control: a 2026 RAV4 XLE keeps the RAV4 line and not the plug-in', () => pick('2026 Toyota RAV4 XLE', ['RAV4', 'RAV4 Plug-in Hybrid']), ['RAV4']);

  console.log(' 3. the prompt (log247 shape):');
  const run = (vehicle, build) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__logs.length = 0;
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle, dealerId: '6190', store: 'Community Toyota Baytown',
      leadSource: 'Truecar', convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 3, hasOutbound: true, hasCustomerReply: false,
      relationshipSignals: {}, history: '', context: '',
      conversationBrief: 'CUSTOMER\'S INQUIRY — the customer\'s own words:\n"LEAD: BUILD (NEW) BUILD: ' + build + ' Search ZIP is 77578"\n' });
    return vm.runInContext('leadContext', sb);
  };
  // (v9.7.719) Gil: no "THIS VEHICLE IS A HYBRID" talking point -- background reference only.
  check('2026 Camry SE vs a "2026 Toyota Camry Hybrid SE" build: no VARIANT MISMATCH, and no hybrid talking point', () => {
    const c = run('2026 Toyota Camry SE', '2026 Toyota Camry Hybrid SE');
    return [/VEHICLE VARIANT MISMATCH/.test(c), /THIS VEHICLE IS A HYBRID/.test(c), /BACKGROUND — powertrain reference[^\n]*Toyota Camry 2026 and newer are hybrid-only/.test(c)]; }, [false, false, true]);
  check('control: a 2023 Camry SE vs a Camry Hybrid build still flags the different powertrain', () => {
    const c = run('2023 Toyota Camry SE', '2023 Toyota Camry Hybrid SE');
    return /VEHICLE VARIANT MISMATCH[^\n]*"hybrid"/.test(c); }, true);
  check('control: a Honda Accord SE vs an Accord Hybrid build still flags it (Accord has a gas model)', () =>
    /VEHICLE VARIANT MISMATCH[^\n]*"hybrid"/.test(run('2026 Honda Accord SE', '2026 Honda Accord Hybrid Sport')), true);
  check('control: a listing that already says Hybrid gets no mismatch either', () => /VEHICLE VARIANT MISMATCH/.test(run('2026 Toyota Camry Hybrid SE', '2026 Toyota Camry Hybrid SE')), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
