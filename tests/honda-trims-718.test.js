#!/usr/bin/env node
'use strict';
// (v9.7.718) Gil, 9/24, for NEW inquiries: Accord LX and SE are gas; Sport, EX-L, Sport-L and Touring are
// hybrid. Civic Sedan LX and Sport are gas; Sport Hybrid and Sport Touring Hybrid are hybrid. Listings often
// drop the word, so a new "Accord Sport-L" is a hybrid while a "Civic Sport" with no marker is the gas car.
// Scoped to 2026+ model years: older Accords used some of the same trim names on gas cars.
// Executes the shipped _lpPowertrainOf, _lpMatchByModel (the incentive gate) and populateFromData.
//
// Usage: node tests/honda-trims-718.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: honda-trims-718.test.js <popup.js> [popup.js...]'); process.exit(2); }
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

  console.log(' 1. Gil\'s table, new model year, no "Hybrid" in the listing:');
  check('Accord Sport / EX-L / Sport-L / Touring -> Hybrid',
    () => ['Sport', 'EX-L', 'Sport-L', 'Touring'].map(t => pt('2026 Honda Accord ' + t)), ['Hybrid', 'Hybrid', 'Hybrid', 'Hybrid']);
  check('Civic Sport Touring -> Hybrid', () => pt('2026 Honda Civic Sport Touring'), 'Hybrid');
  check('control: Accord LX / SE -> Gas', () => ['LX', 'SE'].map(t => pt('2026 Honda Accord ' + t)), ['Gas', 'Gas']);
  check('control: Civic LX / Sport -> Gas (a Sport Hybrid exists, so "Sport" alone is the gas car)',
    () => ['LX', 'Sport'].map(t => pt('2026 Honda Civic ' + t)), ['Gas', 'Gas']);
  check('control: listings that say Hybrid stay Hybrid', () => [pt('2026 Honda Civic Sport Hybrid'), pt('2026 Honda Accord Hybrid EX-L')], ['Hybrid', 'Hybrid']);
  check('control: older Accords that used the same trim names on gas cars stay Gas',
    () => [pt('2022 Honda Accord Sport'), pt('2022 Honda Accord Touring 2.0T'), pt('2021 Honda Accord EX-L')], ['Gas', 'Gas', 'Gas']);
  check('control: a bare "Accord" / "Civic" program line is the gas program; CR-V untouched',
    () => [pt('Accord'), pt('Civic'), pt('2026 Honda CR-V EX-L')], ['Gas', 'Gas', 'Gas']);

  console.log(' 2. the incentive gate:');
  const pick = (lead, lines) => vm.runInContext('_lpMatchByModel', sb)(lead, lines, (x) => x, 2, true);
  check('a new Accord Sport-L lead takes the Accord Hybrid program, not the gas one', () => pick('2026 Honda Accord Sport-L', ['Accord', 'Accord Hybrid']), ['Accord Hybrid']);
  check('control: a new Accord SE lead takes the gas Accord program', () => pick('2026 Honda Accord SE', ['Accord', 'Accord Hybrid']), ['Accord']);

  console.log(' 3. the prompt:');
  const run = (vehicle, build) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle, dealerId: '6191', store: 'Community Honda Baytown',
      leadSource: 'Honda.com', convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 3, hasOutbound: true, hasCustomerReply: false,
      relationshipSignals: {}, history: '', context: '',
      conversationBrief: 'CUSTOMER\'S INQUIRY — the customer\'s own words:\n"I am interested in the ' + build + '"\n' });
    return vm.runInContext('leadContext', sb);
  };
  // (v9.7.719) Gil: no "THIS VEHICLE IS A HYBRID" talking point -- background reference only.
  check('a 2026 Accord Sport-L listing vs an "Accord Hybrid Sport-L" request: no mismatch, and the trim split is background only', () => {
    const c = run('2026 Honda Accord Sport-L', '2026 Honda Accord Hybrid Sport-L');
    return [/VEHICLE VARIANT MISMATCH/.test(c), /THIS VEHICLE IS A HYBRID/.test(c), /BACKGROUND — powertrain reference[^\n]*New Honda Accord: LX and SE are gas; Sport, EX-L, Sport-L and Touring are hybrid/.test(c)]; }, [false, false, true]);
  check('control: a 2026 Accord SE vs an Accord Hybrid request is still flagged as a different powertrain', () => {
    const c = run('2026 Honda Accord SE', '2026 Honda Accord Hybrid Sport');
    return /VEHICLE VARIANT MISMATCH[^\n]*"hybrid"/.test(c); }, true);
  check('a 2026 Civic Sport vs a Civic Sport Hybrid request is flagged ("hybrid" is the third word, the scan read only the first)', () =>
    /VEHICLE VARIANT MISMATCH[^\n]*"hybrid"/.test(run('2026 Honda Civic Sport', '2026 Honda Civic Sport Hybrid')), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
