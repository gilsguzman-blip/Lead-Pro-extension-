#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('model-year-799.test.js');
// (v9.7.799) THE MODEL YEAR CHANGES OVER. Audi Lafayette lead 2099714300 (log323): the lead was a 2026 Audi Q7 Premium 45 TFSI
// quattro ("2026 Audi Q7 Q7 Premium 45 TFSI quattro" on the CRM panel), the feed held seven new 2027 Q7 Premium quattros, and
// the inventory answer said "The 2026 Q7 Q7 Premium 45 TFSI quattro: NONE in stock today" -- the new-car pool kept only the
// lead's model year, and the trim reader kept the repeated model word and Audi's engine code, so "Premium 45 TFSI quattro"
// never matched "Premium quattro". Gil, 10/14: "as we approach the new model years we need to account for this across the
// board", and the wording: "We have the 2027 Q7 Premium available" -- no line about the year they asked for not being here.
// Executes the shipped _lpTrimOf and buildUserPrompt (the WHAT WE HAVE block). Placeholder data only.
//
// Usage: node tests/model-year-799.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: model-year-799.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, year, model, color, price, make, cond) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: year + ' ' + (make || 'Audi') + ' ' + model, year,
  make: make || 'Audi', model, condition: cond || 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price });
const Q7 = [U('A001', 2027, 'Q7 Premium quattro', 'Merapi Gray Metallic', null), U('A002', 2027, 'Q7 Premium quattro', 'Merapi Gray Metallic', null),
  U('A003', 2027, 'Q7 Premium quattro', 'Glacier White Metallic', null), U('A004', 2026, 'Q7 55 Premium S Line quattro', 'Glacier White Metallic', 86235),
  U('A005', 2026, 'Q7 55 Premium Plus quattro', 'Mythos Black Metallic', 78010), U('A006', 2023, 'Q7 45 Premium quattro', 'Carrara White', 29900, 'Audi', 'used')];
const PILOT = [U('H001', 2026, 'Pilot EX-L', 'Sonic Gray Pearl', 44169, 'Honda'), U('H002', 2026, 'Pilot Touring', 'Crystal Black Pearl', 52890, 'Honda'),
  U('H003', 2027, 'Pilot TrailSport', 'Diffused Sky Blue Pearl', null, 'Honda')];
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Audi Q7 Q7 Premium 45 TFSI quattro', condition: 'New',
  stockNum: '', vin: '', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Audi Partner Lead', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: false, hasCustomerReply: false, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, context: '[10/14/2026 9:10 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n' }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const cache = vm.runInContext('_lpValueFactCache', sb);
  cache['21135'] = { inv: { units: Q7 }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  cache['24399'] = { inv: { units: PILOT }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  vm.runInContext('activeFlags = new Set(); window._lpGrabStartedAt = 0;', sb);
  const inv = (d) => (quiet(() => sb.__lp.buildUserPrompt(d)).match(/INVENTORY: [^\n]*(?:\n- [^\n]*)*(?:\n[^\n]*drivetrain[^\n]*)?/) || [''])[0];
  const N = (v) => vm.runInContext('_lpTrimOf', sb)(v).norm;

  console.log(' 1. the trim reader:');
  check('"Q7 Q7 Premium 45 TFSI quattro" and "Q7 Premium quattro" are one trim; "55 Premium Plus" and "55 Premium S Line" are not it', () =>
    [N('2026 Audi Q7 Q7 Premium 45 TFSI quattro') === N('2027 Audi Q7 Premium quattro'), N('2026 Audi Q7 55 Premium Plus quattro') === N('2027 Audi Q7 Premium quattro'),
     N('2026 Audi Q7 55 Premium S Line quattro') === N('2027 Audi Q7 Premium quattro')], [true, false, false]);
  check('control: other makes read as before -- "AWD Black Edition 4dr SUV" -> Black Edition; "Hybrid SX" stays Hybrid SX', () =>
    [vm.runInContext('_lpTrimOf', sb)('2026 Honda Pilot AWD Black Edition 4dr SUV').disp, vm.runInContext('_lpTrimOf', sb)('2026 Kia Telluride Hybrid SX').disp], ['Black Edition', 'Hybrid SX']);

  console.log(' 2. their trim in the next model year is the answer:');
  const b = inv(LEAD());
  check('lead 2099714300: "We have the 2027 Q7 Premium available", the units named, and no "NONE in stock" line for the 2026', () =>
    [/- We have the 2027 Q7 Premium available: 2027 Q7 Premium quattro \(Merapi Gray Metallic\) x2; 2027 Q7 Premium quattro \(Glacier White Metallic\)\./.test(b),
     /NONE in stock today/.test(b), /Do NOT say the 2026 is not in stock or not here, and do not explain the model-year change\./.test(b),
     /Lead with the 2027 Q7 Premium as the answer\./.test(b)], [true, false, true, true]);
  check('the other 2026 trims are still counted and never named; the used 2023 is not in a new-car answer', () =>
    [/- In other trims: 2 units\. Do NOT name them/.test(b), /S Line|Premium Plus|Carrara/.test(b)], [true, false]);
  check('across the board: a 2026 Pilot TrailSport lead with a 2027 TrailSport in stock -> "We have the 2027 Pilot TrailSport available"', () =>
    /- We have the 2027 Pilot TrailSport available: 2027 Pilot TrailSport \(Diffused Sky Blue Pearl\)\./.test(inv(LEAD({ vehicle: '2026 Honda Pilot TrailSport', dealerId: '24399', store: 'Community Honda Lafayette' }))), true);
  check('control: the lead\'s own year in stock wins -- a 2026 Pilot EX-L lead gets its EX-L, no next-year line', () => {
    const p = inv(LEAD({ vehicle: '2026 Honda Pilot EX-L', dealerId: '24399', store: 'Community Honda Lafayette' }));
    return [/- The 2026 Pilot EX-L: IN STOCK -- 2026 Pilot EX-L \(Sonic Gray Pearl\)\./.test(p), /We have the 2027/.test(p)]; }, [true, false]);
  check('control: a 2025 lead two years off is not offered the 2027 (only the next or previous year)', () =>
    /We have the 2027/.test(inv(LEAD({ vehicle: '2025 Audi Q7 Premium 45 TFSI quattro' }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
