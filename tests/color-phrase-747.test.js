#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('color-phrase-747.test.js');
// (v9.7.747) Kia Baytown lead 2091863573, 9/30 (log269, dump 50a1f7eb). "I was looking at the Kia Telluride Ex in Jade
// Green" reached the prompt as "This customer asked for Green", and the draft wrote our Black Jade Green unit up as
// "the 2027 Kia Telluride EX in Jade Green". Gil: "can't we leave it open enough for the model to interpret colors ...
// Customer mentions green - Jade Green is the feed color we name it". The model keeps judging the match; it now sees
// the customer's own words for the colour, and names our paint as the feed writes it.
// Executes the shipped colour detector slice and the shipped popup colour block. Placeholder data only.
//
// Usage: node tests/color-phrase-747.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: color-phrase-747.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const line = (body) => '[09/30/2026 8:05 AM] [CUSTOMER] Inbound Text Message\n  ' + body;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const between = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a.slice(0, 40)); return src.slice(i, src.indexOf(b, i) + b.length); };
  const detector = between('      var _lpColorRx = ', "acknowledge availability honestly.');\n      }");
  const scan = (body, voiColor, veh) => {
    const sb = { String, Date, Array, RegExp, concernScanLines: [line(body)], allTranscriptText: body, _fricQuote: '', _fricState: '',
      customerConcerns: [], color: voiColor || '', vin: '', vehicle: veh || '', _lpD() {} };
    vm.createContext(sb); vm.runInContext(detector, sb);
    return { base: sb._statedColor, phrase: vm.runInContext('typeof _statedColorPhrase === "string" ? _statedColorPhrase : "(none)"', sb), concerns: sb.customerConcerns.join('\n') };
  };

  console.log(' 1. the customer\'s own words for the colour are kept:');
  const r = scan('I was looking at the Kia Telluride Ex in Jade Green');
  check('log269: "in Jade Green" -> phrase "Jade Green", base word still "Green"', () => [r.phrase, r.base], ['Jade Green', 'Green']);
  check('...and the preference line carries their words', () => /COLOR PREFERENCE: Customer mentioned Jade Green\./.test(r.concerns), true);
  check('"a Midnight Lake Blue one" -> "Midnight Lake Blue"', () => scan('do you have a Midnight Lake Blue one').phrase, 'Midnight Lake Blue');
  check('a finish after the colour is kept: "snow white pearl" -> "snow white pearl"', () => scan('looking for snow white pearl').phrase, 'snow white pearl');
  check('the lead\'s own vehicle words are not taken as colour: "the Telluride Jade Green" on a Telluride lead', () => scan('the Telluride Jade Green', '', '2027 Kia Telluride EX').phrase, 'Jade Green');
  check('control (new helper): a plain colour stays plain -> "the black one" gives "black"', () => scan('I want the black one').phrase, 'black');
  check('control: the base word and the matching logic are unchanged ("Black exterior and white interior" -> Black)', () => { const x = scan('Black exterior and white interior', 'Panthera Metal'); return [x.base, /MOVED OFF THE UNIT ON THE LEAD: they asked for BLACK/.test(x.concerns)]; }, ['Black', true]);
  check('it leaves the scraper beside the base word', () => /customerStatedColorPhrase: \(typeof _statedColorPhrase === 'string'/.test(src), true);

  console.log(' 2. the popup shows their words and names our paint as the feed writes it:');
  const span = (mark, end) => { const i = src.indexOf(mark); return src.slice(i, src.indexOf(end, i) + end.length); };
  const clean = span('function _lpCleanColor(c){', '\n}\n') + '\n' + span('function _lpColorWords(s){', 'return set; }\n');
  const block = span('  if (_lpInvConfirmedAvailable) {\n    // ── (v9.7.660)', '\n  } else if (_audiAllAvail').replace(/ else if \(_audiAllAvail$/, '');
  const paint = (said, phrase) => {
    const sb = { String, Object, _lpInvConfirmedAvailable: true, _lpInvUnit: { stock: 'TEST001A', color: 'Black Jade Green' },
      d: { stockNum: 'TEST001A', color: 'Black Jade Green', customerStatedColor: said, customerStatedColorPhrase: phrase }, vehicleExtras: [], console: { log() {} } };
    vm.createContext(sb); vm.runInContext(clean + '\n' + block, sb); return sb.vehicleExtras.join('\n');
  };
  const p = paint('Green', 'Jade Green');
  check('"This customer asked for Jade Green", not just "Green"', () => [/This customer asked for Jade Green\./.test(p), /Work out for yourself whether Black Jade Green IS Jade Green/.test(p)], [true, true]);
  check('the draft names our paint as the feed writes it, never their words for it', () =>
    [/USE OUR NAME FOR IT AS THE FEED WRITES IT — "Black Jade Green"/.test(p), /"we have one in Black Jade Green", not "the Jade Green one you wanted is here"/.test(p)], [true, true]);
  check('control: the model still judges the match (the leeway is kept)', () => /Judge the colour the name actually DESCRIBES, never whether their word appears inside it/.test(p), true);
  check('control: an older scrape with no phrase still reads "asked for Green"', () => /This customer asked for Green\./.test(paint('Green', '')), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
