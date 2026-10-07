#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('showroom-novehicle-768.test.js');
// (v9.7.768) A SHOWROOM VISIT WITH NO VEHICLE ON FILE. 10/6, Toyota Baytown leads 2094292708 and 2094316393: drafts asked
// "What did you and <rep> look at together?" / "if you remember the model you and <rep> discussed... send them over" --
// asking the customer what our own salesperson showed them; the agent skipped three in a row. Gil: and if the notes are thin?
// Now: no vehicle on file -> never ask about the visit; pick up from what the notes do record, else one forward question
// about the customer; and the agent sees "No vehicle recorded for this showroom visit -- check with <rep>".
// Executes the shipped populateFromData and _lpShowroomNoVehicle. Placeholder data only.
//
// Usage: node tests/showroom-novehicle-768.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: showroom-novehicle-768.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CTX = '[10/03/2026 2:00 PM] [SHOWROOM VISIT]\n  Showroom visit started at 10/03/2026 2:00 PM lasting 1 hours | Needs Assessment | first-time buyer, mom may co-sign\n'
  + '=== CURRENT LEAD SUBMITTED HERE ===\n[10/03/2026 1:55 PM] [NOTE] Lead Received\n  Showroom\n';
const lead = (extra) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '',
  dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 3,
  isShowroomFollowUp: true, showroomDetails: 'Needs Assessment | first-time buyer, mom may co-sign', hasOutbound: true, hasCustomerReply: false,
  totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', history: CTX, context: CTX, conversationBrief: CTX, relationshipSignals: {} }, extra || {});
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const has = vm.runInContext('typeof _lpShowroomNoVehicle', sb) === 'function';
  const pfd = (extra) => { vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); const ol = sb.console.log; sb.console.log = () => {};
    try { sb.populateFromData(lead(extra)); } finally { sb.console.log = ol; } return vm.runInContext('leadContext', sb); };
  console.log(' 1. the prompt (executed populateFromData):');
  const c = pfd({});
  check('showroom, no vehicle: the NO VEHICLE RECORDED line renders, once', () => c.split('NO VEHICLE RECORDED FOR THIS VISIT').length - 1, 1);
  check('...it forbids asking what they looked at or discussed with the rep, by the rep\'s first name', () =>
    /Do NOT ask the customer what they looked at, what they and Rep discussed, or to describe or remember the vehicle/.test(c), true);
  check('...notes with substance are picked up; thin notes get one forward question about the customer', () =>
    [/If the visit notes record something else \(a co-signer, a payment range, a trade question/.test(c), /thank them for coming in, mention Rep by name, and ask ONE forward-looking question about them/.test(c)], [true, true]);
  check('control: a vehicle on file -> no line', () => /NO VEHICLE RECORDED/.test(pfd({ vehicle: '2026 Toyota Camry LE' })), false);
  check('control: not a showroom follow-up -> no line', () => /NO VEHICLE RECORDED/.test(pfd({ isShowroomFollowUp: false })), false);
  check('a placeholder vehicle ("Any/All") counts as none', () => /NO VEHICLE RECORDED/.test(pfd({ vehicle: '2026 Toyota Any/All' })), true);
  console.log(' 2. the agent notice helper (new helper):');
  const nv = (x) => has ? vm.runInContext('_lpShowroomNoVehicle', sb)(lead(x)) : '(new helper missing)';
  check('no vehicle -> names the rep for the notice', () => nv({}), { rep: 'Rep Name' });
  check('an unusable rep field ("Status:") or the agent themself -> no name, the notice says "the salesperson"', () =>
    [nv({ salesRep: 'Status:' }), nv({ salesRep: 'Agent Name' })], [{ rep: '' }, { rep: '' }]);
  check('vehicle on file / not showroom -> no notice', () => [nv({ vehicle: '2026 Toyota Camry LE' }), nv({ isShowroomFollowUp: false })], [null, null]);
  check('the notice text is in the shipped post-generation block', () =>
    /No vehicle recorded for this showroom visit \\u2014 check with ' \+ \(_snvN\.rep \|\| 'the salesperson'\) \+ ' what they looked at before sending\./.test(require('fs').readFileSync(f, 'utf8')), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
