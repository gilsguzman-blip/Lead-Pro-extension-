#!/usr/bin/env node
'use strict';
// (v9.7.725) log250, Community Honda Lafayette, 9/24: an IdentityMax lead with no vehicle on file; the
// customer texted "I'm looking for an Accord". The prompt still said "NO VEHICLE IS ATTACHED TO THIS LEAD.
// Do NOT reference or name any vehicle from the conversation history as the one they want", "Ask directly
// and confidently what they are shopping for" and "Ask what they are looking for instead". v9.7.716's
// named-model reading ran on chat leads only and needed the make in the phrase.
// Now: a model of the STORE'S OWN brand, named in the CUSTOMER's own entries on the CURRENT lead, is the
// named model on any source, and those three lines give way to it. Never promotes a unit. Stock is stated
// only when the feed shows it; "new or pre-owned" is not asked on a pre-owned lead (Gil: "2 is fair").
// Executes the shipped _lpOwnWordsModel, populateFromData, buildUserPrompt and _lpImxOfferGuidance.
// Inventory below is placeholder stock, not the store's feed.
//
// Usage: node tests/named-model-725.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: named-model-725.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ent = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[09/24/2026 9:37 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OFFER = 'Pre-owned and Certified Vehicles under $25,000! An exclusive offer for you!';
const INQ = (q) => '[CUSTOMER REQUEST FROM INQUIRY] ' + q + '\n';
const OURS = ent('09/24/2026 9:42 PM', 'AGENT', 'Outbound Text Message', 'Test, here is where you can browse the pre-owned vehicles. Would 9:15 AM or 10:30 AM Friday work?');
const BRIEF = (cur, old) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + cur + MARK + INQ('claimed the website offer "' + OFFER + '"') + (old || '') + '---\n';
const U = (stock, vehicle, condition) => ({ stock, stockNum: stock, vin: 'VIN' + stock, vehicle, year: vehicle.slice(0, 4), make: 'Honda', model: vehicle.split(' ')[2], condition, certified: false, color: 'Gray' });
const INV = { units: [U('P000001', '2021 Honda Accord Sport', 'used'), U('P000002', '2020 Honda Accord LX', 'used'), U('T000003', '2026 Honda Accord SE', 'new'), U('P000004', '2019 Honda Civic LX', 'used')] };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const own = (brief, dealer) => vm.runInContext('_lpOwnWordsModel', sb)(brief, dealer || '24399');
  const LOG250 = BRIEF(ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'I’m looking for an Accord') + OURS);

  console.log(' 1. what counts as the customer naming a model:');
  check('log250: "I\'m looking for an Accord" on an IdentityMax lead, no make in the phrase -> accord', () => own(LOG250), 'accord');
  check('a model named in the inquiry line counts', () => own('---\n' + MARK + INQ('interested in a CR-V, preferably gray') + '---\n'), 'cr-v');
  check('the newest mention wins', () => own(BRIEF(ent('09/24/2026 10:20 PM', 'CUSTOMER', 'Inbound Text Message', 'actually maybe a civic')
    + ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'I’m looking for an Accord') + OURS)), 'civic');
  check('plain-English model words need the make or a year: "any insight" no, "honda pilot" and "2024 pilot" yes', () => [
    own(BRIEF(ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'any insight on what is under 25k?'))),
    own(BRIEF(ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'a honda pilot'))),
    own(BRIEF(ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'something like a 2024 pilot')))], ['', 'pilot', 'pilot']);
  check('control: a model only WE named does not count', () => own(BRIEF(ent('09/24/2026 9:50 PM', 'AGENT', 'Outbound Text Message', 'We just took in a 2022 Honda Accord EX.'))), '');
  check('control: a model named on an OLDER lead (below the marker) does not count', () =>
    own(BRIEF(OURS, ent('03/02/2026 1:00 PM', 'CUSTOMER', 'Inbound Text Message', 'is the civic still there'))), '');
  check('control: no current-lead marker -> nothing (the whole brief is not this lead)', () =>
    own('---\n' + ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'I’m looking for an Accord') + '---\n'), '');
  check('control: another brand\'s model at a Honda store is not this path\'s (the off-franchise path owns it)', () =>
    own(BRIEF(ent('09/24/2026 10:09 PM', 'CUSTOMER', 'Inbound Text Message', 'do you have a camry'))), '');

  console.log(' 2. the prompt, log250 shape:');
  const run = (brief, extra, inv) => {
    const d = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Identitymax',
      condition: 'Pre-Owned', convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 4, hasOutbound: true, hasCustomerReply: true, relationshipSignals: {},
      conversationBrief: brief, history: '', context: '', pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0, phone: '(555) 010-0199',
      lastInboundMsg: 'I’m looking for an Accord', outboundSends: [] }, extra || {});
    sb.__inv = inv;
    vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpNoApptLeadId = ""; _lpValueFactCache["24399"] = globalThis.__inv ? { inv: globalThis.__inv } : {};', sb);
    sb.__logs.length = 0;
    sb.populateFromData(d);
    const c = vm.runInContext('leadContext', sb);
    return { d, c, p: sb.__lp.buildUserPrompt(Object.assign({}, d, { context: c })), logs: sb.__logs.slice() };
  };
  const r = run(LOG250, null, INV);
  check('the named model is read, and no unit is promoted', () => [r.d._lpNamedModel && r.d._lpNamedModel.phrase, r.d.vehicle, r.d.stockNum || ''], ['Accord', '', '']);
  check('THE CUSTOMER NAMED A MODEL, with the stock count from the feed', () => /THE CUSTOMER NAMED A MODEL, NOT A UNIT: in their own words they want "Accord"\. No vehicle is on file, and 3 units in stock match/.test(r.c), true);
  check('the three contradicting lines are gone', () => [/CRM CONFIRMS: no vehicle of interest/.test(r.p), /NO VEHICLE IS ATTACHED TO THIS LEAD/.test(r.p), /Ask what they are looking for instead/.test(r.p)], [false, false, false]);
  check('...replaced by the named-model Vehicle line and constraint', () => [/Vehicle:\s+\(none on file\) ← The customer has named a MODEL in their own words — "Accord"/.test(r.p),
    /the customer has told you the model they want \("Accord"\): work from that, and do NOT ask what they are looking for/.test(r.p)], [true, true]);
  check('a pre-owned lead is not asked "new or pre-owned"', () => [/this lead is for a PRE-OWNED vehicle, so do not ask new or pre-owned/.test(r.c), /narrows it \(new or pre-owned/.test(r.c)], [true, false]);
  check('...and the pre-owned offer says the same (Gil: "2 is fair")', () =>
    /They claimed the PRE-OWNED offer: do NOT ask whether they want new or pre-owned, and read a model they name as a pre-owned one in that range/.test(r.p), true);
  check('the diag names it', () => r.logs.some(l => /^\[LP NAMED-MODEL DIAG\] the customer named "accord" on this lead \(source "Identitymax"\); 3 unit\(s\) in stock match; no unit promoted/.test(l)), true);
  check('no stock feed loaded -> does NOT say we have one', () => {
    const c = run(LOG250, null, null).c; return [/stock for that model is not shown in this prompt, so do NOT say we have one here/.test(c), /we have them in stock/.test(c)]; }, [true, false]);
  check('a NEW lead keeps "new or pre-owned" as a way to narrow it', () => /narrows it \(new or pre-owned, a trim/.test(run(LOG250, { condition: 'New' }, INV).c), true);
  check('control: before the customer names anything, the no-vehicle lines stand as before', () => {
    const x = run(BRIEF(OURS), { hasCustomerReply: false, lastInboundMsg: '' }, INV);
    return [x.d._lpNamedModel, /CRM CONFIRMS: no vehicle of interest/.test(x.p), /NO VEHICLE IS ATTACHED TO THIS LEAD/.test(x.p)]; }, [null, true, true]);
  check('control: a lead WITH a vehicle is untouched', () => {
    const x = run(LOG250, { vehicle: '2021 Honda Accord Sport', stockNum: 'P000001' }, INV); return [x.d._lpNamedModel, /THE CUSTOMER NAMED A MODEL/.test(x.c)]; }, [null, false]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
