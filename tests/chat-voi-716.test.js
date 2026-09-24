#!/usr/bin/env node
'use strict';
// (v9.7.716) log246, Community Honda Baytown (dump 93441ecd): a "Dealertrack - Gubagoo Inc." lead with no
// vehicle of interest. Asked for a model name, the customer texted "Honda accord". The v9.7.257 chat-VOI
// promotion scored that against the store's inventory, where 30 Accords score the same, kept the FIRST
// unit to reach the top score and pinned it as the VOI with stock and colour, so the draft said "the 2026
// Accord Hybrid EX-L you asked about is here in Canyon River Blue Metallic".
// Now: a unit is promoted only when it is the one best match; a tie means the customer named a MODEL,
// and the prompt says so. Without a chat transcript the vehicle is read from the customer's own entries.
// Executes the shipped populateFromData and buildUserPrompt, and generateAll's prompt-input literal.
// Inventory below is placeholder stock, not the store's feed.
//
// Usage: node tests/chat-voi-716.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chat-voi-716.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, vehicle, color, condition) => ({ stock, stockNum: stock, vin: 'VIN' + stock, vehicle, year: vehicle.slice(0, 4),
  make: 'Honda', model: vehicle.split(' ')[2], condition: condition || 'new', certified: false, color });
const INV = { units: [
  U('TX000001', '2026 Honda Accord Hybrid EX-L', 'Canyon River Blue Metallic'),
  U('TX000002', '2026 Honda Accord SE', 'Platinum White Pearl'),
  U('TX000003', '2026 Honda Accord Hybrid Sport', 'Urban Gray Pearl'),
  U('TX000004', '2026 Honda Civic Sport', 'Crystal Black Pearl'),
  U('TX000005', '2025 Honda Pilot TrailSport', 'Diffused Sky Blue Pearl') ] };
const ent = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const FENCE = (t) => 'AGENT CONTEXT — READ THIS FIRST.\nCONVERSATION TRANSCRIPT (newest first):\n---\n' + t + '---\n';
const OURS = ent('09/24/2026 9:46 AM', 'AGENT', 'Outbound Text Message', 'Enrique, just send me a model name to start. We are open until 8 PM today.');

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  sb.__inv = INV;
  const pfd = (brief, extra) => {
    const d = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '6191', store: 'Community Honda Baytown',
      leadSource: 'Dealertrack - Gubagoo Inc.', convState: 'active-follow-up', leadAgeDays: 0, totalNoteCount: 8, hasOutbound: true,
      hasCustomerReply: true, relationshipSignals: {}, conversationBrief: brief, history: '', context: '',
      pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0 }, extra || {});
    vm.runInContext('activeFlags = new Set(); leadContext = ""; _lpValueFactCache["6191"] = { inv: globalThis.__inv };', sb);
    sb.__logs.length = 0;
    sb.populateFromData(d);
    return { d, c: vm.runInContext('leadContext', sb), logs: sb.__logs.slice() };
  };

  console.log(' 1. "Honda accord" is a model, not a unit:');
  const r1 = pfd(FENCE(ent('09/24/2026 10:11 AM', 'CUSTOMER', 'Inbound Text Message', 'Honda accord') + OURS));
  check('no unit is pinned: vehicle and stock stay empty, no colour', () => [r1.d.vehicle, r1.d.stockNum || '', r1.d.color || ''], ['', '', '']);
  check('...and none of the three Accords is presented as theirs', () => [/Canyon River Blue|TX000001|confirmed in stock/.test(r1.c)], [false]);
  check('the prompt says the customer named a model, with the count', () => /THE CUSTOMER NAMED A MODEL, NOT A UNIT: in their own words they want "Honda accord"\. No vehicle is on file, and 3 units in stock match/.test(r1.c), true);
  check('...and does not ask them what they are shopping for again', () => /Ask directly and confidently what they are shopping for/.test(r1.c), false);
  check('the diag says why it did not promote', () => r1.logs.some(l => /^\[LP CHAT-VOI DIAG\] NOT promoted -- "Honda accord" matches 3 units equally/.test(l)), true);
  check('the LEAD section names the model instead of "NO VEHICLE IS ATTACHED"', () => {
    vm.runInContext('leadContext = ' + JSON.stringify(r1.c) + ';', sb);
    const p = sb.__lp.buildUserPrompt(Object.assign({}, r1.d, { context: r1.c }));
    return [/Vehicle:\s+\(none on file\) ← The customer has named a MODEL in their own words — "Honda accord"/.test(p), /NO VEHICLE IS ATTACHED TO THIS LEAD/.test(p)]; }, [true, false]);
  check('generateAll\'s prompt-input object carries it from lastScrapedData', () => {
    const a = src.indexOf('    var _lpPromptInputData = {'), b = src.indexOf('\n    };\n', a);
    const lit = src.slice(a + '    var _lpPromptInputData = '.length, b + '\n    }'.length);
    sb.__lsd = { _lpNamedModel: { phrase: 'Honda accord', count: 3, sample: [] }, relationshipSignals: {} };
    vm.runInContext('lastScrapedData = globalThis.__lsd;', sb);
    sb.__loc = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : vm.runInContext('typeof ' + String(k) + ' === "undefined" ? undefined : ' + String(k), sb)) });
    const obj = vm.runInContext('(function(){ with (globalThis.__loc) { return (' + lit + '); } })()', sb);
    return obj._lpNamedModel && obj._lpNamedModel.phrase; }, 'Honda accord');

  console.log(' 2. what should still pin a unit, and what never should:');
  const r2 = pfd(FENCE(ent('09/24/2026 10:11 AM', 'CUSTOMER', 'Inbound Text Message', 'the Honda Civic please') + OURS));
  check('control: a model with exactly ONE unit in stock is still promoted, as before', () => [r2.d.vehicle, r2.d.stockNum], ['2026 Honda Civic Sport', 'TX000004']);
  const r3 = pfd(FENCE(ent('09/24/2026 10:11 AM', 'CUSTOMER', 'Inbound Text Message', 'what do you have') +
    ent('09/24/2026 9:50 AM', 'AGENT', 'Outbound Text Message', 'We just got a 2025 Honda Pilot TrailSport in, it is a great one.')));
  check('a vehicle named only in OUR text is not pinned as the customer\'s', () => [r3.d.vehicle, r3.d._lpNamedModel], ['', null]);
  const r4 = pfd('CHAT TRANSCRIPT (customer already spoke with the chat bot - read this before writing):\nGuest: is the 2025 Honda Pilot TrailSport still there\nBot: Let me check.\n');
  check('control: a chat transcript naming a specific unit still promotes it', () => [r4.d.vehicle, r4.d.stockNum], ['2025 Honda Pilot TrailSport', 'TX000005']);
  const r5 = pfd(FENCE(ent('09/24/2026 10:11 AM', 'CUSTOMER', 'Inbound Text Message', 'Honda accord')), { leadSource: 'Cars.com' });
  check('control: a non-chat source is untouched (no promotion, no named-model line)', () => [r5.d.vehicle, r5.d._lpNamedModel, /THE CUSTOMER NAMED A MODEL/.test(r5.c)], ['', null, false]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
