#!/usr/bin/env node
'use strict';
/**
 * decline-attribution.test.js — regression tests for hasInternalNotInterested (v9.7.542).
 *
 * The `do not contact` alternative in _declineRe was the only subject-less member of an
 * OR-chain whose own comment promises "customer-ATTRIBUTED decline only". A routine
 * surprise-gift note naming the RECIPIENT's contact details fired it and closed out an
 * actively-buying customer.
 *
 * _negInt, _declineRe and the gift scrub are sliced out of each shipped popup.js and
 * evaluated, so these tests bind to the bytes that ship. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: decline-attribution.test.js <popup.js> [popup.js...]'); process.exit(2); }

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      var _negInt = ');
  const b = src.indexOf('      noteEls.slice(0, 10).some(function(item){');
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate the decline block in ' + file);
  const ctx = {};
  vm.createContext(ctx);
  // The block declares _negInt, _declineRe and _lpGiftScrub. Expose a matcher over them.
  const match = vm.runInContext(
    '(function(){\n' + src.slice(a, b) +
    '\nreturn function(noteText){ var m = (typeof _lpGiftScrub === "function" ? _lpGiftScrub(noteText) : noteText).match(_declineRe); return m ? m[0] : null; };\n})()',
    ctx);
  return { name: path.basename(path.dirname(file)), match };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, build);
let pass = 0, fail = 0;

function check(name, note, shouldFire) {
  const results = impls.map(i => { try { return JSON.stringify(i.match(note)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const fired = results[0] !== 'null';
  const ok = agree && fired === shouldFire;
  if (ok) { pass++; console.log('  ok   ' + name + (fired ? '  → matched ' + results[0] : '')); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + (shouldFire ? 'FIRE' : 'SILENT') + ', got ' + results[0]);
  }
}

console.log('\nv9.7.542 — hasInternalNotInterested requires attribution');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── 1. The live incident. Note text verbatim from the CRM dump. ───────────────
console.log('must be SILENT — third-party / surprise-gift note shapes:');
check('Kahari Oford, the exact note that closed him out',
  "GIRLFRIEND’S INFO BUT DO NOT CONTACT SINCE ITS A SURPRISE Jasmine Thompson Eve: (346) 710-8939 Cell: (346) 710-8939 jthompson100499@gmail.com",
  false);
check('same shape, straight apostrophe',
  "GIRLFRIEND'S INFO BUT DO NOT CONTACT SINCE ITS A SURPRISE Jasmine Thompson Cell: (346) 710-8939", false);
check('anniversary gift, recipient is the spouse',
  "Wife's number below - do not contact her, anniversary surprise. Maria Lopez 281-555-0100", false);
check('birthday gift, recipient named without the word surprise',
  "Do not contact the daughter directly, this is a birthday gift. Sarah 832-555-0177", false);
check('generic gift framing with a do-not-tell instruction',
  "buying for his mother, do not call her, don't tell her about the trade appraisal", false);

// ── 2. Genuine declines must still fire ──────────────────────────────────────
console.log('\nmust still FIRE — genuine customer declines:');
check('the case this logic exists for',
  "customer said do not contact her, not interested", true);
check('subject-before attribution, no other decline wording',
  "Customer asked do not contact him again", true);
check('subject-after attribution',
  "DNC - do not contact this customer, he is done shopping", true);
check('bare do-not-contact with a trailing pronoun, no gift context',
  "spoke with him at the store, do not contact him going forward", true);

// ── 3. The pre-existing attributed alternatives must be untouched ────────────
console.log('\nunchanged — the attributed alternatives that already worked:');
check('agent-reported verbal decline', "Customer stated she is not interested at this time", true);
check('pronoun-attributed decline', "he is not interested, going with another dealer", true);
check('bare no-longer-interested', "no longer interested", true);
check('declined-to-proceed', "customer declined to come in for an appraisal", true);
check('asked to be removed', "asked to be removed from our list", true);
check('the narrow not-interested-IN carve-out still holds',
  "customer is not interested in financing, wants to pay cash", false);

// ── 4. Neighbouring text must not be collaterally scrubbed ──────────────────
console.log('\ngift scrub must not swallow a real decline sharing the note:');
check('surprise-gift clause AND a separate genuine decline in one note',
  "Girlfriend's info but do not contact since its a surprise. Later: customer said he is not interested anymore.", true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
