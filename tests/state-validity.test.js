#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('state-validity.test.js');

/**
 * state-validity.test.js — regression tests for v9.7.548 / v9.7.547.
 *
 * LIVE INCIDENT: Shaniya Kamakeawong, Community Honda Baytown (6191), lead 2067899945, 8/13.
 * She has NO address on file — PageData Buyer.PostalCode is null, Buyer.State and Buyer.City are
 * both "". So the fallback regex ran over the page text, and the first and only "2 letters +
 * 5 digits" string anywhere on the page was the VEHICLE's own "Mfr code: CK15543" — a real GM
 * chassis code for the Silverado. "CK" is not a state, but it passed `/^[A-Z]{2}$/`, so
 * _geoOutOfState fired and a customer with no known location was told "Since you're out of state."
 *
 * The log named it in one read, which is what the v9.7.547 diagnostics were for:
 *   [LP ADDRESS DIAG] perFrame:[{"lead":"2067899945","cust":"1440262683","st":"CK","zip":"15543"}…]
 *   [LP DISTANCE DIAG] prompt — customerZip:15543 | customerState:CK | dealerId:6191
 *                      | _geoOutOfState:true | distanceBlockRendered:true
 *
 * Note the merge behaved correctly: that frame's customerId matched the active customer, so the
 * v9.7.547 identity gate accepted it. The value itself was garbage at the point of extraction,
 * which is where this build fixes it.
 *
 * Two fixes, both sliced out of each shipped popup.js. Both builds must agree.
 *   A. Extraction prefers the real rendered address shape, and validates the state either way.
 *   B. Every consumer validates against the 50 states + DC instead of `/^[A-Z]{2}$/`.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: state-validity.test.js <popup.js> [popup.js...]'); process.exit(2); }

function cut(src, from, to, what, file) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate ' + what + ' in ' + file);
  return src.slice(a, b);
}

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);

  // Module-scope validator + the geo constants, verbatim.
  vm.runInContext(cut(src, '// (v9.7.548/547) THE 50 STATES + DC.', '\nconst STORE_TO_DEALER_ID',
                      'the state allowlist and geo constants', file), ctx);
  // The distance decision calls the shared customer-text helpers; load them verbatim too.
  vm.runInContext(cut(src, 'function _lpCustomerText(d){', '\n// (v9.7.429/427) ONE Director-mode',
                      'the text helpers', file), ctx);
  const isState = vm.runInContext('_lpIsUSState', ctx);

  // ── A: the scraper's address extraction, verbatim (it declares its own local validator,
  //       because it is injected into the page where module scope does not exist) ──────────
  const extract = vm.runInContext(
    '(function(TEXT, pdZip, pdState){\n' +
    '  var LP_PD_PRIMARY = true, _pdZip = pdZip || "", _pdState = pdState || "";\n' +
    '  var customerState = "", customerZip = "";\n' +
    cut(src, '    // (v9.7.548/547) SCOPE: this block runs INSIDE inlineScraper',
             '    const stockNumRaw =', 'the address extraction', file) +
    '\n  return { state: customerState, zip: customerZip }; })', ctx);

  // ── B: the prompt-side _geoOutOfState decision, verbatim ────────────────────────────────
  const decide = vm.runInContext(
    '(function(data){\n' +
    '  var flags = (data.activeFlags || []).slice();\n' +
    cut(src, '  var _geoOutOfState = false;', "  if (flags.includes('trade')) {", 'the distance decision', file) +
    '\n  return { geoOutOfState: _geoOutOfState, inStateFar: _inStateFar, localSetHit: _localSetHit,\n' +
    '           rendered: flags.indexOf("distance") !== -1 }; })', ctx);

  return { name: path.basename(path.dirname(file)), isState, extract, decide };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, build);
let pass = 0, fail = 0;
function eq(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

// Shaniya's real page text, in document order, transcribed from the 8/13 dump. The vehicle panel
// precedes any buyer block, and her buyer block carries no address at all.
const SHANIYA_TEXT =
  'Lead Info\nStatus: Active\nSales Rep: Tracy Schmersal\nBD Agent: Jordyn Guzman\n' +
  'Vehicle Info\n2018 Chevrolet Silverado 1500 LT (Used)\n4WD Crew Cab Pickup (4 Door)\n' +
  'Stock #:TB011755A\n3GCUKREC6JG192217\nGas V8 5.3L/325\n6-Speed Automatic\nOdom: 71,344\n' +
  'Color: Iridescent Pearl Tricoat\nMfr code: CK15543\nLocation: Community Honda\n' +
  'Buyer and Co-buyer Information:\nBuyer   Edit Buyer\nShaniya Kamakeawong\n' +
  'Cell: (808) 796-9834\nshaniyakw10@gmail.com\n\nCo-buyer\n(none entered)\n';

console.log('\nv9.7.548 — a manufacturer code is not a state');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('THE REGRESSION — Shaniya Kamakeawong, PageData PostalCode null, "Mfr code: CK15543":');
eq('customerState comes out EMPTY, not "CK"',
  i => i.extract(SHANIYA_TEXT, '', '').state, '');
eq('customerZip comes out EMPTY, not "15543"',
  i => i.extract(SHANIYA_TEXT, '', '').zip, '');
eq('"CK" is rejected by the validator outright', i => i.isState('CK'), false);
const SHANIYA_MERGED = {
  store: 'Community Honda Baytown', dealerId: '6191',
  customerState: '', customerZip: '', lastInboundMsg: '', context: '',
  activeFlags: [], relationshipSignals: { personalContext: [] }
};
eq('_geoOutOfState is false', i => i.decide(SHANIYA_MERGED).geoOutOfState, false);
eq('no distance signal renders at all', i => i.decide(SHANIYA_MERGED).rendered, false);
eq('...matching the confirmed-correct "no address data" leads in the same log',
  i => i.decide(SHANIYA_MERGED).localSetHit, null);

console.log('\n   and even if "CK/15543" reached the prompt anyway, it is inert now:');
eq('a non-state state can no longer set _geoOutOfState',
  i => i.decide(Object.assign({}, SHANIYA_MERGED, { customerState: 'CK', customerZip: '15543' })).geoOutOfState, false);

console.log('\nreal addresses still extract — the shapes VinSolutions actually renders:');
const withAddr = (line) => SHANIYA_TEXT.replace('Cell: (808) 796-9834', 'Cell: (808) 796-9834\n' + line);
eq('"Crowley, LA 70526" (space-separated)',
  i => i.extract(withAddr('Crowley, LA 70526'), '', ''), { state: 'LA', zip: '70526' });
eq('"Crowley, LA, 70526" (comma-separated)',
  i => i.extract(withAddr('Crowley, LA, 70526'), '', ''), { state: 'LA', zip: '70526' });
eq('"Baytown, TX 77521"',
  i => i.extract(withAddr('Baytown, TX 77521'), '', ''), { state: 'TX', zip: '77521' });
eq('ZIP+4 keeps the 5-digit form',
  i => i.extract(withAddr('Baytown, TX 77521-1234'), '', ''), { state: 'TX', zip: '77521' });
eq('a two-word city',
  i => i.extract(withAddr('San Antonio, TX 78205'), '', ''), { state: 'TX', zip: '78205' });
eq('a city with a period and a hyphen',
  i => i.extract(withAddr('St. Martin-ville, LA 70582'), '', ''), { state: 'LA', zip: '70582' });

console.log('\n   the real address wins even though the Mfr code appears FIRST in the page:');
eq('address found after the vehicle panel is the one taken',
  i => i.extract(withAddr('Crowley, LA 70526'), '', ''), { state: 'LA', zip: '70526' });

console.log('\nPageData still outranks the page text when it is populated:');
eq('PD supplies both', i => i.extract(SHANIYA_TEXT, '70526', 'LA'), { state: 'LA', zip: '70526' });
eq('PD zip only — no state is taken from a Mfr code to pair with it',
  i => i.extract(SHANIYA_TEXT, '70526', ''), { state: '', zip: '70526' });
eq('a bogus PD state is refused too',
  i => i.extract(SHANIYA_TEXT, '70526', 'ZZ'), { state: '', zip: '70526' });

console.log('\nthe loose fallback survives for pages with no city/comma, but stays label-aware:');
const NO_CITY = 'Buyer\nJane Doe\nLA 70526\n';
eq('a bare "LA 70526" with no city still extracts',
  i => i.extract(NO_CITY, '', ''), { state: 'LA', zip: '70526' });
eq('a vehicle label cannot introduce the match',
  i => i.extract('Vehicle Info\nMfr code: LA 70526\n', '', ''), { state: '', zip: '' });
eq('a stock label cannot either',
  i => i.extract('Stock #: TX 77521\n', '', ''), { state: '', zip: '' });
eq('nothing address-shaped anywhere → empty, not a guess',
  i => i.extract('Lead Info\nStatus: Active\nOdom: 71,344\n', '', ''), { state: '', zip: '' });

console.log('\nthe validator itself — all 51 valid, the near-misses rejected:');
const ALL = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
eq('all 50 states + DC accepted', i => ALL.every(s => i.isState(s)) && ALL.length === 51, true);
eq('"CK" (GM chassis code)', i => i.isState('CK'), false);
eq('"XX"', i => i.isState('XX'), false);
eq('"PR" — a real territory, deliberately not in the set (no rooftop serves it)',
  i => i.isState('PR'), false);
eq('lowercase "la" is accepted (normalized)', i => i.isState('la'), true);
eq('empty string', i => i.isState(''), false);
eq('undefined', i => i.isState(undefined), false);
eq('three letters', i => i.isState('LAX'), false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
