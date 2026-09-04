#!/usr/bin/env node
'use strict';
// (v9.7.628) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('variant-token.test.js');

/**
 * variant-token.test.js — v9.7.628. A DIRECTIVE BUILT ON THE WORD "AND".
 *
 * LIVE, 9/4, Bobby Terrazas (Community Toyota Baytown). His CarGurus lead text reads:
 *
 *     "I'm interested in this 2018 Ford Expedition and I'd like to know if it's still available"
 *
 * The variant detector matches "<make> <model> <token>" and took the token verbatim, so the prompt
 * shipped:
 *
 *     ⚠ VEHICLE VARIANT MISMATCH: the customer's own words ask about a different configuration —
 *     "and" — of this same model than the unit actually on file (2018 Ford Expedition Platinum).
 *     These are NOT the same vehicle and are NOT automatically interchangeable.
 *
 * A directive built on an English conjunction, telling the model two vehicles exist when one does.
 *
 * v9.7.597 FOUND THIS AND DEFERRED IT, in its own header: "the variant token is the English word
 * 'is' ... It produces a directive built on nothing. Left for its own build rather than folded in
 * unmeasured." Today's six-grab capture is that measurement: 2 of 6 leads fired it, both on
 * function words — "and" on a Ford Expedition and again on a Kia EV6.
 *
 * Same bare-token class as v9.7.555 ("ram" matching inside "Timeframe") and v9.7.597's inverted
 * chat summary. The only guard was length > 1, which "and" and "is" both clear.
 *
 * THE FIX rejects ordinary English words as configurations, and — the v9.7.537 lesson — rejecting
 * one candidate does not end the scan, so a real trim sitting behind a function word is still
 * found. Executes the SHIPPED extractor. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: variant-token.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    // (v9.7.628) A VARIANT IS A CONFIGURATION');
  const b = src.indexOf('    if (_vmOtherVariant) {', a);
  if (a < 0 || b < 0) require('./lib/fatal-guard.js').bail('variant-token.test.js', 'extractor not in ' + file);
  const code = src.slice(a, b);
  const sb = { String, RegExp, console: { log() {} },
    _lpNormVehicleStr: x => String(x || ''),
    _LP_MAKE_RX: /\b(ford|kia|toyota|honda|audi|nissan|chevrolet|gmc|jeep|ram|hyundai)\b/gi };
  vm.createContext(sb);
  return { src, run: (voi, famKey, brief) => {
    sb.d = { vehicle: voi, conversationBrief: brief, context: '' };
    sb._voiFamKey = famKey;
    vm.runInContext(code, sb);
    return vm.runInContext('_vmOtherVariant', sb);
  }};
}

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — a variant is a configuration, not the next word');

  console.log('\nthe two shapes that fired in production:');
  check('Bobby — "Expedition and I\'d like to know" yields no variant',
    B.run('2018 Ford Expedition Platinum', 'ford|expedition',
      "I'm interested in this 2018 Ford Expedition and I'd like to know if it's still available"), '');
  check('the v9.7.597 case — "Sentra is" yields no variant',
    B.run('2024 Nissan Sentra SV', 'nissan|sentra', 'the 2024 Nissan Sentra is still on the lot'), '');

  console.log('\na real configuration is still found:');
  check('a genuine trim', B.run('2018 Ford Expedition Platinum', 'ford|expedition',
    'do you have the Ford Expedition Limited instead'), 'limited');
  check('a powertrain variant', B.run('2026 Kia Niro', 'kia|niro',
    'what about the Kia Niro hybrid'), 'hybrid');
  // The v9.7.537 rule: rejecting a candidate must not end the search.
  check('a real trim BEHIND a function word is still reached',
    B.run('2018 Ford Expedition Platinum', 'ford|expedition',
      'this 2018 Ford Expedition and also do you have a Ford Expedition Limited'), 'limited');
  check('the VOI\'s own trim is not a mismatch',
    B.run('2018 Ford Expedition Platinum', 'ford|expedition',
      'the Ford Expedition Platinum you listed'), '');
  check('no mention at all yields nothing',
    B.run('2018 Ford Expedition Platinum', 'ford|expedition', 'when are you open'), '');

  console.log('\nthe blocklist covers the class, not just the two seen:');
  ['is', 'and', 'or', 'was', 'with', 'that', 'available', 'today', 'please'].forEach(w =>
    check('  "' + w + '" is not a configuration',
      B.run('2018 Ford Expedition Platinum', 'ford|expedition',
        'the 2018 Ford Expedition ' + w + ' something'), ''));

  console.log('\nit never throws:');
  check('empty brief', B.run('2018 Ford Expedition Platinum', 'ford|expedition', ''), '');
  check('no family key', B.run('2018 Ford Expedition Platinum', '', 'anything'), '');
  check('the guard is in the shipped source',
    /!_LP_NOT_A_TRIM\[_vmTok\]/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds share one blocklist:');
  const cut = f => { const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('    var _LP_NOT_A_TRIM = (function(){');
    return s.slice(i, s.indexOf('return s; })();', i)); };
  check('dev and commercial are identical', cut(BUILDS[0]) === cut(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
