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
  // (v9.7.641) The scan now drops entries we sent ourselves. _lpIsOurOwnSend is LIFTED FROM THE
  // SHIPPED FILE rather than stubbed — a stand-in would let the real predicate rot while this
  // suite stayed green, the trap v9.7.588 recorded.
  const oa = src.indexOf('function _lpIsOurOwnSend(');
  if (oa < 0) require('./lib/fatal-guard.js').bail('variant-token.test.js', '_lpIsOurOwnSend not in ' + file);
  let d0 = 0, st0 = false, oe = -1;
  for (let i = oa; i < src.length; i++) {
    if (src[i] === '{') { d0++; st0 = true; }
    else if (src[i] === '}') { d0--; if (st0 && d0 === 0) { oe = i + 1; break; } }
  }
  vm.runInContext(src.slice(oa, oe), sb);
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
  // ── (v9.7.641) OUR OWN BOT'S SUBJECT LINE IS NOT A CUSTOMER REQUEST ───────────────────────────
  // Madison Leggion (Audi Lafayette, 9/5, 2021 Ford Mustang GT Fastback). Her prompt carried
  //   VEHICLE VARIANT MISMATCH: the customer's own words (read the arc) ask about a different
  //   configuration — "awaits" — of this same model
  // on a lead whose own facts section reads "0 inbound / 2 outbound" and "The customer has never
  // replied to anything on this lead". The token came from the auto-responder's SUBJECT LINE,
  // "Your 2021 Ford Mustang Awaits at Audi Lafayette" — our marketing copy, quoted back as hers.
  //
  // Measured over all 231 variant scans in the captures: 38 fired, the v9.7.628 word blocklist stops
  // 13, and 23 still shipped — 18 of them on words that are not trims at all ("read" x4, "black",
  // "https", "search", "options", "listed", "configuration", and "robert", a person's name). The
  // blocklist is the enumeration axis; authorship is the right one.
  const MADISON = '[09/05/2026 6:51 AM] [AGENT] Email reply to prospect\n'
    + '  Subject: Your 2021 Ford Mustang Awaits at Audi Lafayette By: Vinessa Virtual Assistant Audi Lafayette '
    + 'Hi Madison, I am Vinessa. We have a stunning 2021 Ford Mustang in our inventory\n'
    + '[09/05/2026 6:51 AM] [AGENT] Outbound Text Message\n  Reply YES to receive text messages.\n';
  console.log('\nthe auto-responder\'s own copy is not the customer asking:');
  check('Madison — "awaits" no longer ships as a configuration',
    B.run('2021 Ford Mustang GT Fastback', 'ford|mustang', MADISON), '');
  check('  ...and a REAL trim in our own subject line is dropped too, not just a junk word',
    B.run('2026 Honda Pilot Elite', 'honda|pilot',
      '[09/05/2026] [AGENT] Email reply to prospect\n  Subject: Your 2026 Honda Pilot Touring Awaits\n'), '');
  check('  ...an outbound TEXT of ours is dropped as well',
    B.run('2026 Honda Pilot Elite', 'honda|pilot',
      '[09/05/2026] [AGENT] Outbound Text Message\n  the 2026 Honda Pilot Touring is a great choice\n'), '');

  // ── THE CASE THIS DETECTOR WAS BUILT FOR MUST STILL FIRE ──────────────────────────────────────
  // Gary Hudson (v9.7.505): the variant sits in AUSTIN LEONARD'S OWN NOTE — "Looking for a 2023 jeep
  // wrangler 4xe" — not in a customer-tagged message. Filtering to [CUSTOMER] lines would have
  // silently broken the feature's founding incident, which is exactly why the filter is
  // our-own-send and not customer-tags. This is the control that pins that decision.
  console.log('\n  ...but an agent NOTE about the customer still counts (v9.7.505, Gary Hudson):');
  check('the 4xe in Austin Leonard\'s note still fires',
    B.run('2025 Jeep Wrangler Willys', 'jeep|wrangler',
      '[07/28/2026] [NOTE] Phone Note\n  Looking for a 2023 jeep wrangler 4xe, wants to know about the plug in\n'), '4xe');
  check('  ...and so does the customer saying it herself',
    B.run('2025 Jeep Wrangler Willys', 'jeep|wrangler',
      '[07/28/2026] [CUSTOMER] Inbound Text Message\n  I want a 2023 jeep wrangler 4xe not the willys\n'), '4xe');
  check('  ...a real note outranks our own copy in the same brief',
    B.run('2025 Jeep Wrangler Willys', 'jeep|wrangler',
      '[09/05/2026] [AGENT] Email reply to prospect\n  Subject: Your 2025 Jeep Wrangler Awaits today\n'
      + '[07/28/2026] [NOTE] Phone Note\n  Looking for a 2023 jeep wrangler 4xe\n'), '4xe');

  // THE ENTRY, NOT THE LINE. The first draft of this fix tested each line on its own, which dropped
  // the "[AGENT] Email reply to prospect" header and KEPT the indented body underneath it — which is
  // where the subject line, and therefore "awaits", actually lives. Executing the shipped scan on
  // Madison's real transcript still returned "awaits", which is how it was caught before shipping.
  console.log('\n  ...and a dropped entry takes its body lines with it:');
  check('the header alone is not what carries the token',
    /Subject: Your 2021 Ford Mustang Awaits/.test(MADISON), true);
  check('  ...so the body under a dropped header is dropped too',
    B.run('2021 Ford Mustang GT Fastback', 'ford|mustang', MADISON), '');
  check('  ...while a body under a KEPT header survives',
    B.run('2025 Jeep Wrangler Willys', 'jeep|wrangler',
      '[07/28/2026] [NOTE] Phone Note\n  Looking for a 2023 jeep wrangler 4xe\n'), '4xe');

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
