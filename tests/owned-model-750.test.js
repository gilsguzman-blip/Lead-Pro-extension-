#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('owned-model-750.test.js');
// (v9.7.750) Toyota Baytown lead 2079679068, 10/1 (log of 10/1, dump 2a2c8460, page dump 5b29520d). A TradePending lead
// on the customer's 2022 Corolla XSE, no vehicle of interest. Her only Tundra mention: "I sold my 2018 Camary & my 2013
// Tundra in past to Freeman when we lived in DFW". _lpOwnWordsModel (v9.7.725) read "Tundra" as the model she wants,
// the prompt said "in their own words they want 'Tundra'", and the draft asked "are you still considering a Tundra?".
// Gil: "Agent was confused because the VOI of a Tundra was introduced and we can't see any reference to that other
// than her 2022 Corolla trade." A mention the customer owns or has sold is now skipped -- the pivot guard's own test.
// Executes the shipped _lpOwnWordsModel. Placeholder data only.
//
// Usage: node tests/owned-model-750.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: owned-model-750.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const MARK = '[09/07/2026 8:27 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const brief = (...says) => says.map((t, i) => '[09/07/2026 11:' + String(50 + i) + ' AM] [CUSTOMER] Inbound Text Message\n  ' + t + '\n').join('') + MARK;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const m = (b, dealer) => { try { return sb._lpOwnWordsModel(b, dealer || '6189'); } catch (e) { return 'THREW ' + e.message; } };

  console.log(' 1. a car they own or sold is not one they want:');
  check('log of 10/1: "I sold my 2018 Camary & my 2013 Tundra in past to Freeman" -> no model', m(brief('Maybe let me talk my husband about it I sold my 2018 Camary & my 2013 Tundra in past to Freeman when we lived in DFW Was very happy with those transactions', 'Ok')), '');
  check('"we traded in our RAV4 last year" -> no model', m(brief('we traded in our RAV4 last year')), '');
  check('"I drive a 2020 Camry" -> no model', m(brief('I drive a 2020 Camry right now')), '');
  check('owned one skipped, wanted one kept: "I have a 2019 Camry and want a Tundra" -> tundra', m(brief('I have a 2019 Camry and want a Tundra')), 'tundra');

  console.log(' 2. what was read before still is:');
  check('control: "I\'m looking for a Tundra" -> tundra', m(brief("I'm looking for a Tundra")), 'tundra');
  check('control: desire through a possessive is not ownership: "my wife wants an Accord" -> accord', m(brief('my wife wants an Accord'), '6191'), 'accord');
  check('control: no model named -> none', m(brief('Sounds good, thanks')), '');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
