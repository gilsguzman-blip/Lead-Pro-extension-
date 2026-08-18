#!/usr/bin/env node
'use strict';
/**
 * pivot.test.js — regression tests for the v9.7.537 PIVOT DIRECTION GUARDS.
 *
 * Extracts the SHIPPED vehicle-pivot block out of each build's popup.js and runs
 * real lead shapes through it, so the tests exercise the code that actually ships
 * rather than a reimplementation. Every case runs against BOTH builds and the
 * results must agree (DEV/COMMERCIAL parity).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: pivot.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '  // ── Vehicle pivot detection ────────────────────────────────────';
const END   = '  // ── Competitor deposit override (v9.7.184) ────────────────────────';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate pivot block in ' + file);
  const block = src.slice(a, b);
  // (v9.7.552) The custOnlyLines state machine now closes on LP_SCAFFOLD_LINE_RE, a
  // module-scope constant. Slice it out of the SAME shipped file rather than restating it,
  // so the suite still exercises shipped bytes on both sides of the boundary.
  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  if (ha < 0 || hb < 0 || hb <= ha) throw new Error('could not locate LP_SCAFFOLD_LINE_RE in ' + file);
  const helper = src.slice(ha, hb);
  // The block reads `data`, `hasCustomerReply` and `hasRealOutbound` from the enclosing
  // buildUserPrompt scope, and writes `vehiclePivotNote`. Wrap it with exactly those.
  const fn = new vm.Script(
    helper +
    '\n(function(data, hasCustomerReply, hasRealOutbound){\n' +
    block +
    '\nreturn vehiclePivotNote; })'
  );
  return fn.runInNewContext({ console: { log: function(){} } });
}

const impls = BUILDS.map(f => ({ name: path.basename(path.dirname(f)) + '/' + path.basename(f), run: extract(f) }));

let pass = 0, fail = 0;
function test(name, data, expect) {
  const results = impls.map(i => {
    try { return i.run(data, !!data.hasCustomerReply, !!data.hasOutbound); }
    catch (e) { return 'THREW: ' + e.message; }
  });
  const agree = results.every(r => r === results[0]);
  const got = results[0] || '';
  const ok = agree && expect(got);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++;
    console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + JSON.stringify(results[n].slice(0, 120))));
    else console.log('        got: ' + JSON.stringify(got.slice(0, 200)));
  }
}

const none        = s => s === '';
const crossBrand  = s => /CROSS-BRAND PIVOT/.test(s);
const sisterBrand = s => /SISTER-BRAND PIVOT/.test(s);
const plainPivot  = s => /VEHICLE PIVOT DETECTED/.test(s);

console.log('\nPIVOT DIRECTION GUARDS — v9.7.537');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── MUST NOT FIRE ──────────────────────────────────────────────────────────────
console.log('must NOT produce a pivot note:');

// The live incident, reproduced from the 8/10 log + VinSolutions dump.
test('Billups — CarGurus Accord submission, VOI re-pointed to in-stock Mustang', {
  vehicle: '2014 Ford Mustang 2dr Cpe V6 Premium',
  store: 'Audi Lafayette',
  stockNum: 'P7455',
  convState: 'first-touch',
  hasCustomerReply: false,
  hasOutbound: false,
  lastInboundMsg: "I?m interested in this 2015 Honda Accord and I?d like to know if it?s still available. (CarGurus IMV: $15,372 / Deal Rating: Good Deal / Is From Shippable Listing: No) Likelihood to buy: Standard Timeframe: 2 weeks. Show Less",
  context: "CUSTOMER'S INQUIRY — the customer's own words when they submitted this lead:\n\"I?m interested in this 2015 Honda Accord and I?d like to know if it?s still available.\"\n[NOTE] General Note\n  By: Kaylee Guzman no dupes Allen Billups",
}, none);

// Same lead, but with the supersede note actually reaching the context (guard 3).
test('Billups + CRM supersede note present in context (guard 3)', {
  vehicle: '2014 Ford Mustang 2dr Cpe V6 Premium',
  store: 'Audi Lafayette',
  stockNum: 'P7455',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'sounds good, what time do you close',
  context: '[NOTE] By: System Primary vehicle changed from 2015 Honda Accord Sedan EX-L to 2014 Ford Mustang 2dr Cpe V6 Premium.\n[CUSTOMER] I was looking at the Accord earlier\n',
}, none);

// Guard 2 in isolation: customer HAS replied, so guard 1 is off, but the panel make
// still supersedes the stale third-party message vehicle.
test('panel make supersedes stale inbound vehicle, customer has replied (guard 2)', {
  vehicle: '2020 Mazda CX-5 Sport',
  store: 'Audi Lafayette',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: "I'm interested in this 2023 Honda CR-V and would like to know if it's still available.",
  context: '',
}, none);

// A first-touch lead at a same-brand store: the submission names the store's own model.
test('first-touch Honda lead at Honda store, no reply yet', {
  vehicle: '2026 Honda Pilot',
  store: 'Community Honda Baytown',
  convState: 'first-touch',
  hasCustomerReply: false,
  hasOutbound: false,
  lastInboundMsg: "I'm interested in this 2025 Honda Accord — is it still available?",
  context: '',
}, none);

// Model name appears only in agent/trade text, never a customer line.
test('pivot model appears only in a NOTE, never a customer message', {
  vehicle: '2026 Toyota Tundra',
  store: 'Community Toyota Baytown',
  convState: 'first-touch',
  hasCustomerReply: false,
  hasOutbound: true,
  lastInboundMsg: '',
  context: '[NOTE] customer trade is a 2019 Honda Odyssey\n[AGENT] left voicemail about the Tundra\n',
}, none);

// ── MUST STILL FIRE ────────────────────────────────────────────────────────────
console.log('\nmust STILL produce a pivot note (no over-suppression):');

// The canonical marketing-blast reply: texted about Tundras, replied "Sequoia".
test('blast reply "Sequoia" on a Tundra lead — same-brand pivot survives', {
  vehicle: '2026 Toyota Tundra SR5',
  store: 'Community Toyota Baytown',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'Sequoia',
  context: '[CUSTOMER] Sequoia\n',
}, plainPivot);

// Genuine cross-brand pivot: customer replied asking for a brand we do not carry.
test('genuine cross-brand pivot — customer replied asking for a Honda at a Toyota store', {
  vehicle: '2026 Toyota Camry',
  store: 'Community Toyota Lafayette',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'actually my wife wants an Accord instead, do you have any',
  context: '[CUSTOMER] actually my wife wants an Accord instead, do you have any\n',
}, crossBrand);

// Sister-brand handoff must be unaffected.
test('sister-brand pivot at a Baytown store still routes to the handoff', {
  vehicle: '2026 Toyota Highlander',
  store: 'Community Toyota Baytown',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'what about a Telluride',
  context: '[CUSTOMER] what about a Telluride\n',
}, sisterBrand);

// Guard 2 must not swallow a pivot to a THIRD model unrelated to the stale make.
test('stale inbound make present, but customer pivoted to a different make entirely', {
  vehicle: '2020 Mazda CX-5 Sport',
  store: 'Community Toyota Baytown',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: "I'm interested in this 2023 Honda CR-V",
  context: '[CUSTOMER] been thinking about a Telluride actually\n',
}, sisterBrand);

// Guard 3 must not suppress when the model is on the TO side of the supersede note.
test('supersede note moved TOWARD the detected model — not suppressed', {
  vehicle: '2014 Ford Mustang 2dr Cpe V6 Premium',
  store: 'Community Toyota Baytown',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'still want the Telluride',
  context: '[NOTE] By: System Primary vehicle changed from 2015 Honda Accord to 2019 Kia Telluride.\n[CUSTOMER] still want the Telluride\n',
}, sisterBrand);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
