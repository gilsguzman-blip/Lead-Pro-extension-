#!/usr/bin/env node
'use strict';
// (v9.7.620) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('powertrain.test.js');

/**
 * powertrain.test.js — v9.7.620. AN ELECTRIFIED SIBLING SHARED THE NAMEPLATE AND WON ON ARRAY ORDER.
 *
 * FOUND IN LIVE DATA, 9/4, off the first run of the new dashboard panel: Kia Baytown is holding
 * 11 "Niro" lines and 4 "Niro EV" lines, in one store, right now.
 *
 * Both `ev` and `hybrid` sit in _LP_STOP, and correctly so — neither may CONSTITUTE a match on its
 * own, or "Accord Hybrid" would pair with "Civic Hybrid". But _lpScoreStrict's candExtra penalty
 * (the mechanism that properly excludes "Tundra i-FORCE MAX" from a Tundra lead, and "RAV4 Plug-in
 * Hybrid" from a RAV4 lead) skips stop-words when counting a candidate's extra tokens. A one-word
 * electrified suffix therefore costs the candidate NOTHING, the two nameplates tie at the top
 * score, and `.sort()` leaves array position to decide which one a customer is quoted.
 *
 * Measured against the SHIPPED scorer and the five rooftops' real model lists:
 *     2026 Kia Niro          -> Niro:2  Niro EV:2            TIE
 *     2026 Honda Accord EX-L -> Accord:2  Accord Hybrid:2    TIE
 *     2026 Honda CR-V EX     -> CR-V:2  CR-V Hybrid:2        TIE
 *     2026 Toyota Corolla LE -> Corolla:2  Corolla Hybrid:2  TIE
 * Four nameplate families across three rooftops — this was never only the Niro.
 *
 * THE TIE IS ONE-DIRECTIONAL. A hybrid lead correctly beats the base car, because its extra shared
 * token scores. Only the ordinary-car shopper is exposed, and exposed to the biggest numbers on the
 * sheet: EV cash and hybrid-only APR.
 *
 * THE FIX IS NOT A SCORER CHANGE. Removing `hybrid`/`ev` from _LP_STOP would let those tokens carry
 * a match by themselves, which is the defect the stop list exists to prevent. Instead this mirrors
 * _LP_PERF_TRIMS: powertrain DISAGREEMENT is disqualifying, at the same single choke point, without
 * making a powertrain word matchable. The suite proves that distinction below — the scorer still
 * ties, and _lpMatchByModel returns one candidate anyway, so the gate is demonstrably load-bearing.
 *
 * Executes the SHIPPED helpers and the SHIPPED choke point. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: powertrain.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const END = 'return scored.slice(0, cap || 2).map(function(o){ return o.x; }); }';
  const a = src.indexOf('var _LP_STOP = (function(){');
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) {
    require('./lib/fatal-guard.js').bail('powertrain.test.js', 'scorer/choke-point region not found in ' + file);
  }
  // console swallowed: the gate's diagnostic is not under test here and would drown the output.
  const sb = { console: { log(){}, warn(){}, error(){} } };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b + END.length), sb);
  return {
    src,
    powerOf:  vm.runInContext('_lpPowertrainOf', sb),
    mismatch: vm.runInContext('_lpPowertrainMismatch', sb),
    strict:   vm.runInContext('_lpScoreStrict', sb),
    match:    vm.runInContext('_lpMatchByModel', sb),
  };
}

// The REAL model lists, read off the dashboard panel on 9/4.
const KIA   = ['EV6','Sportage','Seltos','Niro','Sorento','Carnival','K4','K5','Niro EV','EV9','Telluride'];
const HONDA = ['Accord','Accord Hybrid','Civic Sedan','Civic Sedan Hybrid','Civic Hatchback',
               'Civic Hatchback Hybrid','CR-V','CR-V Hybrid','HR-V','Odyssey','Passport','Pilot',
               'Ridgeline','Prologue'];
const TOY   = ['Corolla','Corolla Hybrid','Corolla Cross','Corolla Cross Hybrid','RAV4',
               'RAV4 Plug-in Hybrid','Prius','Prius Plug-in Hybrid','Highlander','Highlander Hybrid',
               'Grand Highlander','Grand Highlander Hybrid','Tundra','Tundra i-FORCE MAX','Camry'];

for (const file of BUILDS) {
  const B = load(file);
  const pick = (lead, list) =>
    B.match(lead, list.map(m => ({ model: m })), x => x.model, 2, true).map(x => x.model);

  console.log('\n' + path.relative(process.cwd(), file) + ' — powertrain must agree before money is quoted');

  // ── THE REPORTED HAZARD ────────────────────────────────────────────────────
  console.log('\nKia Baytown, 11 Niro lines and 4 Niro EV lines in one store:');
  check('a Niro lead gets the Niro program, alone',      pick('2026 Kia Niro LX', KIA),      ['Niro']);
  check('a Niro EV lead gets the EV program, alone',     pick('2026 Kia Niro EV Wind', KIA), ['Niro EV']);

  // The gate must not swallow Kia's pure-electric nameplates. "EV6"/"EV9" are single tokens and
  // \bev\b cannot match inside them (6 and 9 are word characters) — so they classify as Gas and
  // match themselves. If that boundary is ever loosened, these two rooftops lose their EV lines.
  console.log('\n...without swallowing the nameplates that are spelled EV:');
  check('EV6 classifies as Gas, not Electric', B.powerOf('EV6'), 'Gas');
  check('EV9 classifies as Gas, not Electric', B.powerOf('EV9'), 'Gas');
  check('an EV6 lead still matches EV6', pick('2026 Kia EV6 GT-Line', KIA), ['EV6']);
  check('an EV9 lead still matches EV9', pick('2026 Kia EV9 Land', KIA), ['EV9']);

  // ── THE SAME DEFECT, THREE MORE ROOFTOPS ───────────────────────────────────
  console.log('\nHonda — four nameplates carry a hybrid twin:');
  check('Accord EX-L takes the gas Accord',        pick('2026 Honda Accord EX-L', HONDA),        ['Accord']);
  check('Accord Hybrid takes the hybrid program',  pick('2026 Honda Accord Hybrid Sport', HONDA),['Accord Hybrid']);
  check('CR-V EX takes the gas CR-V',              pick('2026 Honda CR-V EX', HONDA),            ['CR-V']);
  check('CR-V Hybrid takes the hybrid program',    pick('2026 Honda CR-V Hybrid Sport', HONDA),  ['CR-V Hybrid']);
  check('Civic Sedan stays gas',                   pick('2026 Honda Civic Sedan LX', HONDA),     ['Civic Sedan']);
  check('a Prologue is unaffected',                pick('2026 Honda Prologue EX', HONDA),        ['Prologue']);

  console.log('\nToyota — and plug-in must outrank plain hybrid in classification:');
  check('Corolla LE takes the gas Corolla',        pick('2026 Toyota Corolla LE', TOY),          ['Corolla']);
  check('Corolla Hybrid takes the hybrid',         pick('2026 Toyota Corolla Hybrid LE', TOY),   ['Corolla Hybrid']);
  check('"Prius Plug-in Hybrid" is Plug-in Hybrid, not Hybrid',
    B.powerOf('Prius Plug-in Hybrid'), 'Plug-in Hybrid');
  check('a Plug-in Hybrid lead does not take the plain hybrid program',
    B.mismatch('2026 Toyota RAV4 Plug-in Hybrid XSE', 'RAV4 Hybrid') !== '', true);
  check('a RAV4 lead keeps the gas RAV4',          pick('2026 Toyota RAV4 XLE', TOY),            ['RAV4']);
  check('a Tundra lead keeps the gas Tundra',      pick('2026 Toyota Tundra SR5', TOY),          ['Tundra']);
  check('Grand Highlander does not collapse into Highlander',
    pick('2026 Toyota Grand Highlander XLE', TOY), ['Grand Highlander']);

  // ── THE GATE IS WHAT FIXED IT ──────────────────────────────────────────────
  // Non-vacuity, stated as an assertion rather than trusted: the scorer STILL ties on every pair
  // above — the stop list is deliberately untouched — and the choke point returns one candidate
  // regardless. If someone "simplifies" this by editing _LP_STOP instead, the first two fail.
  console.log('\nthe scorer still ties — the gate, not a scoring change, is doing the work:');
  check('Niro and Niro EV still score equal',   B.strict('2026 Kia Niro LX','Niro')      === B.strict('2026 Kia Niro LX','Niro EV'), true);
  check('Accord and Accord Hybrid still tie',   B.strict('2026 Honda Accord EX-L','Accord') === B.strict('2026 Honda Accord EX-L','Accord Hybrid'), true);
  check('...and the choke point still returns exactly one', pick('2026 Kia Niro LX', KIA).length, 1);
  check('`hybrid` is still a stop word', /'hybrid'/.test(B.src.slice(B.src.indexOf('var _LP_STOP'), B.src.indexOf('var _LP_STOP') + 700)), true);
  check('`ev` is still a stop word',     /'ev'/.test(B.src.slice(B.src.indexOf('var _LP_STOP'), B.src.indexOf('var _LP_STOP') + 700)), true);

  // ── CLASSIFICATION EDGES ───────────────────────────────────────────────────
  console.log('\nclassification edges:');
  check('a bare nameplate is Gas',        B.powerOf('Niro'), 'Gas');
  check('"Niro EV" is Electric',          B.powerOf('Niro EV'), 'Electric');
  check('"e-tron" is Electric',           B.powerOf('Q8 e-tron'), 'Electric');
  check('"PHEV" is Plug-in Hybrid',       B.powerOf('Escape PHEV'), 'Plug-in Hybrid');
  check('empty text is Gas, not a crash', B.powerOf(''), 'Gas');
  check('null is Gas, not a crash',       B.powerOf(null), 'Gas');
  check('agreement returns empty string', B.mismatch('2026 Kia Niro', 'Niro'), '');
  check('disagreement names both sides',  B.mismatch('2026 Kia Niro', 'Niro EV'), 'Gas lead vs Electric offer');
  // "Elevation", "Everest", "Seven" — \bev\b must not fire inside a longer word.
  check('\\bev\\b does not fire inside a longer word', B.powerOf('Silverado Elevation'), 'Gas');

  // ── THE LOOSE PATH IS DELIBERATELY UNTOUCHED ───────────────────────────────
  // Suggesting an electrified sibling as an ALTERNATIVE is legitimate; quoting its money is not.
  // Every caller today is strict, so this guards a future one.
  console.log('\nthe gate is strict-only — a comparable may still be an electrified sibling:');
  const loose = B.match('2026 Kia Niro LX', KIA.map(m => ({ model: m })), x => x.model, 4, false)
                 .map(x => x.model);
  check('the loose path still offers the Niro EV as an alternative', loose.indexOf('Niro EV') > -1, true);
  check('...while the strict path does not', pick('2026 Kia Niro LX', KIA).indexOf('Niro EV'), -1);

  // ── NO REGRESSION IN THE GATE IT MIRRORS ───────────────────────────────────
  console.log('\nthe performance-trim gate it mirrors still works:');
  check('a Type R lead does not take the ordinary Civic program',
    pick('2026 Honda Civic Type R', ['Civic Sedan','Civic Hatchback']), []);
  check('a plain Civic still takes its own',
    pick('2026 Honda Civic Sedan LX', ['Civic Sedan','Civic Hatchback']), ['Civic Sedan']);
}

// ── dev === comm ─────────────────────────────────────────────────────────────
if (BUILDS.length > 1) {
  console.log('\nboth builds ship the same gate:');
  const g = BUILDS.map(f => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('var _LP_POWERTRAINS = [');
    const j = s.indexOf('}\n', s.indexOf('function _lpPowertrainMismatch', i));
    return s.slice(i, j);
  });
  check('dev and commercial carry an identical powertrain gate', g[0] === g[1], true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
