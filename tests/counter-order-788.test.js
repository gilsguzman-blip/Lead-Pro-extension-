#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('counter-order-788.test.js');
// (v9.7.788) 10/12 feedback export.
//  1. Kia Baytown lead 2098406554 (AutoTrader, first touch, on 787): the inquiry said the Soul was "listed at $17,468"; a priced
//     message of ours went out after it; the text said "I've got your $17,468 figure and am taking it to my manager". v9.7.786
//     stopped the IdentityMax offer line and the never-replied customer, not this. A counter answers our number, so it must
//     come AFTER it: only a priced message of ours older than the customer's newest message counts, and a lead-form inquiry
//     entry is the customer's, never ours.
//  2. "since you're not local" (Audi lead 2097521611, 10/12) and "Since you're remote" (Honda lead 2097861745, 10/10) reached
//     customers. The DISTANCE rule now forbids labelling them, in the main system prompt and the text rewrite's.
// Executes the shipped _lpPricePushback, buildUserPrompt, buildSystemPrompt and buildSystemPromptSmsRefine. Placeholder data only.
//
// Usage: node tests/counter-order-788.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: counter-order-788.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = n => String(n).padStart(2, '0');
const D = (h) => { const d = new Date(Date.now() - h * 3600000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };
const MARK = '[' + D(11) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const INQ = 'I am interested in the 2024 Kia Soul LX listed at $17,468. Is it still available?';
const OURS = (h) => '[' + D(h) + '] [AGENT] Outbound Text Message\n  Hi Test! The Soul is priced at $17,995 and ready for a test drive.\n';
const AT = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2024 Kia Soul LX', stockNum: 'P0000001', dealerId: '6190',
  store: 'Community Kia Baytown', leadSource: 'Autotrader.Com - Lead', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true,
  totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: INQ, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 },
  context: '[' + D(10) + '] [CUSTOMER REQUEST FROM INQUIRY] ' + INQ + '\n' + OURS(9) + MARK }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('activeFlags = new Set();', sb);
  const PP = vm.runInContext('_lpPricePushback', sb);

  console.log(' 1. a counter comes after our number:');
  check('lead 2098406554 shape: the inquiry ("listed at $17,468"), then a priced message of ours -> no counter', () => PP(AT()), null);
  check('the same with the inquiry written as a [CUSTOMER] lead-received entry -> no counter', () =>
    PP(AT({ context: '[' + D(10) + '] [CUSTOMER] Lead received\n  ' + INQ + '\n' + OURS(9) + MARK })), null);
  check('the prompt carries no THEY COUNTERED block and no "taking their $17,468 to your manager"', () => {
    const p = quiet(() => sb.__lp.buildUserPrompt(AT())); return [/THEY COUNTERED WITH THEIR OWN NUMBER/.test(p), /taking their \$17,468 to your manager/.test(p)]; }, [false, false]);
  check('control: a real reply with their own number, AFTER our priced message, is still a counter', () => {
    const r = PP(AT({ lastInboundMsg: 'Can you do $17,468 out the door?', context: '[' + D(2) + '] [CUSTOMER] Inbound Text Message\n  Can you do $17,468 out the door?\n' + OURS(9) + MARK }));
    return r && [r.counter, r.counterText, r.figure]; }, [true, '17,468', '$17,995']);
  check('control: "is this your final price?" after our price is still a pushback', () => {
    const r = PP(AT({ lastInboundMsg: 'Is this your final price?', context: '[' + D(2) + '] [CUSTOMER] Inbound Text Message\n  Is this your final price?\n' + OURS(9) + MARK }));
    return r && [r.counter, r.trigger]; }, [false, 'final price']);
  check('(new) our priced message sent AFTER their newest message is not what they answered -> nothing', () =>
    PP(AT({ lastInboundMsg: 'Can you do $17,468 out the door?', context: OURS(1) + '[' + D(2) + '] [CUSTOMER] Inbound Text Message\n  Can you do $17,468 out the door?\n' + MARK })), null);

  console.log(' 2. no distance labels:');
  const sys = quiet(() => sb.__lp.buildSystemPrompt('bdc'));
  const rf = quiet(() => vm.runInContext('buildSystemPromptSmsRefine', sb)('Agent', 'Test Store', '(555) 010-0100'));
  const LBL = /Do not LABEL them either: no "since you're not local", "since you're remote", "since you're out of state", "since you're out of town" or "I know you're not nearby" -- offer the remote path as a plain offer \("I can send you a video walkaround"\)\./;
  check('the main system prompt forbids "since you\'re not local" / "since you\'re remote" and says to make it a plain offer', () => LBL.test(sys), true);
  check('the text rewrite\'s system prompt says the same', () => LBL.test(rf), true);
  check('control: the miles / drive-time rule is unchanged around it', () =>
    [/no "since you're 30 miles away", "since you're an hour away"/.test(sys), /Naming the distance gives them a reason not to make the drive\./.test(sys)], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
