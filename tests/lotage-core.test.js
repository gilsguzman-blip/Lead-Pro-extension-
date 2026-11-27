#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('lotage-core.test.js');

/**
 * lotage-core.test.js — Lot Age web app v1.0 (lotage/lot-core.js).
 *
 * The app's one promise: within the cars that match what the customer asked for, the OLDEST
 * unit is listed first. These checks pin the three things that promise rests on:
 *   - age today = vAuto's Age as of the export date + days since that export;
 *   - a unit with no Age never sorts as the oldest (it goes last, shown as "?");
 *   - model families group trims and hybrids ("RAV4 Hybrid XLE" is a RAV4, "Grand Highlander"
 *     is not a Highlander).
 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'lotage', 'lot-core.js'));

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ---- age ----
check('daysBetween across a month end', L.daysBetween('2026-10-30', '2026-11-02'), 3);
check('daysBetween garbage is null', L.daysBetween('soon', '2026-11-02'), null);
check('age adds days since the export', L.ageToday({ daysOnLot: 40 }, '2026-11-20', '2026-11-27'), 47);
check('age on export day is the export age', L.ageToday({ daysOnLot: 40 }, '2026-11-27', '2026-11-27'), 40);
check('export dated in the future adds nothing', L.ageToday({ daysOnLot: 40 }, '2026-11-30', '2026-11-27'), 40);
check('missing Age stays null, never 0', L.ageToday({ daysOnLot: null }, '2026-11-20', '2026-11-27'), null);
check('no export date: export age as is', L.ageToday({ daysOnLot: 12 }, null, '2026-11-27'), 12);

// ---- families ----
const fam = m => L.family({ model: m });
check('RAV4 trim -> RAV4', fam('RAV4 XLE Premium'), 'RAV4');
check('RAV4 Hybrid -> RAV4', fam('RAV4 Hybrid XSE'), 'RAV4');
check('Grand Highlander is its own family', fam('Grand Highlander Hybrid Limited'), 'Grand Highlander');
check('Highlander', fam('Highlander XLE'), 'Highlander');
check('Corolla Cross beats Corolla', fam('Corolla Cross LE'), 'Corolla Cross');
check('CR-V Hybrid -> CR-V', fam('CR-V Hybrid Sport-L'), 'CR-V');
check('Q4 e-tron beats Q4 alone', fam('Q4 e-tron Premium'), 'Q4 e-tron');
check('Q8 e-tron beats Q8', fam('Q8 e-tron Prestige'), 'Q8 e-tron');
check('Q5 is not SQ5', fam('SQ5 Premium Plus'), 'SQ5');
check('case-insensitive (KIA SOUL style exports)', fam('SOUL GT-Line'), 'Soul');
check('unknown used make falls back to first word', fam('Wrangler Unlimited Sport'), 'Wrangler');
check('empty model -> Other', fam(''), 'Other');
check('trim is what follows the family', L.trim({ model: 'Grand Highlander Hybrid Limited' }), 'Hybrid Limited');

// ---- bands ----
check('band 59 fresh', L.ageBand(59), 'fresh');
check('band 60 warn', L.ageBand(60), 'warn');
check('band 90 alert', L.ageBand(90), 'alert');
check('band null unknown', L.ageBand(null), 'unknown');

// ---- sort + filter on a realistic store blob ----
const inv = {
  store: 'Toyota Baytown', generated: '2026-11-25',
  units: [
    { stock: 'T100', vin: 'JTM1', year: 2026, make: 'Toyota', model: 'RAV4 XLE', condition: 'new', color: 'Blueprint', daysOnLot: 12 },
    { stock: 'T101', vin: 'JTM2', year: 2026, make: 'Toyota', model: 'RAV4 Hybrid XLE', condition: 'new', color: 'Ice Cap', daysOnLot: 133 },
    { stock: 'T102', vin: 'JTM3', year: 2025, make: 'Toyota', model: 'RAV4 LE', condition: 'new', color: 'Ice Cap', daysOnLot: 45 },
    { stock: 'T103', vin: 'JTM4', year: 2026, make: 'Toyota', model: 'RAV4 XLE', condition: 'new', color: 'Blueprint', daysOnLot: null },
    { stock: 'T104', vin: 'JTM5', year: 2026, make: 'Toyota', model: 'Grand Highlander XLE', condition: 'new', color: 'Ice Cap', daysOnLot: 200 },
    { stock: 'U200', vin: 'JTM6', year: 2021, make: 'Toyota', model: 'RAV4 XLE', condition: 'cpo', color: 'Silver', daysOnLot: 80 },
    { stock: 'U201', vin: '1C4X', year: 2018, make: 'Jeep', model: 'Wrangler Unlimited Sport', condition: 'used', color: 'Black', daysOnLot: 30 },
  ],
};
const P = L.prepare(inv, '2026-11-27');
const stocks = a => a.map(u => u.stock);

check('ages carry the 2 days since export', P.units.map(u => u._age), [14, 135, 47, null, 202, 82, 32]);
check('new RAV4s oldest first, no-age last', stocks(L.filter(P.units, { condition: 'new', family: 'RAV4' })), ['T101', 'T102', 'T100', 'T103']);
check('Grand Highlander never lands in a RAV4 list', L.filter(P.units, { condition: 'all', family: 'RAV4' }).some(u => u.stock === 'T104'), false);
check('used includes CPO', stocks(L.filter(P.units, { condition: 'used' })), ['U200', 'U201']);
check('refine words in any order', stocks(L.filter(P.units, { condition: 'new', family: 'RAV4', query: 'xle hybrid' })), ['T101']);
check('color filter, oldest first', stocks(L.filter(P.units, { condition: 'new', family: 'RAV4', color: 'ice cap' })), ['T102', 'T101'].reverse());
check('stock # search', stocks(L.filter(P.units, { condition: 'all', query: 'u201' })), ['U201']);
check('VIN fragment search', stocks(L.filter(P.units, { condition: 'all', query: 'jtm3' })), ['T102']);
check('ties: older model year first', stocks([{ stock: 'B', year: 2026, _age: 10 }, { stock: 'A', year: 2025, _age: 10 }].sort(L.byOldest)), ['A', 'B']);

const fams = L.families(P.units, 'new');
check('family chips, most stocked first, with oldest age', fams, [
  { family: 'RAV4', count: 4, oldest: 135 }, { family: 'Grand Highlander', count: 1, oldest: 202 },
]);
check('summary ignores unknown ages', L.summary(L.filter(P.units, { condition: 'new', family: 'RAV4' })), { count: 4, oldest: 135, avg: 65, aged: 1 });
check('color chips by count', L.colors(L.filter(P.units, { condition: 'new', family: 'RAV4' })), [{ color: 'Blueprint', count: 2 }, { color: 'Ice Cap', count: 2 }]);
check('empty / null inventory is safe', L.prepare(null, '2026-11-27').units, []);

// ---- stores match the Data Tool ----
const fs = require('fs');
const dt = fs.readFileSync(path.join(__dirname, '..', 'datatool', 'index.html'), 'utf8');
const m = dt.match(/const ID2LABEL=(\{[^}]*\})/);
check('store list matches the Data Tool ID2LABEL', m ? Object.fromEntries(L.STORES.map(s => [s.id, s.label])) : 'not found', m ? JSON.parse(m[1]) : 'x');

// ---- American spelling in customer-visible text ----
const html = fs.readFileSync(path.join(__dirname, '..', 'lotage', 'index.html'), 'utf8');
check('no British spellings in the app', /\b(colour|grey|favourite|centre|organis|recognis|cancelled|labelled)/i.test(html), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
