#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('pivot.test.js');

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

// (v9.7.597) Guarded like the rest — see tests/lib/guarded-impls.js.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, f => ({ name: path.basename(path.dirname(f)) + '/' + path.basename(f), run: extract(f) }));

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


// ── (v9.7.622) THE TRADE IS NOT A PIVOT ────────────────────────────────────────
// LIVE INCIDENT: Sydnie Moon (Audi Lafayette, lead 2075798859, 9/4). VOI a 2025 Nissan Armada
// SL, in stock. TRADE a 2023 Honda CR-V Hybrid. Five days of live negotiation — $800 payment
// target, $22,029 payoff, an appraisal in flight — and her last message, 0.1 days old, was
// "Email please. I have limited service currently but I do have WiFi". The delivered draft
// closed the deal out: "Since you're now focused on the 2023 Honda CR-V Hybrid... Audi
// Lafayette doesn't carry Honda inventory... happy to stay in touch if your plans return to
// the Armada."
//
// The model obeyed what it was handed. The prompt carried BOTH "CROSS-BRAND PIVOT: Customer is
// now interested in a Cr-v (Honda)" and "TRADE-IN: 2023 Honda CR-V Hybrid" — the contradiction
// shipped unresolved and the more emphatic block won. A vehicle the customer is DISPOSING OF
// can never make a cross-brand refusal correct.
//
// Note where the candidate came from: her reply quotes the agent's own subject line, "Re:Your
// CR-V appraisal and Armada numbers". The body says nothing about a CR-V. That subject-line
// pollution is a separate, wider defect — recorded here, not fixed by this guard.
console.log('\na vehicle the customer already HAS is not a pivot:');

const SYDNIE_CTX =
  '[09/04/2026] [CUSTOMER] Subject: Re:Your CR-V appraisal and Armada numbers By: Kristen Willis '
  + 'Email please. I have limited service currently but I do have WiFi\n'
  + '[09/03/2026] [CUSTOMER] I am not opposed to filling one out, just would prefer it not be ran several times\n'
  + '[09/02/2026] [CUSTOMER] No more than the $800 range, which I know is more than likely not possible for the vehicle\n';

test('Sydnie — the CR-V is her TRADE, not a car she moved to', {
  vehicle: '2025 Nissan Armada SL',
  store: 'Audi Lafayette',
  stockNum: '05242A',
  convState: 'negative-reply',
  hasCustomerReply: true,
  hasOutbound: true,
  tradeDescription: '2023 Honda CR-V Hybrid',
  lastInboundMsg: 'Subject: Re:Your CR-V appraisal and Armada numbers By: Kristen Willis Email please. I have limited service currently but I do have WiFi',
  context: SYDNIE_CTX,
}, none);

// The v9.7.552 shape, from the other direction: a vehicle read out of service history.
test('a currently-owned vehicle is not a pivot either', {
  vehicle: '2021 Kia Telluride EX',
  store: 'Community Honda Baytown',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  ownedVehicle: '2015 Toyota Highlander',
  lastInboundMsg: 'still thinking about it',
  context: '[08/18/2026] [CUSTOMER] my Highlander has been good to me but I am ready for something bigger\n',
}, none);

test('"(none entered)" is not a trade and vetoes nothing', {
  vehicle: '2025 Nissan Armada SL',
  store: 'Audi Lafayette',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  tradeDescription: '(none entered)',
  lastInboundMsg: 'actually I want to look at a Cr-v',
  context: '[09/04/2026] [CUSTOMER] actually I want to look at a Cr-v instead\n',
}, crossBrand);

// MUST STILL FIRE — the guard must not become a blanket off-switch. Same customer, same trade,
// but she names a DIFFERENT Honda. That is a real pivot and the refusal is the right answer.
test('a genuine pivot to a model that is NOT the trade still fires', {
  vehicle: '2025 Nissan Armada SL',
  store: 'Audi Lafayette',
  convState: 'engagement',
  hasCustomerReply: true,
  hasOutbound: true,
  tradeDescription: '2023 Honda CR-V Hybrid',
  lastInboundMsg: 'do you have a Pilot instead',
  context: '[09/04/2026] [CUSTOMER] do you have a Pilot instead\n',
}, crossBrand);

// ── (v9.7.638) POSSESSION STATED IN PROSE, NOT ONLY IN A CRM FIELD ─────────────
// Rebecca Caplan (Community Honda Baytown, 9/5). Her prompt carried "VEHICLE PIVOT DETECTED:
// Customer is now asking about a Odyssey ... Address the Odyssey questions directly." She asked no
// Odyssey questions — it is the van on her driveway, and the sentence naming it is a COMPLIMENT
// about how we sold it to her. What she actually wants is three messages up: a used small SUV
// under 75,000 miles.
//
// Guard (2) already had the concept and already had the right words for it — "a vehicle they are
// disposing of, not one they are shopping for" — but read data.tradeDescription and
// data.ownedVehicle, both CRM FIELDS. Rebecca's lead has neither filled in, because she said it in
// a text message. Stating ownership in prose is the ordinary case; the structured field is rare.
console.log('\nownership stated in the customer\'s own words:');
test('Rebecca — "I drive a honda odyssey we bought from you" is not a pivot', {
  vehicle: '2020 Volkswagen Tiguan',
  store: 'Community Honda Baytown',
  convState: 'active-follow-up',
  hasCustomerReply: true,
  hasOutbound: true,
  lastInboundMsg: 'Perfect thanks. I drive a honda odyssey we bought from you quick and easy found it over the phone and came and bought it same day. Thats the experience i am looking for. That CRV probably has more miles than i want but i will look at it.',
  context: '[09/04/2026] [CUSTOMER] Perfect thanks. I drive a honda odyssey we bought from you quick and easy found it over the phone and came and bought it same day. Thats the experience i am looking for. That CRV probably has more miles than i want but i will look at it.\n',
}, none);

test('"my Odyssey has 90k miles on it" — direct possession', {
  vehicle: '2020 Volkswagen Tiguan', store: 'Community Honda Baytown', convState: 'engagement',
  hasCustomerReply: true, hasOutbound: true,
  lastInboundMsg: 'my Odyssey has 90k miles on it now',
  context: '[09/04/2026] [CUSTOMER] my Odyssey has 90k miles on it now\n',
}, none);

test('"we own a Pilot already" — possession, not interest', {
  vehicle: '2026 Toyota Camry', store: 'Community Toyota Lafayette', convState: 'engagement',
  hasCustomerReply: true, hasOutbound: true,
  lastInboundMsg: 'we own a Pilot already so we know the brand',
  context: '[09/04/2026] [CUSTOMER] we own a Pilot already so we know the brand\n',
}, none);

// ── THE CONTROLS, AND THEY ARE THE POINT ───────────────────────────────────────
// The first draft of this guard suppressed the Accord fixture above ("my wife wants an Accord")
// via a loose `my ... Accord`. That is DESIRE, not possession, and suppressing it would re-create
// the Billups incident (v9.7.537) this guard family exists to prevent. Both discriminators that
// were added in response are pinned here, so a future widening cannot quietly undo them.
console.log('\n  ...and wanting one is still a pivot:');
test('CONTROL "my wife wants an Accord" — an article means somebody wants one', {
  vehicle: '2026 Toyota Camry', store: 'Community Toyota Lafayette', convState: 'engagement',
  hasCustomerReply: true, hasOutbound: true,
  lastInboundMsg: 'actually my wife wants an Accord instead, do you have any',
  context: '[CUSTOMER] actually my wife wants an Accord instead, do you have any\n',
}, crossBrand);

test('CONTROL "we have been looking at the Accord" — have BEEN is not have', {
  vehicle: '2026 Toyota Camry', store: 'Community Toyota Lafayette', convState: 'engagement',
  hasCustomerReply: true, hasOutbound: true,
  lastInboundMsg: 'we have been looking at the Accord all week',
  context: '[CUSTOMER] we have been looking at the Accord all week\n',
}, crossBrand);

test('CONTROL possession of one model does not suppress a pivot to another', {
  vehicle: '2026 Toyota Camry', store: 'Community Toyota Lafayette', convState: 'engagement',
  hasCustomerReply: true, hasOutbound: true,
  lastInboundMsg: 'I drive a Corolla now. Do you have an Accord',
  context: '[CUSTOMER] I drive a Corolla now. Do you have an Accord\n',
}, crossBrand);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
