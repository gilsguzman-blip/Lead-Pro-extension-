#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('price-concern.test.js');

/**
 * price-concern.test.js — v9.7.638. AN UNBOUNDED WILDCARD MATCHED SIX HUNDRED CHARACTERS ACROSS
 * FOUR MESSAGES AND TWO SPEAKERS.
 *
 * Rebecca Caplan (Community Honda Baytown, 9/5). Her prompt carried
 *
 *     PRICE/PAYMENT CONCERN: Customer raised price or payment as an issue.
 *     Open by addressing this directly - not by pitching features.
 *
 * She never raised price. The draft that went out opened "Confirm your $75k max" and asked
 * "is your max budget $75,000 (not miles)?" — of a woman shopping a used small SUV who had
 * written "I want a used car around 50,000 no more than 75,000" meaning MILES, and confirmed it
 * two messages later with "That CRV probably has more miles than i want".
 *
 * THE TRIGGER WAS `over.*budget`. Unbounded on both sides, run against the whole transcript joined
 * into one string, it matched from HER "over the phone" to OUR "in your budget range" — six
 * hundred characters, four message boundaries, two speakers, and neither fragment about price.
 * `payment.*too` and `price.*concern` carried the identical hazard.
 *
 * Same class as v9.7.555 ("ram" inside "Timeframe") and v9.7.554 ("poi" inside "appointment"):
 * a pattern with no boundary discipline reaching text it was never meant to span. And the word
 * that completed the match is OURS, which v9.7.594 already settled is not evidence about the
 * customer — that rule simply never reached this scanner.
 *
 * Executes the SHIPPED regex and the SHIPPED our-own-send predicate against Rebecca's real
 * transcript. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: price-concern.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('price-concern.test.js', m);

// Rebecca's real thread, transcribed from the 9/5 capture. Tagged exactly as the scraper tags it,
// because the our-own-send exclusion reads the line's own title text.
const THREAD = [
  '[09/04/2026 8:11 PM] [CUSTOMER] Inbound Text Message I am interested in the 2020 Volkswagen. What other times do you have available tomorrow?',
  '[09/04/2026 8:11 PM] [AGENT] Outbound Text Message I see that the 2020 Volkswagen Tiguan has sold, but we do have a 2024 Volkswagen Atlas 2.0T SE w/Technology available in white with 61,408 miles. For scheduling, tomorrow is Saturday and we are open 9:00 AM to 8:00 PM.',
  '[09/04/2026 8:12 PM] [CUSTOMER] Inbound Text Message No thank you. You need to remove it off your website then. Do you still have the 2017 blue jeep renegade?',
  '[09/04/2026 8:13 PM] [CUSTOMER] Inbound Text Message We want a small suv. The atlas is bigger than we want.',
  '[09/04/2026 8:14 PM] [CUSTOMER] Inbound Text Message I want a used car around 50,000 no more than 75,000. Small suv with lots of safety features.',
  '[09/04/2026 8:14 PM] [AGENT] Outbound Text Message I can connect you with our team who can go over pricing and available small SUVs with safety features in your budget range.',
  '[09/04/2026 8:16 PM] [CUSTOMER] Inbound Text Message They can send me stuff. I live in Clear Lake so im only coming if there is a car that i can purchase when i come. I need to see the listing with photos.',
  '[09/04/2026 8:26 PM] [CUSTOMER] Inbound Text Message Perfect thanks. I drive a honda odyssey we bought from you quick and easy found it over the phone and came and bought it same day. Thats the experience i am looking for. That CRV probably has more miles than i want but i will look at it.'
];

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/if\((\/too \(much\|high\|expensive\)[\s\S]*?\/i)\.test\(allTranscriptText\)\)\{/);
  if (!m) bail('the price/payment regex is not where this suite expects it in ' + file + ' — THE SUITE DID NOT LOAD');
  const oa = src.indexOf('    function _lpIsOurOwnSend(text) {');
  if (oa < 0) bail('_lpIsOurOwnSend not in ' + file + ' — THE SUITE DID NOT LOAD');
  const ob = src.indexOf('\n    }', oa);
  const sb = { String };
  vm.createContext(sb);
  vm.runInContext(src.slice(oa, ob + 6), sb);
  return {
    src,
    ourOwn: vm.runInContext('_lpIsOurOwnSend', sb),
    rx: vm.runInContext('(' + m[1] + ')', sb)
  };
}

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — price is a thing she has to actually say');

  // Reproduce the shipped pipeline: drop our own sends, join, test.
  const kept = THREAD.filter(l => !B.ourOwn(l));
  const scanText = kept.join(' ');
  const allText = THREAD.join(' ');

  // ── THE INCIDENT ───────────────────────────────────────────────────────────
  console.log('\nRebecca\'s thread:');
  check('no PRICE/PAYMENT CONCERN is raised', B.rx.test(scanText), false);
  check('  ...and the two outbound messages are excluded from the scan', THREAD.length - kept.length, 2);
  check('  ...specifically the ones whose titles say Outbound Text Message',
    THREAD.filter(l => B.ourOwn(l)).every(l => /Outbound Text Message/.test(l)), true);

  // BOTH causes are load-bearing on their own — asserted separately so a future edit that undoes
  // either one is attributable, rather than hiding behind the other.
  console.log('\neach cause alone would have prevented it:');
  check('bounding alone: the wildcards no longer span her text plus ours', B.rx.test(allText), false);
  check('exclusion alone: our "budget range" sentence is not customer evidence',
    B.ourOwn('[09/04/2026 8:14 PM] [AGENT] Outbound Text Message ... in your budget range.'), true);
  // The exact span the old pattern matched, kept verbatim so the regression is named.
  check('the old span "over the phone ... your budget range" no longer matches',
    B.rx.test('found it over the phone and came and bought it same day. '
            + 'I can connect you with our team who can go over pricing and available small SUVs '
            + 'with safety features in your budget range'), false);

  // ── IT MUST STILL FIRE ON A REAL PRICE COMPLAINT ───────────────────────────
  // Narrowing a detector is only correct if the thing it detects still gets detected.
  console.log('\na customer who actually raises price still trips it:');
  const MUST = [
    'that payment is too high for me',
    'this is way over my budget',
    'what is the price on the blue one',
    "what's the price on the blue one",
    'how much is the CR-V',
    // These two were MISSED by the shipped pattern and were found by writing this suite, not by a
    // report: `can.t afford` is a single-character wildcard, so it matched "can't" and "cant" but
    // never "cannot"; `what.s the price` never matched "what is the price". Both widened here.
    'I cannot afford 600 a month',
    "I can't afford 600 a month",
    'that is too expensive',
    'what would the monthly payment be',
    'can you give me an out the door number'
  ];
  for (const s of MUST) {
    check('  fires: ' + JSON.stringify(s.slice(0, 44)),
      B.rx.test('[09/05/2026] [CUSTOMER] Inbound Text Message ' + s), true);
  }
  // An agent NOTE recording a price complaint is still evidence — v9.7.594 drew that line
  // deliberately and this build does not move it.
  check('an agent NOTE recording her complaint still counts',
    B.ourOwn('[09/05/2026] [NOTE] Call Note customer says the payment is too high') === false
      && B.rx.test('[09/05/2026] [NOTE] Call Note customer says the payment is too high'), true);

  // ── THE BOUNDING IS THE MECHANISM ──────────────────────────────────────────
  console.log('\nthe wildcards are bounded to one sentence:');
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const [was, now] of [['over.*budget', 'over[^.!?\\n]{0,20}budget'],
                            ['payment.*too', 'payment[^.!?\\n]{0,30}too'],
                            ['price.*concern', 'price[^.!?\\n]{0,20}concern']]) {
    check('  ' + was + ' is gone', code.indexOf(was) >= 0, false);
    check('    ...replaced by ' + now, code.indexOf(now) >= 0, true);
  }
  check('a sentence boundary really does stop it',
    B.rx.test('I paid it over the phone. They gave me a budget range'), false);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds scan the same text with the same pattern:');
  const region = f => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf('      var _lpSrcNoise = ');
    const b = s.indexOf('      // (v9.7.581) A BARE NOUN IS NOT A RELATIONSHIP CLAIM.', a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the concern scanner is identical', region(BUILDS[0]) === region(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
