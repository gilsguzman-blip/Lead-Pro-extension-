#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('trim-spellings-872.test.js');
// (v9.7.872) OWNER-APPROVED 11/12 ("build 872, all of it"; "on the + if a customer says plus will that be picked up?"; "What about
// GT-Line, gt line, gtline"). The 869 Tundra fix, swept across every model with the 11/12 inventory feed for all five stores:
//  (a) the engine block in brackets when it closes; Audi's engine sizes in the feed ("Q5 2.0T Premium Plus", 15 new on the lot);
//      seat counts; Kia's IVT -- none of them the trim; a standalone "Turbo" still is (K4 GT-Line Turbo).
//  (b) one spelling per trim name: SX-Prestige / SX Prestige, Off-Road / Off Road, GT-Line / gt line / gtline; "+" is "plus", so
//      TrailSport+ = TrailSport Plus and is not TrailSport. i-FORCE MAX is the engine, not the trim; "Hybrid MAX" stays.
//  (c) the customer's own words read the same way.
//  (d) a unit whose trim the feed does not list ("2027 Audi Q8 quattro", "Q5 2.0T") is "trim to confirm", never NONE.
// Executes the shipped _lpTrimOf, _lpCustTrimFromWords and _lpWhatWeHave. The feed rows below are the 11/12 feed's vehicle
// descriptions with placeholder stock numbers and no VINs; lead strings follow VinSolutions' format (the Tundra and Audi Q5
// formats are from real leads 2113695730 and 2099714300).
//
// Usage: node tests/trim-spellings-872.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: trim-spellings-872.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let n = 0;
const U = (vehicle, color, cond) => { const y = +vehicle.slice(0, 4), p = vehicle.split(' '); return { stock: 'TEST' + String(++n).padStart(3, '0'), vin: '', vehicle, year: y, make: p[1],
  model: p.slice(2).join(' '), condition: cond || 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color: color || 'Glacier White', interior: 'Black', odometer: 10, daysOnLot: 9, price: 50000 }; };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const T = (v) => run('_lpTrimOf')(v);
  const same = (a, b) => T(a).norm === T(b).norm;
  const quiet = (g) => { const ol = sb.console.log; sb.console.log = () => {}; try { return g(); } finally { sb.console.log = ol; } };

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (a) what is not the trim:');
  const MATCH = [
    ["2026 Toyota Tundra SR5 4dr CrewMax SB w/5.5' Bed (3.4L 6cyl Turbo 10A", '2026 Toyota Tundra SR5', 'the 869 Tundra, cut off before its ")" -- still a match'],
    ["2026 Toyota Tundra Limited 4x4 CrewMax 6.5' Bed (3.4L V6)", '2026 Toyota Tundra Limited', 'a Tundra description that keeps its ")"'],
    ["2026 Toyota Tacoma SR5 4x2 Double Cab 5' Bed (2.4L 4cyl Turbo 8A)", '2026 Toyota Tacoma SR5', 'Tacoma with the engine block closed'],
    ['2027 Toyota Camry LE 4dr Sedan (2.5L 4cyl gas/electric hybrid CVT)', '2027 Toyota Camry LE', 'Camry with the engine block closed'],
    ['2026 Toyota RAV4 XLE Premium AWD 4dr SUV (2.5L 4cyl 8A)', '2026 Toyota RAV4 XLE Premium', 'RAV4 with the engine block closed'],
    ['2026 Honda HR-V Sport 2WD CVT (New)', '2026 Honda HR-V Sport', '"(New)"'],
    ['2026 Audi Q5 Premium Plus 45 TFSI quattro', '2026 Audi Q5 2.0T Premium Plus quattro', 'Audi Q5: VinSolutions\' "45 TFSI" against the feed\'s "2.0T"'],
    ['2026 Audi S5 Prestige quattro', '2026 Audi S5 3.0T Prestige quattro', 'Audi S5 "3.0T"'],
    ['2027 Audi SQ8 Prestige quattro', '2027 Audi SQ8 4.0T Prestige quattro', 'Audi SQ8 "4.0T"'],
    ['2026 Toyota Sienna XLE AWD 8-Passenger', '2026 Toyota Sienna XLE', 'the seat count, hyphenated'],
    ['2025 Toyota Sienna XSE AWD', '2025 Toyota Sienna XSE 7 Passenger', 'the seat count in the feed, spaced'],
    ['2026 Kia Seltos S IVT', '2026 Kia Seltos S', 'Kia\'s IVT'],
    ['2026 Kia K4 LXS IVT', '2026 Kia K4 LXS', 'Kia\'s IVT (K4)'],
  ];
  MATCH.forEach(([a, b, why]) => check(why + ' -> one trim', () => same(a, b), true));
  check('control: a standalone "Turbo" is still the trim -- K4 GT-Line Turbo is not the K4 GT-Line', () => same('2026 Kia K4 GT-Line IVT', '2026 Kia K4 GT-Line Turbo'), false);
  check('control: Sorento X-Line EX is not the Sorento EX', () => same('2026 Kia Sorento X-Line EX AWD', '2026 Kia Sorento EX'), false);
  check('control: a 3.4L, a 5.5\' bed and a 3.0T leave nothing behind ("SR5", "Limited", "Prestige")',
    () => [T("2026 Toyota Tundra SR5 4dr CrewMax SB w/5.5' Bed (3.4L 6cyl Turbo 10A").disp, T("2026 Toyota Tundra Limited 4x4 CrewMax 6.5' Bed (3.4L V6)").disp, T('2026 Audi S5 3.0T Prestige quattro').disp], ['SR5', 'Limited', 'Prestige']);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (b) one spelling per trim name:');
  check('GT-Line, gt line, gtline, GT Line -> one trim', () => ['2026 Kia K5 gt line', '2026 Kia K5 gtline', '2026 Kia K5 GT Line'].map(v => same(v, '2026 Kia K5 GT-Line')), [true, true, true]);
  check('SX Prestige / SX-Prestige, in either order with X-Line (the Kia feed writes it both ways)',
    () => [same('2027 Kia Telluride Hybrid SX-Prestige AWD', '2027 Kia Telluride Hybrid SX Prestige'), same('2026 Kia Telluride SX Prestige X-Line AWD', '2026 Kia Sorento X-Line SX Prestige'.replace('Sorento', 'Telluride')),
      same('2026 Kia Sportage Hybrid SX Prestige AWD', '2026 Kia Sportage Hybrid SX-Prestige')], [true, true, true]);
  check('Off-Road / Off Road (the Toyota feed writes it both ways)', () => same("2026 Toyota Tacoma TRD Off Road 4x4 Double Cab 5' Bed (2.4L 4cyl Turbo 8A)", '2026 Toyota Tacoma TRD Off-Road'), true);
  check('EX-L / EX L, Sport-L / Sport L, X Line / X-Line', () => [same('2026 Honda CR-V EX L AWD', '2027 Honda CR-V EX-L'), same('2026 Honda Accord Hybrid Sport L', '2026 Honda Accord Hybrid Sport-L'), same('2026 Kia Sportage X Line AWD', '2026 Kia Sportage X-Line')], [true, true, true]);
  check('"+" is "plus": TrailSport+ = TrailSport Plus = trailsport plus', () => [same('2026 Honda Ridgeline TrailSport Plus AWD', '2026 Honda Ridgeline TrailSport+'), same('2026 Honda Ridgeline trailsport plus', '2026 Honda Ridgeline TrailSport+')], [true, true]);
  check('control: TrailSport+ is NOT TrailSport (they were one trim before this build)', () => same('2026 Honda Ridgeline TrailSport AWD', '2026 Honda Ridgeline TrailSport+'), false);
  check('Audi "Premium Plus" is unchanged by the plus rule, and is not "Premium"', () => [same('2026 Audi Q7 Premium Plus 55 TFSI quattro', '2026 Audi Q7 55 Premium Plus quattro'), same('2027 Audi Q7 Premium quattro', '2026 Audi Q7 55 Premium Plus quattro')], [true, false]);
  check('i-FORCE MAX is the engine, not the trim (4Runner); "Hybrid MAX" stays (Grand Highlander)',
    () => [T('2026 Toyota 4Runner i-FORCE MAX Hybrid TRD Off Road Premium').norm, same('2026 Toyota Grand Highlander Hybrid MAX Platinum', '2026 Toyota Grand Highlander Hybrid Platinum')], ['hybrid|offroad|premium|trd', false]);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (c) the customer\'s own words:');
  const words = run('_lpCustTrimFromWords'), fam = (v) => run('_lpModelFamilyKey')(v);
  const K4 = [U('2026 Kia K4 LXS'), U('2026 Kia K4 GT-Line'), U('2026 Kia K4 GT-Line Turbo')];
  const RL = [U('2026 Honda Ridgeline RTL'), U('2026 Honda Ridgeline TrailSport'), U('2026 Honda Ridgeline TrailSport+'), U('2026 Honda Ridgeline Black Edition')];
  const SP = [U('2026 Kia Sportage LX'), U('2026 Kia Sportage SX-Prestige'), U('2026 Kia Sportage X-Line')];
  check('"do you have a gtline" / "gt line" / "GT-Line" -> the K4 GT-Line (not the Turbo)', () => ['do you have a gtline', 'looking at the gt line', 'the GT-Line in white'].map(t => words(K4, fam('2026 Kia K4'), t)), ['GT-Line', 'GT-Line', 'GT-Line']);
  check('"gt line turbo" -> the GT-Line Turbo', () => words(K4, fam('2026 Kia K4'), 'is the gt line turbo still there'), 'GT-Line Turbo');
  check('"trailsport plus" / "TrailSport+" -> the TrailSport+; "trailsport" alone -> the TrailSport', () => ['the trailsport plus please', 'any TrailSport+ left?', 'what about the trailsport'].map(t => words(RL, fam('2026 Honda Ridgeline'), t)), ['TrailSport+', 'TrailSport+', 'TrailSport']);
  check('"sx prestige" -> the Sportage SX-Prestige', () => words(SP, fam('2026 Kia Sportage'), 'do you have the sx prestige'), 'SX-Prestige');

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (d) the inventory answer, against the feed\'s own rows:');
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const ww = (vehicle, dl, store) => quiet(() => { const r = run('_lpWhatWeHave')({ vehicle, dealerId: dl, store, condition: 'New', convState: 'first-touch', leadSource: 'Dealer Website', leadAgeDays: 0,
    hasOutbound: false, hasCustomerReply: false, totalNoteCount: 1, lastInboundMsg: '', conversationBrief: '', history: '', context: '', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name' }); return String((r && r.text) || ''); });
  const line = (t) => (t.split('\n').find(l => /^- the /i.test(l)) || '').replace(/\s+/g, ' ');
  const AUDI = [...Array(15)].map(() => U('2026 Audi Q5 2.0T Premium Plus quattro', 'Navarra Blue Metallic')).concat([U('2026 Audi Q5 2.0T Prestige quattro'), U('2026 Audi Q5 quattro', 'Mythos Black Metallic'),
    U('2027 Audi Q8 quattro'), U('2027 Audi Q8 quattro', 'Daytona Gray Pearl'), U('2027 Audi A6 3.0 quattro'), U('2027 Audi Q7 Premium quattro')]);
  setUnits('21135', AUDI);
  const q5 = ww('2026 Audi Q5 Premium Plus 45 TFSI quattro', '21135', 'Audi Lafayette');
  check('Audi Q5 Premium Plus 45 TFSI quattro, 15 "Q5 2.0T Premium Plus" on the lot -> IN STOCK, x15', () => [/IN STOCK -- 2026 Q5 2\.0T Premium Plus quattro \(Navarra Blue Metallic, Black interior\) x15/.test(line(q5)), /NONE in stock/.test(q5)], [true, false]);
  const q8 = ww('2027 Audi Q8 Premium Plus 55 TFSI quattro', '21135', 'Audi Lafayette');
  check('Audi Q8 Premium Plus, the feed lists the two 2027 Q8s with no trim -> "trim to confirm", never NONE',
    () => [/the inventory record does not list the trim on these 2027 Q8s -- 2027 Q8 quattro \(Glacier White, Black interior\); 2027 Q8 quattro \(Daytona Gray Pearl, Black interior\)\. One of them may be the Premium Plus they want/.test(line(q8)), /NEVER say that trim is not in stock/.test(q8), /NONE in stock/.test(q8)], [true, true, false]);
  const a6 = ww('2027 Audi A6 Premium Plus 55 TFSI quattro', '21135', 'Audi Lafayette');
  check('Audi A6 Premium Plus, the feed lists only "A6 3.0" -> trim to confirm on this A6', () => [/does not list the trim on this 2027 A6 -- 2027 A6 3\.0 quattro \(Glacier White, Black interior\)\. It may be the Premium Plus they want/.test(line(a6)), /NONE in stock/.test(a6)], [true, false]);
  check('control: a trim the feed does list, with none of it here and no trim-less unit, is still NONE (2026 Q5 Prestige is here; the 2027 Q7 Premium Plus is not)',
    () => [/IN STOCK/.test(line(ww('2026 Audi Q5 Prestige 45 TFSI quattro', '21135', 'Audi Lafayette'))), /NONE in stock today/.test(ww('2027 Audi Q7 Premium Plus 55 TFSI quattro', '21135', 'Audi Lafayette'))], [true, true]);
  setUnits('6189', [U('2026 Toyota 4Runner i-FORCE MAX Hybrid TRD Off Road Premium', 'Everest'), U('2026 Toyota Tacoma TRD Off-Road', 'Ice Cap'), U('2026 Toyota Tacoma SR5', 'Celestial Silver Metallic')]);
  check('4Runner TRD Off-Road Premium -> the "i-FORCE MAX Hybrid TRD Off Road Premium" is IN STOCK', () => /IN STOCK -- 2026 4Runner i-FORCE MAX Hybrid TRD Off Road Premium/.test(line(ww('2026 Toyota 4Runner TRD Off-Road Premium 4x4', '6189', 'Community Toyota Baytown'))), true);
  check('Tacoma TRD Off Road (closed engine block) -> the "TRD Off-Road" is IN STOCK', () => /IN STOCK -- 2026 Tacoma TRD Off-Road/.test(line(ww("2026 Toyota Tacoma TRD Off Road 4x4 Double Cab 5' Bed (2.4L 4cyl Turbo 8A)", '6189', 'Community Toyota Baytown'))), true);
  setUnits('24399', RL.map(u => Object.assign({}, u)));
  check('Ridgeline TrailSport+ lead -> the TrailSport+ is IN STOCK, and the plain TrailSport is not counted as it', () => /IN STOCK -- 2026 Ridgeline TrailSport\+ \([^)]*\)\./.test(line(ww('2026 Honda Ridgeline TrailSport+ AWD', '24399', 'Community Honda Lafayette'))), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
