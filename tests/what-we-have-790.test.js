#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('what-we-have-790.test.js');
// (v9.7.790) log310, Honda Lafayette lead 2098953366 (on 789): a first-touch lead for a "2026 Honda Pilot AWD Black Edition 4dr SUV",
// no stock number, the customer typed nothing. The feed held exactly one 2026 Pilot Black Edition (Platinum White Pearl); the draft
// said "I can check availability ... What color are you looking for?". Two reasons: 789 fired only when the customer named a colour
// or asked what we have, and its trim reader kept "4dr" ("Black Edition 4dr" never matches "Black Edition"). Now door counts are
// dropped, trims compare as word sets ("Sport Hybrid" = "Hybrid Sport"), and a first-touch lead that names a trim fires WHAT WE HAVE
// on its own -- the lead is the question. With no colour named it lists the trim in any colour, a lower trim (may be mentioned) and
// a higher one (counted, never named). Executes the shipped buildUserPrompt and _lpTrimOf. Placeholder inventory and customer data.
//
// Usage: node tests/what-we-have-790.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: what-we-have-790.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, trim, color, price) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: '2026 Honda Pilot ' + trim, year: 2026, make: 'Honda',
  model: 'Pilot ' + trim, condition: 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price });
const UNITS = [U('T001', 'EX-L', 'Sonic Gray Pearl', 44169), U('T002', 'EX-L', 'Platinum White Pearl', 45426), U('T004', 'Elite', 'Platinum White Pearl', 51578),
  U('T005', 'Touring', 'Crystal Black Pearl', 52890), U('T006', 'Touring', 'Crystal Black Pearl', 50943), U('T007', 'Black Edition', 'Platinum White Pearl', 56024)];
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Pilot AWD Black Edition 4dr SUV', condition: 'New',
  stockNum: '', vin: '', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: false, hasCustomerReply: false, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, context: '[10/13/2026 10:40 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n' }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('_lpValueFactCache', sb)['24399'] = { inv: { units: UNITS }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  vm.runInContext('activeFlags = new Set(); window._lpGrabStartedAt = 0;', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));
  const inv = (p) => (p.match(/INVENTORY: [^\n]*(?:\n- [^\n]*)*(?:\n[^\n]*drivetrain[^\n]*)?/) || [''])[0];
  const T = (v) => { const fn = vm.runInContext('typeof _lpTrimOf === "function" ? _lpTrimOf : null', sb); return fn ? fn(v).disp : '(missing)'; };

  console.log(' 1. the trim reader:');
  check('door counts and body words are dropped: "AWD Black Edition 4dr SUV" -> "Black Edition"; "Hybrid Sport-L AWD 4-Door" -> "Hybrid Sport-L"', () =>
    [T('2026 Honda Pilot AWD Black Edition 4dr SUV'), T('2026 Honda CR-V Hybrid Sport-L AWD 4-Door')], ['Black Edition', 'Hybrid Sport-L']);
  check('trims compare as word sets: "Sport Hybrid" = "Hybrid Sport"; "EX-L" is not "EX"', () => {
    const fn = vm.runInContext('_lpTrimOf', sb), n = (v) => fn(v).norm;
    return [n('2026 Honda Accord Sport Hybrid') === n('2026 Honda Accord Hybrid Sport'), n('2026 Honda Accord EX-L') === n('2026 Honda Accord EX')]; }, [true, false]);

  console.log(' 2. a first-touch lead is the question:');
  const b = inv(up(LEAD()));
  check('lead 2098953366 shape: nothing typed, no stock -> WHAT WE HAVE fires', () => /^INVENTORY: 📦 WHAT WE HAVE IN THE 2026 PILOT RIGHT NOW/.test(b), true);
  check('and says the Black Edition is IN STOCK, in Platinum White Pearl (no "check availability", no colour question needed)', () =>
    [/- The 2026 Pilot Black Edition: IN STOCK -- 2026 Pilot Black Edition \(Platinum White Pearl\)\./.test(b), /Do NOT say you still need to check, verify or confirm availability/.test(b)], [true, true]);
  check('a first-touch Touring with none in white is not the question -- with no colour, the Tourings in stock are listed', () =>
    /- The 2026 Pilot Touring: IN STOCK -- 2026 Pilot Touring \(Crystal Black Pearl\) x2\./.test(inv(up(LEAD({ vehicle: '2026 Honda Pilot Touring AWD' })))), true);
  const bt = inv(up(LEAD({ vehicle: '2026 Honda Pilot TrailSport' })));
  check('a trim not in stock (no price to rank against): NONE, and every other trim counted as "other trims", never named', () =>
    [/- The 2026 Pilot TrailSport: NONE in stock today\./.test(bt), /lower trim/.test(bt), /- In other trims: 6 units\. Do NOT name them or their trims\. Say it the way the store does: "we do have other options if you'd like to come take a look at them"/.test(bt),
     /EX-L|Elite|Black Edition|Touring \(/.test(bt)], [true, false, true, false]);
  const bx = inv(up(LEAD({ vehicle: '2026 Honda Pilot Touring AWD', convState: 'active-follow-up', hasOutbound: true, lastInboundMsg: 'Do you have any in white?' })));
  check('with the trim in stock to rank against: lower trims in their colour may be named, higher ones counted as "above"', () =>
    [/- White in a lower trim: 2026 Pilot EX-L \(Platinum White Pearl\)\./.test(bx), /- White in a trim above what they asked for: 2 units\./.test(bx)], [true, true]);

  console.log(' 3. when it stays out:');
  check('control: a first-touch lead with no trim ("2026 Honda Pilot") and no ask -> the old note', () => /WHAT WE HAVE/.test(up(LEAD({ vehicle: '2026 Honda Pilot' }))), false);
  check('control: a follow-up with no colour and no ask -> the old note (789 unchanged)', () => /WHAT WE HAVE/.test(up(LEAD({ convState: 'active-follow-up', hasOutbound: true }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
