#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stop-pause-791.test.js');
// (v9.7.791) log311, Honda Lafayette lead 2098953366 on 790: a connected call ("she said she isn't looking for a vehicle at this
// moment"), our acknowledgement, then the customer texted "Stop". The lead read as a fresh first touch, the visit decision held
// nothing (level 0), and 790's WHAT WE HAVE fired ("the lead is the question") with nine "lower trim" Pilots under an in-stock
// Black Edition. The draft was right only because the model ignored all of it. Now: a STOP as the customer's newest message, and a
// connected call note saying they are not looking right now (Gil, 10/13: "yes on the call note"), are level-3 visit holds with
// their own lines; WHAT WE HAVE stands down on them, on exit/pause, and its first-touch trigger needs a TRUE first touch (no
// customer message, no connected call); with the exact trim in stock and no colour asked, only that trim is listed, and a lower
// trim is offered as the three closest. Executes the shipped buildUserPrompt and helpers. Placeholder data only.
//
// Usage: node tests/stop-pause-791.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stop-pause-791.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, trim, color, price) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: '2026 Honda Pilot ' + trim, year: 2026, make: 'Honda',
  model: 'Pilot ' + trim, condition: 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price });
const UNITS = [U('T001', 'EX-L', 'Sonic Gray Pearl', 44169), U('T002', 'EX-L', 'Platinum White Pearl', 45426), U('T003', 'EX-L', 'Platinum White Pearl', 43946),
  U('T004', 'Elite', 'Platinum White Pearl', 51578), U('T005', 'Touring', 'Crystal Black Pearl', 52890), U('T006', 'Touring', 'Crystal Black Pearl', 50943),
  U('T007', 'Black Edition', 'Platinum White Pearl', 56024), U('T008', 'EX-L', 'Radiant Red Metallic', 44233), U('T009', 'EX-L', 'Solar Silver Metallic', 45743)];
const E = (when, tag, title, body) => '[10/13/2026 ' + when + '] [' + tag + '] ' + title + '\n  ' + body;
const MARK = '[10/13/2026 10:45 AM] [=== CURRENT LEAD SUBMITTED HERE ===]';
const CALL = E('10:57 AM', 'AGENT', 'Outbound phone call (Contacted)', "By: Agent Name she said she isn't looking for a vehicle at this moment");
const ACK = E('11:02 AM', 'AGENT', 'Outbound Text Message', "Test, thanks for letting me know you're not looking for a vehicle right now.");
const STOP = E('11:21 AM', 'CUSTOMER', 'Inbound Text Message', 'Stop');
const H = (...ents) => ents.reverse().join('\n') + '\n' + MARK + '\n';
const LEAD = (hist, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Pilot AWD Black Edition 4dr SUV', condition: 'New',
  stockNum: '', vin: '', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: true, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  context: hist, history: hist }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const logs = [];
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; logs.length = 0; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('_lpValueFactCache', sb)['24399'] = { inv: { units: UNITS }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  vm.runInContext('activeFlags = new Set(); window._lpGrabStartedAt = 0;', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));
  const owner = () => ((logs.find(l => /\[LP VISIT DECISION DIAG\]/.test(l)) || '').match(/owner: ([^|]*)/) || [, ''])[1].trim();
  const inv = (p) => (p.match(/INVENTORY: [^\n]*(?:\n- [^\n]*)*/) || [''])[0];

  console.log(' 1. lead 2098953366: they texted STOP:');
  const p1 = up(LEAD(H(CALL, ACK, STOP), { lastInboundMsg: 'Stop' })), o1 = owner();
  check('THEY TEXTED STOP: a short acknowledgement, no pitch, no visit, no question', () =>
    /🚫 THEY TEXTED STOP \(10\/13\): they have opted out of texts\. This message is a short, gracious acknowledgement and nothing else -- no pitch, no vehicle, no offer, no visit ask or times, and NO QUESTION of any kind\./.test(p1), true);
  check('it owns the visit decision (level 3), and no inventory answer fires', () => [o1, /WHAT WE HAVE/.test(p1)], ['the STOP block (they opted out of texts)', false]);

  console.log(' 2. before the STOP: the call note says not looking right now:');
  const p2 = up(LEAD(H(CALL, ACK))), o2 = owner();
  check('ON THE CALL THEY SAID THEY ARE NOT LOOKING RIGHT NOW: as if they had written it, no visit, no pitch, no questions', () =>
    /🔴 ON THE CALL THEY SAID THEY ARE NOT LOOKING RIGHT NOW \(10\/13, recorded in the call note\): treat it exactly as if they had written it\..*NO QUESTIONS of any kind\. Never quote or mention the call note\./.test(p2), true);
  check('it owns the visit decision, and no inventory answer fires', () => [o2, /WHAT WE HAVE/.test(p2)], ['the call-note PAUSE (not looking right now)', false]);
  const R = vm.runInContext("typeof LP_CALL_PAUSE_RX !== 'undefined' ? LP_CALL_PAUSE_RX : /(?!)/", sb);
  check('(new helper) what a call note counts as: not looking / not interested at this time / not in the market / not ready -- not "not interested in the Civic"', () =>
    ["she isn't looking for a vehicle at this moment", 'not interested at this time', 'not in the market right now', 'not ready to buy yet', 'not interested in the Civic, wants a CR-V', 'left message']
      .map(t => R.test(t)), [true, true, true, true, false, false]);

  console.log(' 3. when nothing holds:');
  check('control: a call about a different car ("not interested in the Civic, wants a CR-V") -> no hold', () =>
    /ON THE CALL THEY SAID|THEY TEXTED STOP/.test(up(LEAD(H(E('10:57 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name not interested in the Civic, wants a CR-V'))))), false);
  check('control: the customer wrote after the call ("Actually do you have the Black Edition?") -> the call note no longer holds', () =>
    /ON THE CALL THEY SAID/.test(up(LEAD(H(CALL, ACK, E('12:30 PM', 'CUSTOMER', 'Inbound Text Message', 'Actually do you have the Black Edition?')), { lastInboundMsg: 'Actually do you have the Black Edition?' }))), false);

  console.log(' 4. the inventory answer, narrower:');
  check('first touch with a connected call (not a pause) is not a true first touch -> no WHAT WE HAVE from the first-touch trigger', () =>
    /WHAT WE HAVE/.test(up(LEAD(H(E('10:57 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name wants photos of the interior first'))))), false);
  const b5 = inv(up(LEAD(H(), { hasOutbound: false, totalNoteCount: 2 })));
  check('a true first touch, the exact trim in stock, no colour: only that trim -- no lower/higher lines', () =>
    [/- The 2026 Pilot Black Edition: IN STOCK -- 2026 Pilot Black Edition \(Platinum White Pearl\)\./.test(b5), /lower trim|trim above|other trims/.test(b5)], [true, false]);
  vm.runInContext('_lpValueFactCache', sb)['24399'].inv.units = UNITS.concat([U('T010', 'EX-L', 'Platinum White Pearl', 44500), U('T011', 'EX-L', 'Platinum White Pearl', 44800), U('T012', 'EX-L', 'Platinum White Pearl', 45100)]);
  const b6 = inv(up(LEAD(H(E('9:18 PM', 'CUSTOMER', 'Inbound Text Message', 'Do you have it in white?')), { vehicle: '2026 Honda Pilot Touring AWD', convState: 'active-follow-up', lastInboundMsg: 'Do you have it in white?' })));
  vm.runInContext('_lpValueFactCache', sb)['24399'].inv.units = UNITS;
  check('five white EX-Ls below a Touring: the lower trim is offered as the three closest ("x3"), not all five', () => (b6.match(/- White in a lower trim: ([^\n]*)/) || [, ''])[1], '2026 Pilot EX-L (Platinum White Pearl) x3. You may mention it as an option; do not push it.');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
