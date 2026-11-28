#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('comp-rank-782.test.js');
// (v9.7.782) Gil, 10/9: comparables "has to have some rhyme or reason though, like model > like price > type and so on",
// and "pre-owned wins since she shops pre-owned" when two units sit about the same distance in price. On 781 the order was
// type, then name-word overlap (a trim word counted as much as the model; any shared word admitted a unit), then price only
// for exact ties; and the draft named the third unit because nothing said the list was ranked. Executes the shipped
// _lpRankComparables / _lpComparablesWithUnits / _lpComparables and populateFromData. Placeholder data only.
//
// Usage: node tests/comp-rank-782.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: comp-rank-782.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, vehicle, year, make, model, condition, price, cls, odo) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle, year, make, model, condition,
  certified: condition === 'cpo', class: cls || 'Car, Intermediate', body: '4D Sedan', color: 'Gray', odometer: odo == null ? (condition === 'new' ? 5 : 50000) : odo, daysOnLot: 10, price });
const SOLD = U('S001', '2018 Honda Accord EX-L 2.0T', 2018, 'Honda', 'Accord EX-L 2.0T', 'used', 22000);
const LEADV = '2018 Honda Accord Sedan EX-L 2.0T';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const rank = (units, cond) => { const fn = vm.runInContext('typeof _lpRankComparables === "function" ? _lpRankComparables : null', sb); if (!fn) return '(missing)';
    return fn(LEADV, [SOLD].concat(units), 'S001', '', { cond: cond || 'Pre-Owned', price: 22000 }).map(o => o.u.stock); };
  console.log(' 1. like model first:');
  check('(new helper) a pre-owned Accord far in price beats a pre-owned Civic at the exact price', () =>
    rank([U('C1', '2020 Honda Civic EX', 2020, 'Honda', 'Civic EX', 'used', 22000), U('A1', '2023 Honda Accord LX', 2023, 'Honda', 'Accord LX', 'used', 31000)]), ['A1']);
  check('(new helper) a trim word does not outrank the model: an "EX-L" Pilot does not beat an Accord LX', () =>
    rank([U('P1', '2022 Honda Pilot EX-L', 2022, 'Honda', 'Pilot EX-L', 'used', 22500, 'SUV'), U('A1', '2023 Honda Accord LX', 2023, 'Honda', 'Accord LX', 'used', 26000)])[0], 'A1');
  check('(new helper) a stray shared word ("2.0T") never admits another make when the model is in stock', () =>
    rank([U('V1', '2021 Volkswagen Atlas Cross Sport 2.0T SE', 2021, 'Volkswagen', 'Atlas Cross Sport 2.0T SE', 'used', 22100, 'SUV'), U('A1', '2023 Honda Accord LX', 2023, 'Honda', 'Accord LX', 'used', 26000)]), ['A1']);
  check('(new helper) "Accord Hybrid" is the Accord family', () => rank([U('H1', '2025 Honda Accord Hybrid Sport-L', 2025, 'Honda', 'Accord Hybrid Sport-L', 'used', 24000)]), ['H1']);
  check('(new helper) no Accord in stock -> the same class (Car, Intermediate) before an SUV', () =>
    rank([U('T1', '2022 Toyota Camry SE', 2022, 'Toyota', 'Camry SE', 'used', 23000), U('R1', '2022 Honda CR-V EX', 2022, 'Honda', 'CR-V EX', 'used', 22000, 'SUV, Compact')]), ['T1']);
  console.log(' 2. like price, then type:');
  check('(new helper) price before type: a NEW Accord $500 over beats a CPO Accord $6,000 over', () =>
    rank([U('N1', '2026 Honda Accord LX', 2026, 'Honda', 'Accord LX', 'new', 22500), U('C2', '2024 Honda Accord SE', 2024, 'Honda', 'Accord SE', 'cpo', 28000)]), ['N1', 'C2']);
  check('(new helper) Gil\'s case: both about $7k over (same $2,000 band) -> pre-owned wins for a pre-owned shopper', () =>
    rank([U('N2', '2026 Honda Accord LX', 2026, 'Honda', 'Accord LX', 'new', 28498), U('C3', '2025 Honda Accord SE', 2025, 'Honda', 'Accord SE', 'cpo', 28891)]), ['C3', 'N2']);
  check('(new helper) control: a NEW shopper in the same tie -> new wins', () =>
    rank([U('N2', '2026 Honda Accord LX', 2026, 'Honda', 'Accord LX', 'new', 28498), U('C3', '2025 Honda Accord SE', 2025, 'Honda', 'Accord SE', 'cpo', 28891)], 'New'), ['N2', 'C3']);
  console.log(' 3. tiebreaks and the rules that stay:');
  check('(new helper) same band, same type -> nearest model year, then lower miles', () =>
    rank([U('Y1', '2025 Honda Accord SE', 2025, 'Honda', 'Accord SE', 'used', 22500, null, 9000), U('Y2', '2020 Honda Accord SE', 2020, 'Honda', 'Accord SE', 'used', 22400, null, 70000),
          U('Y3', '2020 Honda Accord LX', 2020, 'Honda', 'Accord LX', 'used', 22300, null, 40000)]), ['Y3', 'Y2', 'Y1']);
  check('(new helper) never an older model year than theirs, never the sold unit', () =>
    rank([U('O1', '2016 Honda Accord LX', 2016, 'Honda', 'Accord LX', 'cpo', 22000), U('A1', '2023 Honda Accord LX', 2023, 'Honda', 'Accord LX', 'used', 26000)]), ['A1']);
  check('control: without opts the old call still answers (name-word order, unchanged)', () =>
    vm.runInContext('_lpComparablesWithUnits', sb)(LEADV, [SOLD, U('A1', '2023 Honda Accord LX', 2023, 'Honda', 'Accord LX', 'used', 26000)], 'S001', '', 3).map(x => x.unit.stock), ['A1']);
  console.log(' 4. the prompt says the list is ranked:');
  const UNITS = [SOLD, U('A1', '2024 Honda Accord LX', 2024, 'Honda', 'Accord LX', 'cpo', 23691), U('A2', '2025 Honda Accord SE', 2025, 'Honda', 'Accord SE', 'cpo', 28891)];
  vm.runInContext('_lpValueFactCache', sb)['24399'] = { inv: { units: UNITS }, vf: { incentives: [] }, fetchedAt: Date.now() - 1000, invSettledAt: Date.now(), _settled: true };
  vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;', sb);
  const ol = sb.console.log; sb.console.log = () => {};
  try { sb.populateFromData({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: LEADV, condition: 'Pre-Owned', stockNum: 'S001', dealerId: '24399',
    store: 'Community Honda Lafayette', leadSource: 'Cargurus', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, inventoryWarning: true, inventoryWarningFromNotes: true,
    phone: '(555) 010-0199', email: 'test@example.com', history: '[10/09/2026 3:13 PM] [CUSTOMER] Inbound Text Message\n  Yes that would be great!\n[10/09/2026 3:07 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n',
    relationshipSignals: { unansweredQuestions: [] } }); } finally { sb.console.log = ol; }
  const ctx = vm.runInContext('leadContext', sb);
  check('the pivot line says CLOSEST MATCH FIRST and to name the first one, and lists the 2024 LX first', () =>
    [/They are listed CLOSEST MATCH FIRST -- model, then price nearest the one they wanted, then pre-owned or new as they shop\. Name the FIRST one unless/.test(ctx),
     ctx.indexOf('2024 Honda Accord LX') > -1 && ctx.indexOf('2024 Honda Accord LX') < ctx.indexOf('2025 Honda Accord SE')], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
