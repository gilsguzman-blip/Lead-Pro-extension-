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

// ---- v1.1: trims and search, from the 11/28 exports of all five stores ----
const tp = (model, year, make) => L.trimParts({ model, year: year || 2026, make: make || '' });
check('Hybrid moves out of the trim', tp('CR-V Hybrid Sport-L'), { power: 'Hybrid', drive: '', base: 'Sport-L' });
check('trailing Hybrid too', tp('CR-V Sport Touring Hybrid').base, 'Sport Touring');
check('Plug-In (capital I, as vAuto writes it)', tp('RAV4 Plug-In Hybrid XSE').power, 'Plug-in Hybrid');
check('2026 RAV4 with no word is a hybrid', tp('RAV4 LE', 2026).power, 'Hybrid');
check('2025 RAV4 with no word is gas', tp('RAV4 LE', 2025).power, 'Gas');
check('Camry 2025+ hybrid', tp('Camry SE', 2026).power, 'Hybrid');
check('Prius is hybrid', tp('Prius XLE').power, 'Hybrid');
check('drive word is not the trim', tp('Pilot TrailSport AWD'), { power: 'Gas', drive: 'AWD', base: 'TrailSport' });
check('Audi quattro + engine code stripped', tp('Q5 2.0T Premium Plus quattro', 2026, 'Audi').base, 'Premium Plus');
check('Audi 55 stripped', tp('Q7 55 Premium Plus quattro', 2026, 'Audi').base, 'Premium Plus');
check('Audi A8 L keeps its L', tp('A8 L 55 quattro', 2026, 'Audi').base, 'L');
check('Audi FrontTrak is drive', tp('A3 2.0T FrontTrak', 2026, 'Audi').drive, 'FRONTTRAK');
check('no trim given says so', tp('A5 quattro', 2026, 'Audi').base, 'Trim not listed');
check('a literal Base stays Base', tp('Prelude Base').base, 'Base');
check('"Si Base" is a Si', tp('Civic Si Base').base, 'Si');
check('SQ6 e-tron is its own model and electric', [L.family({ model: 'SQ6 e-tron Prestige quattro' }), tp('SQ6 e-tron Prestige quattro', 2026, 'Audi').power], ['SQ6 e-tron', 'Electric']);
check('A6 Sportback e-tron is not a gas A6', [L.family({ model: 'A6 Sportback e-tron Premium quattro' }), tp('A6 Sportback e-tron Premium quattro', 2026, 'Audi').power], ['A6 Sportback e-tron', 'Electric']);
check('"RS 3" is the RS3', [L.family({ model: 'RS 3 2.5T quattro' }), L.trim({ model: 'RS 3 2.5T quattro' })], ['RS3', '2.5T quattro']);

const T = L.prepare({ generated: '2026-11-28', units: [
  { stock: 'A', make: 'Toyota', year: 2026, model: 'Tacoma TRD Off-Road', condition: 'new', daysOnLot: 10 },
  { stock: 'B', make: 'Toyota', year: 2026, model: 'Tacoma Hybrid TRD Off Road', condition: 'new', daysOnLot: 50 },
  { stock: 'C', make: 'Honda', year: 2026, model: 'Ridgeline TrailSport', condition: 'new', daysOnLot: 5, body: 'Crew Cab Pickup' },
  { stock: 'D', make: 'Honda', year: 2026, model: 'Ridgeline TrailSport+', condition: 'new', daysOnLot: 7 },
  { stock: 'E', make: 'Audi', year: 2026, model: 'Q3 S Line quattro', condition: 'new', daysOnLot: 1 },
  { stock: 'F', make: 'Audi', year: 2026, model: 'Q3 S line quattro', condition: 'new', daysOnLot: 2 },
  { stock: 'G', make: 'Audi', year: 2026, model: 'Q3 S line quattro', condition: 'new', daysOnLot: 3 },
] }, '2026-11-28');
const trimsOf = fam => L.trims(L.filter(T.units, { family: fam })).map(t => t.label + ' ' + t.count);
check('Off-Road and Off Road are one trim', trimsOf('Tacoma'), ['TRD Off-Road 2']);
check('TrailSport and TrailSport+ stay apart', trimsOf('Ridgeline'), ['TrailSport 1', 'TrailSport+ 1']);
check('S Line / S line merge, most common spelling shown', trimsOf('Q3'), ['S line 3']);
check('powertrain chips', L.powers(L.filter(T.units, { family: 'Tacoma' })), [{ power: 'Gas', count: 1 }, { power: 'Hybrid', count: 1 }]);
check('trim filter picks exactly one', stocks(L.filter(T.units, { family: 'Ridgeline', trim: 'Ridgeline|trailsport plus' })), ['D']);

const H = L.prepare({ generated: '2026-11-28', units: [
  ['1', 'CR-V Hybrid Sport-L'], ['2', 'CR-V Hybrid Sport Touring'], ['3', 'CR-V EX-L'], ['4', 'CR-V Hybrid Sport'],
  ['5', 'Passport TrailSport Elite'], ['6', 'Passport TrailSport'], ['7', 'Odyssey EX-L'], ['8', 'Civic Sport'],
].map(([s, m], i) => ({ stock: 'TB09950' + s, vin: 'X' + s, make: 'Honda', year: 2026, model: m, vehicle: '2026 Honda ' + m,
  condition: 'new', daysOnLot: 10 + i, body: /Odyssey/.test(m) ? 'Passenger Van' : 'Sport Utility' })) }, '2026-11-28');
const q = s => stocks(L.filter(H.units, { query: s })).sort();
check('"sport" = the word Sport only (no Passport, TrailSport, body type)', q('sport'), ['TB099501', 'TB099502', 'TB099504', 'TB099508']);
check('"sport l" is Sport-L, not EX-L', q('sport l'), ['TB099501']);
check('"sport-l" the same', q('sport-l'), ['TB099501']);
check('"trailsport" finds both TrailSports', q('trailsport'), ['TB099505', 'TB099506']);
check('"pass" (typing) finds Passports, not the Odyssey "Passenger Van"', q('pass'), ['TB099505', 'TB099506']);
check('digits match anywhere in stock #', q('9503'), ['TB099503']);
const K = L.prepare({ generated: '2026-11-28', units: [
  { stock: 'K1', make: 'Kia', model: 'Sportage LX', condition: 'new', daysOnLot: 3 },
  { stock: 'U1', make: 'Jeep', model: 'Wrangler Sport', condition: 'used', daysOnLot: 3 },
] }, '2026-11-28');
check('Kia "sport" still finds Sportage when a used car says Sport', stocks(L.filter(K.units, { condition: 'new', query: 'sport' })), ['K1']);

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
