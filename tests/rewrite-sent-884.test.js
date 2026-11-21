#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('rewrite-sent-884.test.js');
// (v9.7.884) THE TEXT REWRITE KNOWS WHAT WENT OUT. Owner, 11/18 ("check regrab"), Honda Lafayette lead 2096450291 on 9.7.883: the main
// prompt and the first draft were right ("did the service records [the manager] emailed come through?"), and the text rewrite shipped
// "the service records ... are ready for you to review" in its place. The guard that keeps a first pass asking whether something we sent
// came through (v9.7.811) knew photos, video, links and quotes, not records; and the rewrite was never told the records went out.
// Executes _lpSentAsk and _lpBuildSmsRefinePrompt on a fixed Central clock. Placeholder data only.
//
// Usage: node tests/rewrite-sent-884.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: rewrite-sent-884.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 18, 14, 7), ms = (h, mi) => CT(2026, 11, 17, h, mi), DAY = '11/17/2026';
const E = (clock, tag, title, body) => '[' + DAY + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const SEND = (h, mi, by, body) => ({ title: 'outbound text message', ms: ms(h, mi), body: 'Sent to: (555) 010-0199\nSent by: ' + by + '\n' + body });
const LEAD = (ask, last) => { const h = E('1:01 PM', 'CUSTOMER', 'Inbound Text Message', '') + E('1:00 PM', 'AGENT', 'Outbound Text Message', last)
    + E('11:20 AM', 'AGENT', 'Outbound Text Message', 'I am having difficulty sending a file that large.') + E('11:15 AM', 'CUSTOMER', 'Inbound Text Message', ask)
    + '[10/08/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
  return { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', manager: 'Other Boss', dealerId: '24399', store: 'Community Honda Lafayette', vehicle: '2020 Honda Pilot Touring',
    convState: 'active-follow-up', hasOutbound: true, hasCustomerReply: true, lastInboundMsg: ask, history: h, conversationBrief: h, context: '',
    outboundSends: [SEND(13, 0, 'Mgr One', last), SEND(11, 20, 'Mgr One', 'I am having difficulty sending a file that large.')] };
};
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  sb.console.log = () => {};
  vm.runInContext('if (typeof STORE_MANAGERS === "object") STORE_MANAGERS = { "24399": [["mgr one", ""]] };', sb);
  const sa = (t) => { try { return vm.runInContext('_lpSentAsk', sb)(t); } catch (e) { return 'THREW'; } };
  const rf = (d) => { sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); return String(vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, did the service records Mgr emailed come through?', 'Hi Test,\n\nDid the service records come through?', d)); };

  console.log(' the first pass is kept when it asks whether what we sent came through:');
  check('lead 2096450291: "did the service records [the manager] emailed come through?" is that question', () => sa('Test, did the service records Mgr emailed come through? Take a look when you have a chance.'), 'Test, did the service records Mgr emailed come through?');
  check('...and the documents customers ask for: a history report, the application, the buyer\'s order', () => [!!sa('Did the Carfax report come through?'), !!sa('Did you get the application I sent?'), !!sa('Did the buyer’s order come through?')], [true, true, true]);
  check('control: the rewrite that shipped ("are ready for you to review") is not that question', () => sa('Test, the service records for the certified 2020 Pilot Touring are ready for you to review.'), '');
  check('control: photos, as since v9.7.811', () => !!sa('Did the photos come through?'), true);

  console.log(' the rewrite is told it went out:');
  const r = rf(LEAD('Can u email?', 'I sent the service records to your email.'));
  check('WHAT THEY ASKED FOR ALREADY WENT OUT: who sent it (a store manager), ask whether it came through, never ready / on its way, no times',
    () => /WHAT THEY ASKED FOR ALREADY WENT OUT[^\n]*\nThey asked "Can u email\?" and Mgr, one of our sales managers, sent it\. The text asks whether it came through[^\n]*Never call it ready, coming or on its way[^\n]*No appointment times\./.test(r), true);
  check('control: nothing was asked to be sent -> no such section', () => /WHAT THEY ASKED FOR ALREADY WENT OUT/.test(rf(LEAD('I work 8 to 8 mon-sat', 'Let me know when you have time.'))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
