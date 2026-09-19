#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('pivot-stock.test.js');

/**
 * pivot-stock.test.js — v9.7.657. WE DECLINED A SALE WE COULD HAVE MADE.
 *
 * LIVE, 9/11. Rachel Landry, Audi Lafayette, lead on a 2022 INFINITI QX50 LUXE (Pre-Owned). She
 * wrote "I currently own an Infiniti. I'm also looking at the Honda CR-V." The delivered SMS:
 *
 *   "Audi Lafayette doesn't carry Honda inventory, so I won't steer you toward something we
 *    can't provide."
 *
 * Six lines earlier in the SAME log, on the SAME generation:
 *
 *   [LP OFF-FRANCHISE GATE] make:Honda | suppressed — we hold 11 used honda unit(s)
 *                           — not off-franchise | reader:comprehension
 *
 * Lead Pro read the live feed, found eleven used Hondas on that rooftop, correctly suppressed its
 * own off-franchise directive, and a different block then told the customer we have none. The same
 * log has Lead Pro writing about a 2016 Jeep Wrangler at Audi Lafayette, and the lead itself is an
 * INFINITI on the Audi lot.
 *
 * The rule was already written, in v9.7.576: a franchise constraint is about NEW cars. This suite
 * drives the SHIPPED _lpPivotStock and the SHIPPED four-arm branch, so the claim is "the directive
 * reads the lot", not "the helper counts correctly".
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: pivot-stock.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const span = (mark, what, end) => {
    const a = src.indexOf(mark);
    if (a < 0) throw new Error(what + ' not found');
    const b = src.indexOf(end, a);
    if (b < 0) throw new Error(what + ' end not found');
    return src.slice(a, b + end.length);
  };
  // The helper, plus the two it delegates to. _lpOffFranchiseGate is the whole point: the fix is
  // that the pivot block consults it rather than re-deciding.
  const helper = span('function _lpPivotStock(pivotModel, pivotBrand, d) {', '_lpPivotStock', '\n}\n')
    + '\n' + span('function _lpOffFranchiseGate(make, text, dealerId, cache) {', '_lpOffFranchiseGate', '\n}\n')
    + '\n' + span('function _lpNormMake(m){', '_lpNormMake', '\n}\n');

  const a = src.indexOf("        var _pvStock = _lpPivotStock(pivotModel, _pivotBrand, data);");
  if (a < 0) throw new Error('four-arm branch not found');
  const endMark = "\n        }";
  const b = src.indexOf("+ (_equiv ? ' You may mention the ' + _equiv + ' once as a comparison.' : '');", a);
  if (b < 0) throw new Error('four-arm branch end not found');
  const arms = src.slice(a, src.indexOf(endMark, b) + endMark.length);

  return { name: path.basename(path.dirname(file)), src, helper, arms };
}

// ── THE FEED SHAPE ──────────────────────────────────────────────────────────
// Units as the inventory cache carries them: make/model/vehicle, plus whatever else rides along.
const unit = (year, make, model) => ({ year: String(year), make, model, vehicle: year + ' ' + make + ' ' + model });
// Audi Lafayette as it stood on 9/11: eleven used Hondas, a CR-V among them, plus the lot's
// ordinary spread of other makes.
const AUDI_LAFAYETTE = [
  unit(2021, 'Honda', 'CR-V'), unit(2020, 'Honda', 'CR-V'), unit(2019, 'Honda', 'Accord'),
  unit(2022, 'Honda', 'Civic'), unit(2018, 'Honda', 'Pilot'), unit(2021, 'Honda', 'HR-V'),
  unit(2020, 'Honda', 'Odyssey'), unit(2019, 'Honda', 'Ridgeline'), unit(2022, 'Honda', 'Passport'),
  unit(2017, 'Honda', 'Fit'), unit(2023, 'Honda', 'Insight'),
  unit(2022, 'INFINITI', 'QX50'), unit(2016, 'Jeep', 'Wrangler'), unit(2023, 'Ram', '1500'),
  unit(2024, 'Audi', 'Q5'), unit(2023, 'Audi', 'A4'),
];
const NO_HONDA = AUDI_LAFAYETTE.filter(u => u.make !== 'Honda');

function cacheOf(units) { return units ? { '21135': { inv: { units } } } : { '21135': { inv: {} } }; }

function stockFor(impl, units, model, brand, custText) {
  const sb = {
    String, RegExp, Date, JSON,
    _lpValueFactCache: cacheOf(units),
    _lpCustomerText: () => custText || '',
    _LP_MAKE_ALIAS: {},
    d: { dealerId: '21135' },
    __out: null,
  };
  vm.createContext(sb);
  vm.runInContext(impl.helper, sb);
  sb.__m = model; sb.__b = brand;
  vm.runInContext('__out = _lpPivotStock(__m, __b, d);', sb);
  return sb.__out;
}

// Runs the SHIPPED four-arm branch with a stock reading supplied, and returns the directive.
function noteFor(impl, pv, opts) {
  opts = opts || {};
  const logs = [];
  const sb = {
    String, JSON,
    _lpPivotStock: () => pv,
    pivotModel: opts.model || 'Cr-v',
    _pivotBrand: opts.brand || 'honda',
    _pivotBrandCap: opts.brandCap || 'Honda',
    _currentBrandCap: opts.storeCap || 'Audi',
    _equiv: opts.equiv === undefined ? '' : opts.equiv,
    data: { vehicle: opts.vehicle || '2022 INFINITI QX50 LUXE', dealerId: '21135' },
    vehiclePivotNote: '',
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext(impl.arms, sb);
  return { note: vm.runInContext('vehiclePivotNote', sb), logs: logs.join(' ') };
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
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

console.log('\nv9.7.657 — the pivot block asks the lot before declining the sale');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) RACHEL LANDRY, 9/11, END TO END ─────────────────────────────────────
console.log('\n(1) Rachel Landry, Audi Lafayette:');
const RACHEL_TEXT = "Thanks. I currently own an Infiniti. I'm also looking at the Honda CR-V. I'll contact you later...thank you.";
const rachel = i => stockFor(i, AUDI_LAFAYETTE, 'Cr-v', 'honda', RACHEL_TEXT);

check('the lot holds eleven used Hondas, matching the gate line in her own log',
  i => rachel(i).makeUnits, 11);
check('...two of them CR-Vs', i => rachel(i).modelUnits, 2);
check('she did not ask for a NEW one', i => rachel(i).saidNew, false);
check('inventory was in hand', i => rachel(i).inventoryKnown, true);

const rachelNote = i => noteFor(i, rachel(i)).note;

check('THE SENTENCE SHE RECEIVED IS GONE — no claim we cannot provide Honda',
  i => /cannot provide Honda inventory|do NOT carry Honda/.test(rachelNote(i)), false);
check('...and the directive says outright that we have them',
  i => /OUR OWN LOT HOLDS 2 pre-owned Cr-v unit\(s\) right now/.test(rachelNote(i)), true);
check('...and forbids the denial in as many words',
  i => /DO NOT tell this customer we cannot supply it/.test(rachelNote(i)), true);
check('...and states the reason, so it generalises rather than patching her lead',
  i => /a franchise constraint is about NEW cars/.test(rachelNote(i)), true);

// A count is not a confirmed match. This restraint is what keeps the arm from becoming a promise.
check('no specific trim, colour, year or unit may be named',
  i => /Do NOT name a specific trim, colour, year or unit/.test(rachelNote(i)), true);
check('the lead vehicle stays as the comparison, not a substitute',
  i => /stays in play as the comparison, not as a substitute/.test(rachelNote(i)), true);

check('the diagnostic names the arm that ran',
  i => /arm:HAVE-THE-MODEL/.test(noteFor(i, rachel(i)).logs), true);
check('...and carries the gate\'s own reason',
  i => /we hold 11 used honda unit\(s\)/.test(noteFor(i, rachel(i)).logs), true);

// ── (2) THE MAKE BUT NOT THE MODEL ──────────────────────────────────────────
console.log('\n(2) we carry the make used, just not that model today:');
const noCrv = AUDI_LAFAYETTE.filter(u => u.model !== 'CR-V');
const makeOnly = i => stockFor(i, noCrv, 'Cr-v', 'honda', RACHEL_TEXT);

check('nine Hondas, no CR-V', i => [makeOnly(i).makeUnits, makeOnly(i).modelUnits], [9, 0]);
check('the denial is still forbidden',
  i => /DO NOT tell this customer we cannot provide Honda inventory/.test(noteFor(i, makeOnly(i)).note), true);
check('the NEW/USED distinction is the message',
  i => /we do not sell NEW Honda — but our pre-owned lot carries other makes/.test(noteFor(i, makeOnly(i)).note), true);
check('it says the model is not on the ground and offers to watch',
  i => /a Cr-v is not on the ground right now, and offer to watch for one/.test(noteFor(i, makeOnly(i)).note), true);
check('it does not promise an appointment for a car we lack',
  i => /Do NOT promise an appointment to see a Cr-v we do not have/.test(noteFor(i, makeOnly(i)).note), true);
check('the comparable is allowed once, never as a replacement',
  i => /ONCE as a comparison, never as a replacement/.test(noteFor(i, makeOnly(i), { equiv: 'Audi Q5' }).note), true);
check('the diagnostic names this arm',
  i => /arm:HAVE-THE-MAKE/.test(noteFor(i, makeOnly(i)).logs), true);

// ── (3) THE ORIGINAL DIRECTIVE, WHERE IT IS TRUE ────────────────────────────
// Two facts make it true and no others: they asked for it NEW, or the feed is in hand and empty.
console.log('\n(3) the original wording survives exactly where it is true:');
const zeroHonda = i => stockFor(i, NO_HONDA, 'Cr-v', 'honda', RACHEL_TEXT);
const saidNew   = i => stockFor(i, AUDI_LAFAYETTE, 'Cr-v', 'honda', 'I want a new Honda CR-V');

check('zero Hondas in a feed we hold', i => [zeroHonda(i).makeUnits, zeroHonda(i).inventoryKnown], [0, true]);
check('the original claim is made', i => /We are a Audi store — we do NOT carry Honda/.test(noteFor(i, zeroHonda(i)).note), true);
check('...to the byte, including the three-step approach',
  i => /Required approach: \(1\) Acknowledge their interest in the Cr-v — validate it is a solid choice\. \(2\) Be honest we are a Audi store and cannot provide Honda inventory\./.test(noteFor(i, zeroHonda(i)).note), true);

check('"new Honda CR-V" is read as a NEW ask', i => saidNew(i).saidNew, true);
check('...and the franchise claim is made even though we hold eleven used ones',
  i => /we do NOT carry Honda/.test(noteFor(i, saidNew(i)).note), true);
check('the diagnostic names this arm', i => /arm:CROSS-BRAND\b/.test(noteFor(i, zeroHonda(i)).logs), true);

// ── (4) THE FEED DID NOT LOAD ───────────────────────────────────────────────
// v9.7.483 posture: a failed fetch must not manufacture an off-franchise directive. The same
// applies to an absolute denial, so nothing is claimed in either direction.
console.log('\n(4) inventory unknown claims nothing in either direction:');
const unknown = i => stockFor(i, null, 'Cr-v', 'honda', RACHEL_TEXT);

check('the helper reports inventory as unknown', i => unknown(i).inventoryKnown, false);
// MY ASSERTION WAS WRONG AND THE CODE WAS RIGHT: this arm contains the words "cannot provide
// Honda inventory" inside a PROHIBITION on saying them, so a substring test reads the guard as
// the offence. The question is whether the denial is INSTRUCTED, so that is what is tested.
check('the denial is forbidden rather than issued',
  i => /do NOT claim we cannot provide Honda inventory/.test(noteFor(i, unknown(i)).note), true);
check('...and arm 3\'s instruction form is absent',
  i => /Be honest we are a Audi store and cannot provide Honda inventory/.test(noteFor(i, unknown(i)).note), false);
check('...as is the flat "we do NOT carry" claim',
  i => /store — we do NOT carry Honda/.test(noteFor(i, unknown(i)).note), false);
check('no stock claim is issued either', i => /OUR OWN LOT HOLDS/.test(noteFor(i, unknown(i)).note), false);
check('the franchise fact is stated only in the form that is true without inventory',
  i => /do not sell NEW Honda/.test(noteFor(i, unknown(i)).note), true);
check('it says plainly that the feed did not load',
  i => /Our live inventory did not load on this generation/.test(noteFor(i, unknown(i)).note), true);
check('the diagnostic names this arm', i => /arm:CROSS-BRAND-SOFTENED/.test(noteFor(i, unknown(i)).logs), true);

// ── (5) THE MODEL MATCH ─────────────────────────────────────────────────────
// A punctuation variant list is the enumeration trap. Both sides are stripped instead.
console.log('\n(5) CR-V, CRV and Cr-v are one model:');

check('the customer\'s "Cr-v" matches a feed "CR-V"', i => rachel(i).modelUnits, 2);
check('a feed carrying "CRV" matches too',
  i => stockFor(i, [unit(2021, 'Honda', 'CRV')], 'Cr-v', 'honda', RACHEL_TEXT).modelUnits, 1);
check('a feed carrying "Cr-v" matches too',
  i => stockFor(i, [unit(2021, 'Honda', 'Cr-v')], 'CR-V', 'honda', RACHEL_TEXT).modelUnits, 1);
check('a different Honda model does not match',
  i => stockFor(i, [unit(2021, 'Honda', 'HR-V')], 'CR-V', 'honda', RACHEL_TEXT).modelUnits, 0);
check('a unit with only a vehicle string still matches',
  i => stockFor(i, [{ make: 'Honda', vehicle: '2021 Honda CR-V EX-L' }], 'CR-V', 'honda', RACHEL_TEXT).modelUnits, 1);
check('another make\'s same-named model is not counted — the gate filters by make first',
  i => stockFor(i, [{ make: 'Kia', model: 'CR-V' }], 'CR-V', 'honda', RACHEL_TEXT).modelUnits, 0);

// ── (6) ROBUSTNESS ──────────────────────────────────────────────────────────
console.log('\n(6) the helper cannot throw on a degenerate lead:');

check('an empty feed', i => stockFor(i, [], 'Cr-v', 'honda', '').makeUnits, 0);
check('a unit with no model or vehicle',
  i => stockFor(i, [{ make: 'Honda' }], 'Cr-v', 'honda', '').modelUnits, 0);
check('an empty model name counts no models',
  i => stockFor(i, AUDI_LAFAYETTE, '', 'honda', '').modelUnits, 0);
check('an unknown brand reports nothing rather than throwing',
  i => stockFor(i, AUDI_LAFAYETTE, 'Cr-v', '', '').makeUnits, 0);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.657):');

const noModel = i => Object.assign({}, rachel(i), { modelUnits: 0 });
check('A: with no model match she falls to the make arm, not the denial',
  i => /PIVOT TO A MAKE WE CARRY PRE-OWNED/.test(noteFor(i, noModel(i)).note), true);
check('A (control): the shipped reading puts her on the model arm',
  i => /PIVOT TO A MODEL WE ACTUALLY HAVE/.test(rachelNote(i)), true);

const noMake = i => Object.assign({}, rachel(i), { modelUnits: 0, makeUnits: 0 });
check('B: with no make match the sentence she actually received comes back',
  i => /Audi store — we do NOT carry Honda/.test(noteFor(i, noMake(i)).note), true);
check('B (control): the shipped reading never produces it',
  i => /do NOT carry Honda/.test(rachelNote(i)), false);

const unknownPin = i => Object.assign({}, rachel(i), { modelUnits: 0, makeUnits: 0, inventoryKnown: false });
check('C: with inventory unknown neither claim is made',
  i => {
    const n = noteFor(i, unknownPin(i)).note;
    return !/do NOT carry Honda/.test(n) && !/OUR OWN LOT HOLDS/.test(n);
  }, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
