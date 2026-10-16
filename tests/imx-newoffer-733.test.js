#!/usr/bin/env node
'use strict';
// (v9.7.733) Honda Lafayette lead 2090666084, 9/28: the customer claimed the IdentityMax offer "$1,000 OFF MSRP on
// All New Hondas!", and the lead's vehicle panel read "(Used)" with NO vehicle behind it. The first text said
// "the $1,000 offer is for new Hondas, so it won't apply to a pre-owned one", and after the customer named an
// HR-V EX-L in white the next draft called it a "white pre-owned HR-V EX-L". Gil: "The customer's VOI just said
// 'used' initially which I think was just a default and not the actual choice. The message should be more
// about taking advantage of the $1000 off on a new car's MSRP and finding out what model/trim they are
// looking for." A condition with no vehicle behind it is a default; only an actual vehicle can be pre-owned.
// Executes the shipped _lpImxOfferKind, _lpImxOfferGuidance and populateFromData. Placeholder names only.
//
// Usage: node tests/imx-newoffer-733.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: imx-newoffer-733.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NEW = '$1,000 OFF MSRP on All New Hondas! Limited Time Savings on All New Inventory';
const PRE = 'Pre-owned and Certified Vehicles under $25,000! An exclusive offer for you!';
const claim = (o) => 'claimed the website offer "' + o + '"';
const brief = (offer, cust) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
  + (cust ? '[09/28/2026 8:43 AM] [CUSTOMER] Inbound Text Message\n  ' + cust + '\n' : '')
  + '[09/28/2026 8:41 AM] [AGENT] Outbound Text Message\n  Test, thanks for claiming the offer.\n'
  + '[09/27/2026 5:40 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n[CUSTOMER REQUEST FROM INQUIRY] ' + claim(offer) + '\n---\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const kind = (t) => vm.runInContext('_lpImxOfferKind', sb)(t);
  const G = (offer, cond, veh) => vm.runInContext('_lpImxOfferGuidance', sb)(claim(offer), cond, veh, { dealerId: '24399', firstTouch: true });

  console.log(' 1. which offer was claimed:');
  check('new-car, pre-owned, other, none', () => [kind(claim(NEW)), kind(claim(PRE)), kind(claim('Free oil change with any test drive')), kind('no offer here')], ['new', 'pre', 'other', '']);

  console.log(' 2. the new-car offer on a lead with no vehicle:');
  const g = G(NEW, 'Pre-Owned', '');
  check('a "Pre-Owned" default with no vehicle does NOT become "the offer does not apply"', () => /is PRE-OWNED, so the offer does NOT apply/.test(g), false);
  check('...it leads with the $1,000 on the new Honda they choose, and asks model and trim', () =>
    [/the \$1,000 is theirs on the new Honda they choose \(final eligibility confirmed in person\)/.test(g), /find out which model and trim they are looking at/.test(g), /Do NOT tell them it does not apply to pre-owned/.test(g)], [true, true, true]);
  check('control: an actual pre-owned vehicle on the lead still gets "does not apply"', () => /the vehicle on this lead \(2025 Honda Accord Sedan SE\) is PRE-OWNED, so the offer does NOT apply/.test(G(NEW, 'Pre-Owned', '2025 Honda Accord Sedan SE')), true);
  check('control: a new vehicle on the lead keeps "applies to new models like the ..."', () => /applies to new models like the 2026 Honda HR-V EX-L/.test(G(NEW, 'New', '2026 Honda HR-V EX-L')), true);

  console.log(' 3. populateFromData, the lead-2090666084 shape:');
  const pfd = (offer, cond, cust, src) => {
    vm.runInContext('activeFlags = new Set(); leadContext = ""; _lpValueFactCache["24399"] = {};', sb);
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', condition: cond, dealerId: '24399', store: 'Community Honda Lafayette',
      leadSource: src || 'Identitymax', convState: 'active-follow-up', leadAgeDays: 0, totalNoteCount: 9, hasOutbound: true, hasCustomerReply: !!cust,
      relationshipSignals: {}, history: '', context: '', conversationBrief: brief(offer, cust), pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0 });
    return vm.runInContext('leadContext', sb);
  };
  const c = pfd(NEW, 'Pre-Owned', 'I am interested in the Honda HRV EXL in white color.');
  check('the Condition line calls the field a default and says not to call it pre-owned', () =>
    [/Condition: the lead's condition field reads "Pre-Owned", but no vehicle is on file and they claimed the offer for NEW vehicles/.test(c), /^Condition: Pre-Owned$/m.test(c)], [true, false]);
  check('the named-model line reads the HR-V as a new one, not "this lead is for a PRE-OWNED vehicle"', () =>
    [/they claimed the new-car offer, so treat it as a new one/.test(c), /this lead is for a PRE-OWNED vehicle/.test(c)], [true, false]);
  check('control: the PRE-OWNED offer keeps the plain condition and the pre-owned narrowing (v9.7.725)', () => {
    const p = pfd(PRE, 'Pre-Owned', 'I am interested in the Honda HRV EXL in white color.');
    return [/^Condition: Pre-Owned$/m.test(p), /this lead is for a PRE-OWNED vehicle/.test(p)]; }, [true, true]);
  check('control: a lead with no IdentityMax offer keeps the plain condition', () =>
    /^Condition: Pre-Owned$/m.test(pfd('', 'Pre-Owned', '', 'Cars.com').replace(/\[CUSTOMER REQUEST FROM INQUIRY\] claimed the website offer ""\n/, '')), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
