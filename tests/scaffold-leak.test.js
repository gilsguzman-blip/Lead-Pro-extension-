#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('scaffold-leak.test.js');

/**
 * scaffold-leak.test.js — regression tests for the arc scaffold cut (v9.7.543).
 *
 * The conversation-arc builder splits the resolved context on a lookahead for the next
 * dated entry, so the LAST entry absorbs every trailing character — including the
 * directive blocks appended to leadContext. v9.7.529 added a cut at the first
 * "prompt scaffold marker", but the marker list was an allowlist and EXIT SIGNAL:
 * was not on it: the cut landed at a LATER marker and the directive still shipped,
 * while the diagnostic reported a successful truncation.
 *
 * _scaffoldRe is sliced out of each shipped popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: scaffold-leak.test.js <popup.js> [popup.js...]'); process.exit(2); }

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const line = src.split('\n').filter(l => l.indexOf('var _scaffoldRe =') >= 0);
  if (line.length !== 1) throw new Error('need exactly 1 _scaffoldRe in ' + file + ', got ' + line.length);
  const ctx = {};
  vm.createContext(ctx);
  // Mirror the shipped consumer: cut at the marker, drop the entry if it is entirely scaffold.
  const cut = vm.runInContext(
    '(function(msgText){' + line[0] +
    ' var h = msgText.search(_scaffoldRe);' +
    ' if (h === 0) return null;' +          // entry is entirely scaffold — dropped
    ' if (h > 0) return msgText.substring(0, h).trim();' +
    ' return msgText; })', ctx);
  return { name: path.basename(path.dirname(file)), cut };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, build);
let pass = 0, fail = 0;

function check(name, input, expected) {
  const results = impls.map(i => { try { return JSON.stringify(i.cut(input)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(expected) + '\n        got      ' + results[0]);
  }
}

const EXIT_DIRECTIVE = 'EXIT SIGNAL: customer has declined or is no longer interested (a short "no thanks", ' +
  '"not interested", or they bought elsewhere). Acknowledge it and write a gracious close only — thank them, ' +
  'leave the door open for the future, and STOP. Do NOT pivot to alternatives, do NOT offer appointment times, ' +
  'do NOT ask ANY question. Total CRM entries: 25 MOST RECENT CUSTOMER MESSAGE [sent TODAY]: "Not needed."';

console.log('\nv9.7.543 — arc scaffold cut');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('the live leaks — directive must be cut, genuine note kept:');
check('Maci Alvarado (genuine exit, 8/12) — voicemail stub + EXIT SIGNAL',
  'By: JOSE AREVALO Left message ' + EXIT_DIRECTIVE,
  'By: JOSE AREVALO Left message');
check('Kahari Oford (false exit, 8/11) — call note + EXIT SIGNAL',
  'By: Noelia Diaz wanting to get his girlfriend a new vehicle for her birthday, coming in next thursday to meet with a sales rep ' + EXIT_DIRECTIVE,
  'By: Noelia Diaz wanting to get his girlfriend a new vehicle for her birthday, coming in next thursday to meet with a sales rep');
check('v9.7.529 original case still cut (callmeasurement + FOLLOW-UP)',
  'By: System https://www.callmeasurement.com/review_x.cfm?cid=6001 FOLLOW-UP: read the full transcript and write a response',
  'By: System https://www.callmeasurement.com/review_x.cfm?cid=6001');

console.log('\nglyph-family rule — directive blocks added since the list was written:');
check('📅 APPOINTMENT HISTORY', 'By: Robert Staten Left message 📅 APPOINTMENT HISTORY (read the arc)', 'By: Robert Staten Left message');
check('✅ CONFIRMED IN TODAY’S LIVE INVENTORY LOAD', 'By: X note text ✅ CONFIRMED IN TODAY’S LIVE INVENTORY LOAD: stock TG1', 'By: X note text');
check('🧾 DEAL-BUILDER STATUS', 'By: X note text 🧾 DEAL-BUILDER STATUS (what the customer set up)', 'By: X note text');
check('☎ PHONE LEAD', 'By: X note text ☎ PHONE LEAD — this customer CALLED the store', 'By: X note text');
check('🚚 DELIVERY REQUESTED (added in v9.7.538)', 'By: X note text 🚚 DELIVERY REQUESTED — APPROVED PHRASING ONLY', 'By: X note text');
check('🎯 ENGAGEMENT-ANGLE DISCIPLINE', 'By: X note text 🎯 ENGAGEMENT-ANGLE DISCIPLINE: If more than one', 'By: X note text');
check('🔑 LOYALTY VEHICLE', 'By: X note text 🔑 LOYALTY VEHICLE: "2019 Kia Soul" is the customer', 'By: X note text');
check('glyph-less header VEHICLE PIVOT DETECTED', 'By: X note text VEHICLE PIVOT DETECTED: Customer is now asking about a Carnival', 'By: X note text');

console.log('\nentries that are ENTIRELY scaffold are dropped, not truncated to nothing:');
check('pure directive entry', EXIT_DIRECTIVE, null);
check('pure glyph block', '📅 APPOINTMENT HISTORY (read the arc — do not assume)', null);

console.log('\nreal human note and customer speech must be untouched:');
check('ordinary agent call note', 'By: Robert Staten Left message', 'By: Robert Staten Left message');
check('substantive call note with caps and a colon',
  'By: Rotaxlyn Hudson Her husband called in for Robert. He is off today. Customer just wanted to know what APR rates are running on the new Carnivals.',
  'By: Rotaxlyn Hudson Her husband called in for Robert. He is off today. Customer just wanted to know what APR rates are running on the new Carnivals.');
check('customer message using similar words in lowercase',
  'i read the full transcript you sent and had a critical question about the inventory',
  'i read the full transcript you sent and had a critical question about the inventory');
check('customer texting an emoji in caps — must NOT be cut',
  'Received by: Robert Staten 🔥 THIS IS THE ONE I WANT',
  'Received by: Robert Staten 🔥 THIS IS THE ONE I WANT');
check('customer texting a warning-ish emoji then lowercase',
  'Received by: Robert Staten ⚠ careful the brakes felt soft on the test drive',
  'Received by: Robert Staten ⚠ careful the brakes felt soft on the test drive');
check('the genuine exit message itself is never cut',
  'Received from: (832) 829-7272 Received by: Rotaxlyn Hudson Not needed. Already purchased another vehicle',
  'Received from: (832) 829-7272 Received by: Rotaxlyn Hudson Not needed. Already purchased another vehicle');

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
