#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('what-we-have-789.test.js');
// (v9.7.789) Honda Lafayette lead 2095742306: "Let me know what you have on that. We would want it in white." (2026 Pilot Touring
// AWD, no stock number). Three of our messages said "I'll check" / "I still need to verify" while the feed held the answer: no white
// Touring, two Tourings in Crystal Black Pearl, white in the EX-L, Elite and Black Edition. Now, when the lead's vehicle has no stock
// or VIN, the customer named a colour or asked what we have, and this grab's inventory is in hand, the INVENTORY line is WHAT WE
// HAVE: the exact trim+colour (or NONE), the same trim in other colours (named), their colour in a lower trim (may be mentioned),
// and their colour in a higher trim -- never named: "we do have other options if you'd like to come take a look at them" (Gil, 10/12).
// The SIMILAR VEHICLES side angle stands down when it fires. Executes the shipped buildUserPrompt, populateFromData and
// _lpWhatWeHave. Placeholder inventory and customer data.
//
// Usage: node tests/what-we-have-789.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: what-we-have-789.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, trim, color, price, cond) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: '2026 Honda Pilot ' + trim, year: 2026, make: 'Honda',
  model: 'Pilot ' + trim, condition: cond || 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price });
const UNITS = [U('T001', 'EX-L', 'Sonic Gray Pearl', 44169), U('T002', 'EX-L', 'Platinum White Pearl', 45426), U('T003', 'EX-L', 'Platinum White Pearl', 43946),
  U('T004', 'Elite', 'Platinum White Pearl', 51578), U('T005', 'Touring', 'Crystal Black Pearl', 52890), U('T006', 'Touring', 'Crystal Black Pearl', 50943),
  U('T007', 'Black Edition', 'Platinum White Pearl', 56024), U('T008', 'EX-L', 'Radiant Red Metallic', 44233)];
const ASK = 'Hey. Let me know what you have on that. We would want it in white.';
const CTX = (ask) => '[10/06/2026 9:18 PM] [CUSTOMER] Inbound Text Message\n  ' + ask + '\n[10/06/2026 6:29 PM] [AGENT] Outbound Text Message\n  Test, I can check the exact 2026 Pilot Touring AWD.\n[10/06/2026 6:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n'
  + (/white/i.test(ask) ? 'COLOR PREFERENCE: Customer mentioned white. Match this in your message or acknowledge availability honestly.\n' : '');
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Pilot Touring AWD', condition: 'New', stockNum: '', vin: '',
  dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'active-follow-up', leadAgeDays: 5, hasOutbound: true, hasCustomerReply: true,
  totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: ASK, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 5 }, context: CTX(ASK) }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const setInv = (units, fresh) => { vm.runInContext('_lpValueFactCache', sb)['24399'] = { inv: { units }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000,
    invSettledAt: fresh === false ? Date.now() - 10000 : Date.now() - 1000, _settled: true }; };
  vm.runInContext('activeFlags = new Set(); window._lpGrabStartedAt = 0;', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));
  const inv = (p) => (p.match(/INVENTORY: [^\n]*(?:\n- [^\n]*)*(?:\n[^\n]*drivetrain[^\n]*)?/) || [''])[0];

  console.log(' 1. lead 2095742306 shape -- a white Touring, none in stock:');
  setInv(UNITS);
  const p = up(LEAD()), b = inv(p);
  check('the INVENTORY line is WHAT WE HAVE, and the "not verified" note is gone', () =>
    [/^INVENTORY: 📦 WHAT WE HAVE IN THE 2026 PILOT RIGHT NOW/.test(b), /we have not verified we have THIS specific trim/.test(p)], [true, false]);
  check('the exact one: "The 2026 Pilot Touring in white: NONE in stock today."', () => /- The 2026 Pilot Touring in white: NONE in stock today\./.test(b), true);
  check('the same trim in other colours is named: Touring (Crystal Black Pearl) x2', () => /- The Touring in other colors: 2026 Pilot Touring \(Crystal Black Pearl\) x2\. You may name these\./.test(b), true);
  check('their colour in a lower trim may be mentioned: EX-L (Platinum White Pearl) x2', () => /- White in a lower trim: 2026 Pilot EX-L \(Platinum White Pearl\) x2\. You may mention it as an option; do not push it\./.test(b), true);
  check('their colour ABOVE the trim (Elite at an overlapping price, Black Edition) is never named -- the store\'s line instead', () =>
    [/- White in a trim above what they asked for: 2 units\. Do NOT name them or their trims\. Say it the way the store does: "we do have other options if you'd like to come take a look at them"/.test(b),
     /Elite|Black Edition/.test(b)], [true, false]);
  check('it says the feed was checked, and no stock number or price reaches the block', () =>
    [/Do NOT say you still need to check, verify or confirm availability on this model/.test(b), /T00\d|\$\d/.test(b)], [true, false]);

  console.log(' 2. the exact one in stock:');
  setInv(UNITS.concat([U('T009', 'Touring', 'Platinum White Pearl', 52500)]));
  check('a white Touring in the feed -> "IN STOCK", and it outranks any "presence not confirmed" line', () => {
    const q = inv(up(LEAD())); return [/- The 2026 Pilot Touring in white: IN STOCK -- 2026 Pilot Touring \(Platinum White Pearl\)\./.test(q), /this outranks any line in this prompt that says the vehicle's presence is not confirmed/.test(q)]; }, [true, true]);

  console.log(' 3. when it stays out:');
  setInv(UNITS);
  check('control: no colour named and no availability ask -> the old note', () => {
    const q = up(LEAD({ lastInboundMsg: 'Thanks, talk soon.', context: CTX('Thanks, talk soon.') })); return [/WHAT WE HAVE/.test(q), /we have not verified we have THIS specific trim/.test(q)]; }, [false, true]);
  check('control: a stock number on the lead -> no block (the unit itself is the answer)', () => /WHAT WE HAVE/.test(up(LEAD({ stockNum: 'T005' }))), false);
  setInv(UNITS, false);
  check('control: inventory that predates this grab -> no block', () => { vm.runInContext('window._lpGrabStartedAt = Date.now() - 2000;', sb); const q = /WHAT WE HAVE/.test(up(LEAD())); vm.runInContext('window._lpGrabStartedAt = 0;', sb); return q; }, false);
  setInv(UNITS);

  console.log(' 4. the side angle stands down:');
  check('populateFromData: no SIMILAR VEHICLES side angle when the inventory answer carries the model', () => {
    vm.runInContext('leadContext = "";', sb); quiet(() => sb.populateFromData(Object.assign(LEAD(), { conversationBrief: CTX(ASK), history: CTX(ASK) })));
    return /SIMILAR VEHICLES IN STOCK/.test(vm.runInContext('leadContext', sb)); }, false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
