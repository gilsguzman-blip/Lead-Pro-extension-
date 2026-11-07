#!/usr/bin/env node
'use strict';
// (v9.7.715) Found in the pre-release replay: the real v9.7.714 scraper run in Chromium over the 11
// uploaded VinSolutions dumps, then populateFromData + buildUserPrompt, diffed against v9.7.710.
//  1. log242's lead (dump ed87d87f): a lease-end customer whose lead vehicle is the 2024 Toyota RAV4
//     that their Sales history says we sold them. VinSolutions flags it out of active inventory because
//     they drive it, and the prompt said "VEHICLE STATUS: SOLD ... pivot to comparable options" and
//     "TASK: The specific vehicle of interest has been sold". The loyalty guard keys on the lead
//     SOURCE ("Showroom" here); the vehicle matching priorSoldVehicle now counts too.
//  2. v9.7.711's availability wording pointed at "the VEHICLE STATUS line below" on loyalty leads,
//     where no such line exists; the customer's own vehicle is now named as such instead.
//  3. _lpIsOurOwnSend did not know three of our own automated sends: Marketing Campaign Email (29 in
//     2 dumps), Email auto response (22 in 4) and Email Price Change.
//  4. The SOLD SIGNAL "REJECTED" diagnostic -- benign, and read by Gil as an error on v9.7.708 -- is a
//     log line, not a console warning.
//
// Usage: node tests/own-vehicle-715.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: own-vehicle-715.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const lead = (extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
    vehicle: '2024 Toyota RAV4', stockNum: 'TA000003A', dealerId: '6190', store: 'Community Toyota Baytown', leadSource: 'Showroom',
    convState: 'active-follow-up', leadAgeDays: 1040, totalNoteCount: 60, hasOutbound: true, hasCustomerReply: true,
    inventoryWarning: true, priorSoldVehicle: '2024 Toyota RAV4', relationshipSignals: {}, history: '', context: '',
    lastInboundMsg: 'What are the options?' }, extra || {});
  const run = (extra) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    const d = lead(extra);
    sb.populateFromData(d);
    const c = vm.runInContext('leadContext', sb);
    const sc = vm.runInContext('classifyScenario', sb)(Object.assign({}, d, { context: c }));
    return { c, sc };
  };
  const shape = (r) => [/VEHICLE STATUS: SOLD/.test(r.c), /THE CUSTOMER'S OWN VEHICLE/.test(r.c),
    /VEHICLE ON LEAD:[^\n]*CUSTOMER'S OWN vehicle/.test(r.c), !!r.sc.vehicleSold];

  console.log(' 1. the vehicle we sold this customer is their car, not a sold unit:');
  check('log242 shape: no SOLD pivot, the own-vehicle line, and vehicleSold false', () => shape(run()), [false, true, true, false]);
  check('control: a DIFFERENT prior sale leaves the SOLD pivot in place', () => shape(run({ priorSoldVehicle: '2021 Honda Civic' })), [true, false, false, true]);
  check('control: same model, different YEAR is not the same car', () => shape(run({ priorSoldVehicle: '2022 Toyota RAV4' })), [true, false, false, true]);
  check('control: no Sales history at all -> SOLD pivot as before', () => shape(run({ priorSoldVehicle: '' })), [true, false, false, true]);
  check('Audi Lafayette\'s show-as-available policy never presents the customer\'s own car as inventory', () => {
    const r = run({ dealerId: '21135', store: 'Audi Lafayette', vehicle: '2022 Audi Q5', priorSoldVehicle: '2022 Audi Q5' });
    return [/present this vehicle as AVAILABLE/.test(r.c), /THE CUSTOMER'S OWN VEHICLE/.test(r.c)]; }, [false, true]);

  console.log(' 2. loyalty leads: the availability line names what exists:');
  check('lease-end source: VEHICLE ON LEAD says own vehicle, never "the VEHICLE STATUS line below"', () => {
    const r = run({ leadSource: 'Toyota Lease End', priorSoldVehicle: '' });
    return [/VEHICLE ON LEAD:[^\n]*CUSTOMER'S OWN vehicle/.test(r.c), /VEHICLE STATUS line below/.test(r.c), /VEHICLE STATUS: SOLD/.test(r.c)]; },
    [true, false, false]);
  check('control: a plain sold unit still points to its VEHICLE STATUS line', () => {
    const r = run({ priorSoldVehicle: '', leadSource: 'Cars.com' });
    return [/VEHICLE STATUS line below/.test(r.c), /VEHICLE STATUS: SOLD/.test(r.c)]; }, [true, true]);

  console.log(' 3. our own automated sends are ours:');
  const own = vm.runInContext('_lpIsOurOwnSend', sb);
  check('Marketing Campaign Email / Email auto response / Email Price Change', () =>
    ['[09/22/2026 7:00 AM] [AGENT] Marketing Campaign Email', 'Email auto response', '[09/16/2026 3:10 AM] [NOTE] Email Price Change'].map(own), [true, true, true]);
  check('control: the customer\'s own messages are not', () => ['[09/23/2026 8:19 PM] [CUSTOMER] Inbound Text Message', 'Email reply from prospect'].map(own), [false, false]);
  check('the scraper\'s copy of the predicate is byte-identical to the module copy', () => {
    const body = (from) => { const a = src.indexOf('function _lpIsOurOwnSend(', from); return src.slice(a, src.indexOf('\n', src.indexOf('.test(t);', a))).replace(/\s+/g, ' '); };
    const first = src.indexOf('function _lpIsOurOwnSend('); return body(first) === body(first + 10); }, true);

  console.log(' 4. a benign diagnostic is not shown as a warning:');
  check('SOLD SIGNAL "REJECTED" is logged, not warned', () =>
    [/console\.warn\('\[LP SOLD SIGNAL DIAG\] REJECTED/.test(src), /console\.log\('\[LP SOLD SIGNAL DIAG\] REJECTED/.test(src)], [false, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
